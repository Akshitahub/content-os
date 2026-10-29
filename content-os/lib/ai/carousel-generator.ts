import type { BrandRow } from "@/types/database"
import { VISUAL_KINDS, sanitizeVisualBrief } from "./visual-brief"
import { buildPastExamplesBlock, buildSuggestedFontField, QUALITY_BAR } from "./prompts"
import { createCreativeCompletion } from "./creative-completion"
import { buildFactSource, guardCopy, stripGuard } from "./fact-guard"
import { runQualityGate, type GateReport } from "./quality-gate"
import { UsageCarryingError, addTextUsage, sumCostUsd, type TextUsage } from "./pricing"
import { withLessons, type BrandLesson } from "./brand-brain"
import { buildBrandBrainLines, parseBrandBrain } from "@/lib/brand-brain-profile"
import { kickerHighlightRule } from "@/lib/design/text-layouts"

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
    ...buildBrandBrainLines(parseBrandBrain(brand.brand_brain)),
  ].filter(Boolean).join("\n")
  const pastExamplesBlock = buildPastExamplesBlock(pastExamples, "carousels")

  return `${brandCtx}${pastExamplesBlock}

CAROUSEL TOPIC: "${topic}"
PLATFORM: ${platform}
TOTAL SLIDES: ${slideCount}

Create a high-performing ${platform} carousel on this topic for this brand.

CRITICAL RULES:
- NEVER use square-bracket placeholders like [Age], [Name], [Number], [Year], [Date] etc.
- Only use a number (founding year, age, stats, prices, results) if it appears in the brand facts or topic above — otherwise write content that doesn't need it
- Write only actual, complete text — no template variables, no placeholders
- No exclamation marks, no hashtags, no emojis in "headline", "subtext", "points", "cta", or "cover_hook" — plain, punchy text only
- Keep headline under ~50 characters and each bullet point under ~12 words — slides are meant to be scanned in a swipe, not read like an essay
- RESPOND WITH ONLY VALID JSON — no markdown fences, no explanation text, no trailing commas

STEP 1 — NARRATIVE PLAN (do this first, emit it as "narrative_plan" before any slide copy):
- "audience_question": the real question this carousel answers for this brand's audience.
- "takeaway": the one thing the reader should know or do after the last slide.
- "arc": one entry per slide (all ${slideCount}, CTA included) — its "slide_number", its "role", and the "new_information" that slide adds.
Roles to choose from (adapt to the topic, don't force all of them): hook, problem, context, step, comparison, evidence, example, mistake, decision_criteria, takeaway, cta.
Default progression: hook → context/problem → explanation/steps → evidence/example → takeaway → CTA.
Then write every slide from its arc entry, and give each slide object (and cta_slide) a "role" matching it.

SLIDE STRUCTURE:
- Slide 1: Cover slide (type: "cover", role: "hook") — bold hook headline + teaser subtext
- Slides 2 to ${slideCount - 1}: Content slides (type: "content") — the role decides WHAT the slide says, the format below decides HOW it's laid out
- Slide ${slideCount}: CTA slide (the separate "cta_slide" object, role "cta" or "takeaway") — states the takeaway, then the call to action

INFORMATION DEPTH — the most common failure is slides that only name a topic ("Final finish delivers refined comfort") and never say anything:
- Every content slide must add one concrete, NEW piece of information the reader didn't have from earlier slides — a how, a why, a trade-off, a criterion, a mistake or an example. A slide that only names a topic is a failure.
- If a headline promises something (a comparison, a sketch, materials, steps, reasons), that slide's points must actually deliver it.
- No empty adjectives ("premium", "refined", "elevated", "seamless", "luxurious") unless the same slide states the specific detail that justifies them.
- Only use facts from the brand context or topic above. When a specific isn't known, teach the general principle instead of inventing one (the number and placeholder rules above still apply).
- The CTA slide's headline summarises the takeaway — never just "follow us" or "save this".

ON-IMAGE EXTRAS — every slide object (and cta_slide) may add:
${kickerHighlightRule()}

VISUAL DIRECTION — every slide object (and cta_slide) gets a "visual" brief for its image:
- "kind": one of ${VISUAL_KINDS.join(" | ")}.
- "must_show": 1-2 sentences, concrete and photographable — which objects, in what arrangement, from what angle.
- "composition": where the subject sits and where the overlaid text goes (e.g. "subject in right two-thirds, left third calm for text").
- For side_by_side or before_after, also give "left" and "right": what each half alone shows (before / first option on the left), visible things only, under 200 characters each.
Rules:
- The visual must DEMONSTRATE the slide's claim, not decorate it: a sketch step shows a sketch, a comparison shows both things side by side, a materials slide shows the actual material samples or finishes, a process shows its stages.
- Brand consistency comes from palette and style, NOT from reusing the same scene. No two consecutive slides may share the same kind AND the same subject; across the carousel vary the subject, the framing (wide / mid / close-up) and the composition.
- Use "abstract_mood" only for the cover or CTA, and only when no concrete visual fits the brand.
- must_show describes ONLY visible things. Never put words, labels, headlines, quotes, numbers, logos or captions in it — the image model renders those as garbled text. Comparison labels like "before/after" are overlaid by the app, not drawn.
- Only depict what's plausible for this brand's actual products or services in the brand context above — don't invent products, rooms or features that aren't there.

CONTENT SLIDE FORMATS — confirmed live (2026-08-29): every content slide
defaulting to the same "title + 3 bullet points" shape reads as
repetitive across different carousels, even when the wording changes.
Vary the structure slide-by-slide instead, choosing whichever format
actually fits that slide's specific content best — don't force every
carousel through the same rotation, and don't use the same format twice
in a row. Every format still uses only "headline" and "points" (the
existing fields — a real UI, not just this prompt, renders these, so no
new field names):
- Bold statement — a single striking line does all the work. "headline"
  carries it; "points" is an empty array. Best for a point that doesn't
  need supporting bullets to land. It may lead with a number only if that
  exact number is in the brand facts or topic above — otherwise no number.
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

Respond with ONLY this JSON (no markdown, no explanation). The values below are an example for a different topic ("why shoppers abandon checkout") showing the depth expected — write your own for THIS topic and brand:
{
  "narrative_plan": {
    "audience_question": "Why do shoppers leave at checkout, and what should I fix first?",
    "takeaway": "Show the full cost before checkout and cut every step that isn't address or payment.",
    "arc": [
      { "slide_number": 1, "role": "hook", "new_information": "Most lost sales happen at checkout, not on product pages" },
      { "slide_number": 2, "role": "problem", "new_information": "The top reason is a cost that only appears at the last step" },
      { "slide_number": 3, "role": "comparison", "new_information": "How shoppers react to shipping shown upfront vs. at payment" },
      { "slide_number": 4, "role": "step", "new_information": "Three fixes, in order of effort" },
      { "slide_number": 5, "role": "mistake", "new_information": "Forced sign-up before payment loses buyers who were ready" },
      { "slide_number": 6, "role": "takeaway", "new_information": "Full cost upfront, fewest steps to pay" }
    ]
  },
  "title": "short carousel title",
  "cover_hook": "the scroll-stopping cover text — see COVER HOOK GUIDANCE above",
  "suggested_vibe": "one of: fun_playful | clean_minimal | bold_dramatic | warm_cozy | professional | trendy_genz — whichever best fits this topic and the brand's own tone_of_voice/vibe above",
  ${buildSuggestedFontField("the suggested_vibe you picked (it sets the slide colors)")},
  "slides": [
    {
      "slide_number": 1,
      "type": "cover",
      "role": "hook",
      "headline": "Your checkout is losing the sale",
      "kicker": "Checkout audit",
      "highlight": "losing the sale",
      "subtext": "Where shoppers drop off, and what to fix first",
      "background_style": "gradient_dark",
      "visual": { "kind": "detail_closeup", "must_show": "A hand holding a phone over a cafe table, the screen glowing but out of focus, thumb paused mid-scroll, shot over the shoulder", "composition": "phone and hand in the right two-thirds, left third soft and empty for text" }
    },
    {
      "slide_number": 2,
      "type": "content",
      "role": "problem",
      "headline": "Why do shoppers leave at checkout?",
      "points": ["A shipping cost they only see at the final step"],
      "background_style": "gradient_light",
      "visual": { "kind": "product_scene", "must_show": "An open cardboard parcel on a kitchen counter with tissue paper half pulled out, the product inside still wrapped, mid shot at counter height", "composition": "parcel in the lower half, upper half calm for text" }
    },
    {
      "slide_number": 3,
      "type": "content",
      "role": "comparison",
      "headline": "Shipping shown upfront vs. at payment",
      "points": ["Upfront: they decide before investing any effort", "At payment: the surprise feels like a trick"],
      "background_style": "white_violet",
      "visual": { "kind": "side_by_side", "must_show": "Two identical parcels side by side on a plain table: the left one neatly sealed on its own, the right one with an unexpected extra box stacked on top, eye-level mid shot", "composition": "two subjects split left and right across the lower two-thirds, top band clear for text", "left": "A neatly sealed parcel alone on a plain table, eye-level mid shot", "right": "The same parcel with an unexpected extra box stacked on top, plain table, eye-level mid shot" }
    },
    {
      "slide_number": 4,
      "type": "content",
      "role": "step",
      "headline": "Fix these three, in this order",
      "points": ["Show shipping on the product page", "Cut checkout to address and payment", "Offer guest checkout"],
      "background_style": "gradient_light",
      "visual": { "kind": "process_sequence", "must_show": "Three stages of an order laid out left to right on a wooden counter: the product in tissue paper, the same product in an open box, the box sealed with a ribbon, top-down wide shot", "composition": "stages across the lower two-thirds, top third clear for text" }
    },
    {
      "slide_number": 5,
      "type": "content",
      "role": "mistake",
      "headline": "Forced sign-up turns away ready buyers",
      "points": [],
      "background_style": "white_violet",
      "visual": { "kind": "product_scene", "must_show": "A shopper on a sofa pulling a hand back from an open laptop, a cup of tea beside it, soft evening light, mid shot from the side", "composition": "subject in the right half, left half calm for text" }
    }
  ],
  "cta_slide": {
    "role": "takeaway",
    "headline": "Show the full cost before checkout",
    "cta": "Save this for your next store update",
    "handle": "@yourhandle",
    "visual": { "kind": "detail_closeup", "must_show": "Two hands passing a sealed parcel across a front doorway, close-up, warm daylight", "composition": "hands and parcel centred low, upper half clear for text" }
  },
  "hashtags": ["niche1", "niche2", "niche3", "niche4", "niche5", "brand1", "brand2", "brand3", "brand4", "brand5", "broad1", "broad2", "broad3", "broad4", "broad5"]
}

Make every slide punchy AND substantive: each one teaches something specific. The cover must stop the scroll immediately.`
}

