import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { MODELS, getGroqClient } from "@/lib/ai/models"
import { z } from "zod"
import type { BrandRow } from "@/types/database"

const repurposeSchema = z.object({
  brandId: z.string().uuid(),
  content: z.string().min(20, "Content must be at least 20 characters").max(5000),
})

export interface RepurposedContent {
  hooks: string[]
  carousel_ideas: { title: string; slides: string[] }[]
  reel_scripts: { hook: string; scenes: string[] }[]
  tweets: string[]
  linkedin: string
}

function buildRepurposePrompt(content: string, brand: BrandRow): string {
  const brandCtx = [
    `Brand: ${brand.name}`,
    brand.niche ? `Niche: ${brand.niche}` : null,
    brand.tone_of_voice ? `Tone: ${brand.tone_of_voice}` : null,
    brand.instagram_handle ? `Handle: @${brand.instagram_handle}` : null,
  ].filter(Boolean).join("\n")

  return `${brandCtx}

ORIGINAL CONTENT:
${content}

Repurpose this content into multiple social media formats for the brand above.

RULES:
- hooks: max 8 words each, no product/brand name, stop-scroll energy
- tweets: max 280 characters each, punchy
- carousel_ideas: each slide is one key point (5-7 words max)
- reel_scripts: each scene is a visual instruction + text overlay
- linkedin: professional storytelling, 200-400 words, ends with a question

Respond with ONLY this JSON:
{
  "hooks": ["hook 1", "hook 2", "hook 3", "hook 4", "hook 5"],
  "carousel_ideas": [
    { "title": "carousel title", "slides": ["Slide 1 point", "Slide 2 point", "Slide 3 point", "Slide 4 point", "Save this!"] },
    { "title": "carousel title 2", "slides": ["Slide 1 point", "Slide 2 point", "Slide 3 point", "Slide 4 point", "Follow for more!"] },
    { "title": "carousel title 3", "slides": ["Slide 1 point", "Slide 2 point", "Slide 3 point", "Slide 4 point", "DM us to learn more!"] }
  ],
  "reel_scripts": [
    { "hook": "opening hook line", "scenes": ["Scene 1: visual | audio/text", "Scene 2: visual | audio/text", "Scene 3: CTA | text overlay"] },
    { "hook": "opening hook line 2", "scenes": ["Scene 1: visual | audio/text", "Scene 2: visual | audio/text", "Scene 3: CTA | text overlay"] }
  ],
  "tweets": ["tweet 1 under 280 chars", "tweet 2", "tweet 3", "tweet 4", "tweet 5"],
  "linkedin": "full LinkedIn post 200-400 words"
}`
}

export async function POST(request: Request) {
  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[ai/repurpose] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = repurposeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, parsed.error.issues[0]?.message ?? "Validation failed."), { status: 400 })
  }

  const { brandId, content } = parsed.data

  const { data: brand } = await supabase
    .from("brands")
    .select("*")
    .eq("id", brandId)
    .eq("user_id", user.id)
    .single<BrandRow>()

  if (!brand) {
    return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  }

  try {
    const groq = getGroqClient()
    const response = await groq.chat.completions.create({
      model: MODELS.generation,
      temperature: 0.85,
      max_tokens: 2000,
      messages: [
        {
          role: "system",
          content: "You are an expert content repurposer for Indian D2C brands. You transform any content into multiple platform-native formats. Always respond with valid JSON only. No markdown, no explanation.",
        },
        {
          role: "user",
          content: buildRepurposePrompt(content, brand),
        },
      ],
    })

    const raw = response.choices[0]?.message?.content ?? "{}"
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").replace(/[\x00-\x1F\x7F]/g, " ").trim()

    let result: RepurposedContent
    try {
      result = JSON.parse(cleaned) as RepurposedContent
    } catch {
      console.error("[ai/repurpose] JSON parse failed. Raw:", raw.slice(0, 500))
      return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "AI returned invalid JSON. Please try again."), { status: 500 })
    }

    if (!Array.isArray(result.hooks)) {
      return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "AI response malformed. Please try again."), { status: 500 })
    }

    return NextResponse.json({ data: result }, { status: 200 })
  } catch (err) {
    console.error("[ai/repurpose] error:", err)
    const msg = err instanceof Error ? err.message : "Repurpose failed."
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, msg), { status: 500 })
  }
}
