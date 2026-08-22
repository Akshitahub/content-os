import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { MODELS, getGroqClient } from "@/lib/ai/models"
import { checkAndIncrementUsage, refundGenerationUsage } from "@/lib/usage/check-and-increment-usage"
import { buildPastExamplesBlock, QUALITY_BAR } from "@/lib/ai/prompts"
import { z } from "zod"
import type { BrandRow } from "@/types/database"

const schema = z.object({
  brandId: z.string().uuid(),
  topic: z.string().min(2).max(300),
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

function buildCarouselPrompt(brand: BrandRow, topic: string, slideCount: number, platform: string, vibe?: string, pastExamples: string[] = []): string {
  const brandCtx = [
    `Brand: ${brand.name}`,
    brand.niche ? `Niche: ${brand.niche}` : null,
    brand.target_audience ? `Audience: ${brand.target_audience}` : null,
    brand.tone_of_voice ? `Tone: ${brand.tone_of_voice}` : null,
    brand.instagram_handle ? `Handle: @${brand.instagram_handle}` : null,
    vibe ? `Visual Vibe: ${vibe}` : null,
  ].filter(Boolean).join("\n")
  const pastExamplesBlock = buildPastExamplesBlock(pastExamples, "carousels")

  return `${brandCtx}${pastExamplesBlock}

CAROUSEL TOPIC: "${topic}"
PLATFORM: ${platform}
TOTAL SLIDES: ${slideCount}

Create a high-performing ${platform} carousel on this topic for this brand.

CRITICAL RULES:
- NEVER use square-bracket placeholders like [Age], [Name], [Number], [Year], [Date] etc.
- If you don't know a specific number (founding year, age, stats), write content that doesn't need it
- Write only actual, complete text — no template variables, no placeholders
- No exclamation marks, no hashtags, no emojis in "headline", "subtext", "points", "cta", or "cover_hook" — plain, punchy text only
- Keep headline under ~50 characters and each bullet point under ~12 words — slides are meant to be scanned in a swipe, not read like an essay
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

COVER HOOK GUIDANCE — cover_hook is what actually gets used as the Instagram caption when this carousel is scheduled, so it carries the same weight as a real caption hook. Make it SPECIFIC to this brand/topic, never a generic template line.

GOOD cover hooks (study these):
✓ "Your skin is lying to you."
✓ "Nobody talks about this beauty mistake."

BAD cover hooks (never write these):
✗ "Swipe to learn more!"
✗ "5 tips you need to know"

HASHTAG STRATEGY — 5+5+5 RULE for the "hashtags" field:
- 5 niche-specific (medium competition, 100K–2M posts): e.g. #SkincareRoutine, #CleanBeautyIndia
- 5 brand/product-specific (low competition, unique to brand): e.g. #BrandName, #ProductName
- 5 broad/trending (high volume, 5M+ posts): e.g. #Skincare, #Beauty, #SelfCare
${QUALITY_BAR}

Respond with ONLY this JSON (no markdown, no explanation):
{
  "title": "short carousel title",
  "cover_hook": "the scroll-stopping cover text — see COVER HOOK GUIDANCE above",
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
  "hashtags": ["niche1", "niche2", "niche3", "niche4", "niche5", "brand1", "brand2", "brand3", "brand4", "brand5", "broad1", "broad2", "broad3", "broad4", "broad5"]
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
      // GPT-OSS reasoning tokens count against max_tokens. Measured live: a
      // 7-slide carousel at reasoning_effort "medium" consumed 828 of 1499
      // completion tokens (55%) on hidden reasoning — structured multi-slide
      // JSON genuinely benefits from real reasoning quality here. Budget
      // raised well past the old Llama-era per-slide formula for headroom.
      reasoning_effort: "medium",
      max_tokens: Math.max(4000, slideCount * 500),
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

  // Feed the brand's own past highly-rated carousels back into the prompt
  // as few-shot examples — skip entirely if none exist yet.
  const pastExamples: string[] = []
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: pastCarousels } = await (supabase.from("carousels") as any)
      .select("slides")
      .eq("brand_id", brandId)
      .gte("user_rating", 4)
      .order("user_rating", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5) as { data: { slides: unknown }[] | null }

    for (const c of pastCarousels ?? []) {
      if (!Array.isArray(c.slides)) continue
      const headlines = c.slides
        .map((s) => (s && typeof s === "object" && "headline" in s ? String((s as { headline: unknown }).headline) : null))
        .filter((h): h is string => !!h)
      if (headlines.length > 0) pastExamples.push(headlines.join(" / "))
    }
  } catch (err) {
    console.error("[ai/carousel/generate] fetching past examples failed (non-fatal):", err)
  }

  const groq = getGroqClient()
  const prompt = buildCarouselPrompt(brand, topic, slideCount, platform, vibe, pastExamples)

  try {
    const data = await generateCarouselWithRetry(groq, prompt, slideCount)

    const d = data as Record<string, unknown>
    if (!Array.isArray(d.slides) || d.slides.length === 0) {
      await refundGenerationUsage(supabase, user.id)
      return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Carousel generation failed. Please try again."), { status: 500 })
    }

    // Persist (non-fatal) — matches the pattern used by every other
    // generate route: the generate call itself saves, the client never
    // needs a separate save request.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from("carousels") as any).insert({
        brand_id: brandId,
        platform,
        title: typeof d.title === "string" ? d.title : null,
        slides: d.slides,
        hashtags: Array.isArray(d.hashtags) ? d.hashtags : [],
        is_saved: true,
      })
    } catch (persistErr) {
      console.error("[ai/carousel/generate] persist failed (non-fatal):", persistErr)
    }

    return NextResponse.json({ data }, { status: 200 })
  } catch (err) {
    await refundGenerationUsage(supabase, user.id)
    const msg = err instanceof Error ? err.message : "Generation failed"
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, msg), { status: 500 })
  }
}