/**
 * One OpenAI call for the WHOLE carousel (every slide, cta_slide, caption
 * hook and hashtags in a single JSON object -- nothing to parallelize per
 * slide), retried once only if the response isn't parseable JSON, exactly
 * as on Groq. Throws on provider error/timeout so the route's existing
 * refund-and-500 path handles it unchanged (a UsageCarryingError when the
 * calls themselves were billed but both came back unparseable).
 *
 * Fact guard (lib/ai/fact-guard.ts): once parsed, any slide/cover/CTA copy
 * using a number that isn't in the brand facts or topic gets one
 * corrective retry; if that still fails (or errors), the offending
 * sentences are stripped.
 */
export async function generateCarouselWithRetry(
  brand: BrandRow,
  topic: string,
  slideCount: number,
  platform: string,
  vibe: string | undefined,
  pastExamples: string[],
  /** "carousel"-scope brand lessons (lib/ai/brand-brain.ts), fetched by the route. */
  lessons?: BrandLesson[],
  /** Epoch ms the route must finish by -- the quality gate skips its repair past it. */
  deadline?: number
): Promise<{ data: unknown; model: string; usage: TextUsage | undefined; costUsd: number | null; gate?: GateReport }> {
  const prompt = withLessons(buildCarouselPrompt(brand, topic, slideCount, platform, vibe, pastExamples), lessons)
  let usage: TextUsage | undefined
  let costUsd: number | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await createCreativeCompletion(carouselCallParams(prompt, slideCount))
    usage = addTextUsage(usage, result.usage)
    costUsd = sumCostUsd(costUsd, result.costUsd)

    const raw = result.content ?? "{}"
    let data: unknown
    try {
      data = JSON.parse(extractJSON(raw))
    } catch {
      if (attempt === 1) throw new UsageCarryingError("AI returned invalid JSON after retry", usage, costUsd)
      continue
    }

    data = await guardCopy({
      stage: "carousel",
      data,
      facts: buildFactSource({ brand, brief: [topic] }),
      normalTimeoutMs: carouselCallParams(prompt, slideCount).timeoutMs,
      retry: async (correction, timeoutMs) => {
        const retry = await createCreativeCompletion({ ...carouselCallParams(prompt, slideCount), timeoutMs, followUp: { previous: raw, correction } })
        usage = addTextUsage(usage, retry.usage)
        costUsd = sumCostUsd(costUsd, retry.costUsd)
        return JSON.parse(extractJSON(retry.content ?? "")) as unknown
      },
    })
    // Quality gate (lib/ai/quality-gate.ts): copy + visual briefs checked
    // against the facts before any image is made; critical issues get one
    // targeted repair through this same call.
    const facts = buildFactSource({ brand, brief: [topic] })
    const gated = await runQualityGate({
      format: "carousel",
      data: sanitizeVisualBriefs(data),
      brand,
      brief: [topic],
      deadline,
      normalTimeoutMs: carouselCallParams(prompt, slideCount).timeoutMs,
      repair: async (correction, timeoutMs) => {
        const fix = await createCreativeCompletion({ ...carouselCallParams(prompt, slideCount), timeoutMs, followUp: { previous: raw, correction } })
        usage = addTextUsage(usage, fix.usage)
        costUsd = sumCostUsd(costUsd, fix.costUsd)
        return sanitizeVisualBriefs(stripGuard("carousel", JSON.parse(extractJSON(fix.content ?? "")) as unknown, facts))
      },
    })
    usage = addTextUsage(usage, gated.gate.usage)
    costUsd = sumCostUsd(costUsd, gated.gate.costUsd)
    return { data: gated.data, model: result.model, usage, costUsd, gate: gated.gate }
  }
  throw new UsageCarryingError("AI generation failed", usage, costUsd)
}

