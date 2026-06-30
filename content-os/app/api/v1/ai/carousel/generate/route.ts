import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { MODELS, getGroqClient } from "@/lib/ai/models"
import { checkAndIncrementUsage } from "@/lib/usage/check-and-increment-usage"
import { z } from "zod"
import type { BrandRow } from "@/types/database"

const schema = z.object({
  brandId: z.string().uuid(),
  topic: z.string().min(5).max(300),
  slideCount: z.number().int().min(5).max(10).default(7),
  platform: z.enum(["instagram", "linkedin"]).default("instagram"),
  vibe: z.string().optional(),
})

function extractJSON(raw: string): string {
  let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
  const firstBrace = cleaned.indexOf("{")
  const lastBrace = cleaned.lastIndexOf("}")
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1)
  }
  return cleaned
}

function buildCarouselPrompt(brand: BrandRow, topic: string, slideCount: number, platform: string, vibe?: string): string {
  const brandCtx = [
    `Brand: ${brand.name}`,
    brand.niche ? `Niche: ${brand.niche}` : null,
    brand.target_audience ? `Audience: ${brand.target_audience}` : null,
    brand.tone_of_voice ? `Tone: ${brand.tone_of_voice}` : null,
    brand.instagram_handle ? `Handle: @${brand.instagram_handle}` : null,
    vibe ? `Visual Vibe: ${vibe}` : null,
  ].filter(Boolean).join("\n")

  return `${brandCtx}

CAROUSEL TOPIC: "${topic}"
PLATFORM: ${platform}
TOTAL SLIDES: ${slideCount}

Create a high-performing ${platform} carousel on this topic for this brand.

CRITICAL RULES:
- NEVER use square-bracket placeholders like [Age], [Name], [Number], [Year], [Date] etc.
- If you don't know a specific number (founding year, age, stats), write content that doesn't need it
- Write only actual, complete text — no template variables, no placeholders
- RESPOND WITH ONLY VALID JSON — no markdown fences, no explanation text, no trailing commas

SLIDE STRUCTURE:
- Slide 1: Cover slide (type: "cover") — bold hook headline + teaser subtext
- Slides 2 to ${slideCount - 1}: Content slides (type: "content") — each with a clear title + 2-3 bullet points
- Slide ${slideCount}: CTA slide (type: "cta") — strong call to action

BACKGROUND STYLES (rotate through these, DO NOT repeat same style twice in a row):
- "gradient_dark" — dark violet to purple (for cover and CTA)
- "gradient_light" — light violet to white (for content slides)
- "white_violet" — white with violet accents (for content slides)
- "dark_navy" — dark navy to black (alternate option)

Respond with ONLY this JSON (no markdown, no explanation):
{
  "title": "short carousel title",
  "cover_hook": "the scroll-stopping cover text",
  "slides": [
    {
      "slide_number": 1,
      "type": "cover",
      "headline": "Big bold cover headline",
      "subtext": "Swipe to discover →",
      "background_style": "gradient_dark"
    },
    {
      "slide_number": 2,
      "type": "content",
      "headline": "Point #1 Title",
      "points": ["Key insight one", "Key insight two", "Key insight three"],
      "background_style": "gradient_light"
    }
  ],
  "cta_slide": {
    "headline": "Strong CTA headline",
    "cta": "Follow for more tips like this",
    "handle": "@${brand.instagram_handle ?? brand.name.toLowerCase().replace(/\s/g, "")}"
  },
  "hashtags": ["relevant", "hashtags", "here"]
}

Make every slide punchy, valuable, and shareable. The cover must stop the scroll immediately.`
}

async function generateCarouselWithRetry(
  groq: ReturnType<typeof getGroqClient>,
  prompt: string,
  slideCount: number
): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await groq.chat.completions.create({
      model: MODELS.generation,
      temperature: 0.85,
      max_tokens: Math.max(3000, slideCount * 400),
      messages: [
        {
          role: "system",
          content: "You are an expert carousel content creator for Indian D2C brands on Instagram and LinkedIn. CRITICAL: Respond with ONLY valid JSON. No markdown code fences, no explanation text before or after, no trailing commas. The response must be parseable by JSON.parse() directly.",
        },
        { role: "user", content: prompt },
      ],
    })

    const raw = response.choices[0]?.message?.content ?? "{}"
    const cleaned = extractJSON(raw)

    try {
      return JSON.parse(cleaned)
    } catch {
      if (attempt === 1) throw new Error("AI returned invalid JSON after retry")
    }
  }
  throw new Error("AI generation failed")
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

  const { brandId, topic, slideCount, platform, vibe } = parsed.data

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  const groq = getGroqClient()
  const prompt = buildCarouselPrompt(brand, topic, slideCount, platform, vibe)

  try {
    const data = await generateCarouselWithRetry(groq, prompt, slideCount)

    const d = data as Record<string, unknown>
    if (!Array.isArray(d.slides) || d.slides.length === 0) {
      return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Carousel generation failed. Please try again."), { status: 500 })
    }

    return NextResponse.json({ data }, { status: 200 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Generation failed"
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, msg), { status: 500 })
  }
}
