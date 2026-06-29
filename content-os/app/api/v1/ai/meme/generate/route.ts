import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { MODELS, getGroqClient } from "@/lib/ai/models"
import { checkAndIncrementUsage } from "@/lib/usage/check-and-increment-usage"
import { z } from "zod"
import type { BrandRow } from "@/types/database"

export type MemeFormat =
  | "drake"
  | "big_brain"
  | "disaster_girl"
  | "this_is_fine"
  | "giga_chad"
  | "surprised_pikachu"
  | "distracted_boyfriend"
  | "custom"

const schema = z.object({
  brandId: z.string().uuid(),
  format: z.enum(["drake", "big_brain", "disaster_girl", "this_is_fine", "giga_chad", "surprised_pikachu", "distracted_boyfriend", "custom"]),
  context: z.string().min(5).max(500),
})

export type MemeResult = {
  format: MemeFormat
  panels: { label: string; text: string }[]
  caption: string
  hashtags: string[]
}

const FORMAT_INSTRUCTIONS: Record<MemeFormat, string> = {
  drake: `Drake meme — 2 panels:
Panel 1 (Drake dismissing 😒): The bad/old/wrong approach your audience uses
Panel 2 (Drake approving 😊): Your brand's better solution
Format: { "panels": [{"label": "Drake says NO to", "text": "..."}, {"label": "Drake says YES to", "text": "..."}] }`,

  big_brain: `Big Brain meme — 4 escalating panels:
Start with small/obvious thinking, escalate to galaxy-brain level thinking about your product/brand
Format: { "panels": [{"label": "Small brain", "text": "..."}, {"label": "Normal brain", "text": "..."}, {"label": "Big brain", "text": "..."}, {"label": "Galaxy brain", "text": "..."}] }`,

  disaster_girl: `Disaster Girl — 2 panels:
Panel 1: The chaos / before state / the problem
Panel 2: Brand/product smiling in front of solved problem
Format: { "panels": [{"label": "The problem", "text": "..."}, {"label": "Us after using [brand]", "text": "..."}] }`,

  this_is_fine: `This is Fine — 2 panels:
Panel 1: Relatable struggle/stress moment (fire everywhere)
Panel 2: Finding peace/solution with your brand
Format: { "panels": [{"label": "🔥 This is fine 🔥", "text": "..."}, {"label": "After finding [brand]", "text": "..."}] }`,

  giga_chad: `Giga Chad — 1 panel:
One ultra-confident, bold statement about your brand or product that sounds impossibly based
Format: { "panels": [{"label": "Giga Chad energy", "text": "..."}] }`,

  surprised_pikachu: `Surprised Pikachu — 2 panels:
Panel 1: The relatable action that leads to a predictable result
Panel 2: Surprised face at the (obvious) outcome
Format: { "panels": [{"label": "When you...", "text": "..."}, {"label": "😮 Surprised face", "text": "..."}] }`,

  distracted_boyfriend: `Distracted Boyfriend — 3 panels:
The boyfriend (your audience), the girlfriend (old approach), the other woman (your brand)
Format: { "panels": [{"label": "Your audience", "text": "Your customer"}, {"label": "Old approach (ignored)", "text": "..."}, {"label": "New shiny thing (your brand)", "text": "..."}] }`,

  custom: `Custom format — 2-3 panels for the context provided
Format: { "panels": [{"label": "Panel 1", "text": "..."}, {"label": "Panel 2", "text": "..."}] }`,
}

function buildMemePrompt(brand: BrandRow, format: MemeFormat, context: string): string {
  return `Brand: ${brand.name}
Niche: ${brand.niche ?? "D2C brand"}
Tone: ${brand.tone_of_voice ?? "fun and relatable"}
Context/Topic: "${context}"

Create a brand meme for Indian D2C audiences using the "${format}" format.

${FORMAT_INSTRUCTIONS[format]}

Rules:
- Make it genuinely funny and relatable for Indian consumers
- Reference the brand naturally (not forced)
- Keep text SHORT and punchy (under 10 words per panel)
- The humor should feel authentic, not cringe
- Add a witty caption for the post

Respond with ONLY this JSON:
{
  "format": "${format}",
  "panels": [
    {"label": "panel label", "text": "panel text"}
  ],
  "caption": "Witty Instagram caption for this meme (include CTA)",
  "hashtags": ["#relevant", "#hashtags", "#here"]
}`
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  }

  const usageCheck = await checkAndIncrementUsage(user.id)
  if (!usageCheck.ok) {
    const code = usageCheck.status === 429 ? ErrorCodes.USAGE_LIMIT_EXCEEDED : ErrorCodes.INTERNAL_ERROR
    return NextResponse.json(buildError(code, usageCheck.message), { status: usageCheck.status })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.issues[0]?.message), { status: 400 })
  }

  const { brandId, format, context } = parsed.data

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  const groq = getGroqClient()

  try {
    const response = await groq.chat.completions.create({
      model: MODELS.generation,
      temperature: 0.9,
      max_tokens: 600,
      messages: [
        {
          role: "system",
          content: "You are a witty brand meme writer for Indian D2C brands. Create memes that are funny, relatable, and brand-appropriate. Return valid JSON only.",
        },
        { role: "user", content: buildMemePrompt(brand, format, context) },
      ],
    })

    const raw = response.choices[0]?.message?.content ?? "{}"
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()

    let data: unknown
    try {
      data = JSON.parse(cleaned)
    } catch {
      return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "AI returned invalid JSON. Please try again."), { status: 500 })
    }

    const d = data as Record<string, unknown>
    if (!Array.isArray(d.panels) || d.panels.length === 0) {
      return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Meme generation failed. Please try again."), { status: 500 })
    }

    return NextResponse.json({ data }, { status: 200 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Generation failed"
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, msg), { status: 500 })
  }
}