function withSanitizedVisual(slide: unknown): unknown {
  if (!slide || typeof slide !== "object" || Array.isArray(slide)) return slide
  const { visual, ...rest } = slide as Record<string, unknown>
  const clean = sanitizeVisualBrief(visual)
  return clean ? { ...rest, visual: clean } : rest
}

function sanitizeVisualBriefs(data: unknown): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data
  const d = data as Record<string, unknown>
  return {
    ...d,
    ...(Array.isArray(d.slides) ? { slides: d.slides.map(withSanitizedVisual) } : {}),
    ...(d.cta_slide !== undefined ? { cta_slide: withSanitizedVisual(d.cta_slide) } : {}),
  }
}

function carouselCallParams(prompt: string, slideCount: number) {
  return {
    stage: "carousel",
    logPrefix: "ai/carousel/generate",
    system: "You are an expert carousel content creator for Indian D2C brands on Instagram and LinkedIn. CRITICAL: Respond with ONLY valid JSON. No markdown code fences, no explanation text before or after, no trailing commas. The response must be parseable by JSON.parse() directly.",
    user: prompt,
    // Structured multi-slide JSON genuinely benefits from real reasoning
    // -- same "medium" as on Groq (measured there: a 7-slide carousel
    // spent 828 of 1499 completion tokens on hidden reasoning). Budget
    // unchanged; reasoning tokens count against it on gpt-5.5 too.
    reasoningEffort: "medium" as const,
    // Raised from max(4000, slideCount * 500) for the narrative_plan and
    // the per-slide visual briefs the model now writes -- an ESTIMATE, not
    // measured.
    maxCompletionTokens: Math.max(6000, slideCount * 800),
    // ESTIMATE, not measured (no OPENAI_API_KEY where this was written) --
    // see scripts/test-creative-stages.ts. Sized for a 10-slide carousel
    // at medium effort; revisit against real latency.
    timeoutMs: 60_000,
  }
}
