import type { BrandRow } from "@/types/database"
import { buildPastExamplesBlock, QUALITY_BAR } from "./prompts"
import { createCreativeCompletion } from "./creative-completion"

// Carousel prompt building + the model call, moved verbatim out of
// app/api/v1/ai/carousel/generate/route.ts during the Phase 1b Groq ->
// OpenAI migration so scripts/test-creative-stages.ts can exercise the
// real prompt (a Next.js route file can't export non-route helpers). All
// post-processing (CTA merge, vibe background override, sanitizing,
// persistence, credits) stays in the route.

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
- Slides 2 to ${slideCount - 1}: Content slides (type: "content") — see CONTENT SLIDE FORMATS below
- Slide ${slideCount}: CTA slide (type: "cta") — strong call to action

CONTENT SLIDE FORMATS — confirmed live (2026-08-29): every content slide
defaulting to the same "title + 3 bullet points" shape reads as
repetitive across different carousels, even when the wording changes.
Vary the structure slide-by-slide instead, choosing whichever format
actually fits that slide's specific content best — don't force every
carousel through the same rotation, and don't use the same format twice
in a row. Every format still uses only "headline" and "points" (the
existing fields — a real UI, not just this prompt, renders these, so no
new field names):
- Bold statement / stat callout — a single striking claim or number does
  all the work. "headline" carries it; "points" is an empty array. Best
  for a fact that doesn't need supporting bullets to land.
- Short comparison — "points" has exactly 2 items framed as a contrast
  (before/after, old way/new way, myth/reality). "headline" names what's
  being compared.
- Question and answer — "headline" is phrased as a real question the
  audience would ask; "points" has exactly 1 item that directly answers
  it.
- Full list — the existing format: "headline" is a clear title, "points"
  has 2-3 supporting bullets.
Across a whole carousel, use a genuine mix — not every content slide as
a list, and not the same format repeated back-to-back.

BACKGROUND STYLES (rotate through these, DO NOT repeat same style twice in a row):
- "gradient_dark" — dark violet to purple (for cover and CTA)
- "gradient_light" — light violet to white (for content slides)
- "white_violet" — white with violet accents (for content slides)
- "dark_navy" — dark navy to black (alternate option)

COVER HOOK GUIDANCE — cover_hook is what actually gets used as the Instagram caption when this carousel is scheduled, so it carries the same weight as a real caption hook. Make it SPECIFIC to this brand/topic, never a generic template line.

GOOD cover hooks (study these):
GOOD: "Your skin is lying to you."
GOOD: "Nobody talks about this beauty mistake."

BAD cover hooks (never write these):
BAD: "Swipe to learn more!"
BAD: "5 tips you need to know"

HASHTAG STRATEGY — 5+5+5 RULE for the "hashtags" field:
- 5 niche-specific (medium competition, 100K–2M posts): e.g. #SkincareRoutine, #CleanBeautyIndia
- 5 brand/product-specific (low competition, unique to brand): e.g. #BrandName, #ProductName
- 5 broad/trending (high volume, 5M+ posts): e.g. #Skincare, #Beauty, #SelfCare
${QUALITY_BAR}

Respond with ONLY this JSON (no markdown, no explanation):
{
  "title": "short carousel title",
  "cover_hook": "the scroll-stopping cover text — see COVER HOOK GUIDANCE above",
  "suggested_vibe": "one of: fun_playful | clean_minimal | bold_dramatic | warm_cozy | professional | trendy_genz — whichever best fits this topic and the brand's own tone_of_voice/vibe above",
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
      "headline": "73% of first-time buyers never come back",
      "points": [],
      "background_style": "gradient_light"
    },
    {
      "slide_number": 3,
      "type": "content",
      "headline": "Generic emails vs. personalized ones",
      "points": ["Generic: 2% open rate", "Personalized: 41% open rate"],
      "background_style": "white_violet"
    },
    {
      "slide_number": 4,
      "type": "content",
      "headline": "Why do most carts get abandoned?",
      "points": ["Shipping cost shows up too late in checkout"],
      "background_style": "gradient_light"
    },
    {
      "slide_number": 5,
      "type": "content",
      "headline": "Fix your checkout flow in 3 steps",
      "points": ["Show shipping cost upfront", "Cut form fields to the essentials", "Add a guest checkout option"],
      "background_style": "white_violet"
    }
  ],
  "cta_slide": {
    "headline": "Strong CTA headline",
    "cta": "Follow for more tips like this",
    "handle": "@yourhandle"
  },
  "hashtags": ["niche1", "niche2", "niche3", "niche4", "niche5", "brand1", "brand2", "brand3", "brand4", "brand5", "broad1", "broad2", "broad3", "broad4", "broad5"]
}

Make every slide punchy, valuable, and shareable. The cover must stop the scroll immediately.`
}

/**
 * One OpenAI call for the WHOLE carousel (every slide, cta_slide, caption
 * hook and hashtags in a single JSON object -- nothing to parallelize per
 * slide), retried once only if the response isn't parseable JSON, exactly
 * as on Groq. Throws on provider error/timeout so the route's existing
 * refund-and-500 path handles it unchanged.
 */
export async function generateCarouselWithRetry(
  brand: BrandRow,
  topic: string,
  slideCount: number,
  platform: string,
  vibe: string | undefined,
  pastExamples: string[]
): Promise<unknown> {
  const prompt = buildCarouselPrompt(brand, topic, slideCount, platform, vibe, pastExamples)
  for (let attempt = 0; attempt < 2; attempt++) {
    const { content } = await createCreativeCompletion({
      stage: "carousel",
      logPrefix: "ai/carousel/generate",
      system: "You are an expert carousel content creator for Indian D2C brands on Instagram and LinkedIn. CRITICAL: Respond with ONLY valid JSON. No markdown code fences, no explanation text before or after, no trailing commas. The response must be parseable by JSON.parse() directly.",
      user: prompt,
      // Structured multi-slide JSON genuinely benefits from real reasoning
      // -- same "medium" as on Groq (measured there: a 7-slide carousel
      // spent 828 of 1499 completion tokens on hidden reasoning). Budget
      // unchanged; reasoning tokens count against it on gpt-5.5 too.
      reasoningEffort: "medium",
      maxCompletionTokens: Math.max(4000, slideCount * 500),
      // ESTIMATE, not measured (no OPENAI_API_KEY where this was written) --
      // see scripts/test-creative-stages.ts. Sized for a 10-slide carousel
      // at medium effort; revisit against real latency.
      timeoutMs: 60_000,
    })

    const cleaned = extractJSON(content ?? "{}")
    try {
      return JSON.parse(cleaned)
    } catch {
      if (attempt === 1) throw new Error("AI returned invalid JSON after retry")
    }
  }
  throw new Error("AI generation failed")
}
