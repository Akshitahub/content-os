import { z } from "zod"
import type { BrandRow, ProductRow } from "@/types/database"
import type { AdBrief, AdVariant } from "@/types/app"
import { buildBrandContext, QUALITY_BAR } from "./prompts"
import { createCreativeCompletion } from "./creative-completion"
import { buildFactSource, guardCopy, stripGuard } from "./fact-guard"
import { runQualityGate, type GateReport } from "./quality-gate"
import { addTextUsage, sumCostUsd, type TextUsage } from "./pricing"
import { sanitizeVisualBrief, type VisualBrief, type VisualKind, NO_TEXT_BEARING_SUBJECTS_RULE } from "./visual-brief"
import { withLessons, type BrandLesson } from "./brand-brain"
import { kickerHighlightRule, sanitizeHighlight, sanitizeKicker } from "@/lib/design/text-layouts"

// Ad Maker's strategy step: before any image is generated, decide WHO the ad
// is for, WHAT they should do and the ONE value proposition, then write three
// genuinely different creative hypotheses (angle + copy + visual brief) that
// all serve it. One text call; the ad-maker route runs it first and falls
// back to today's brief-less behaviour if it fails. Model output is
// fact-guarded and every visual brief is sanitized here.

export const AD_ANGLES = ["pain_point", "benefit", "proof", "demonstration", "objection"] as const
export const AD_VARIANT_COUNT = 3

// Ads always keep the product reference photo, so only kinds that show the
// product itself are allowed -- anything else becomes a product scene.
const AD_VISUAL_KINDS = new Set<VisualKind>(["product_scene", "detail_closeup", "before_after"])

const strategySchema = z.object({
  ad_brief: z.object({
    audience: z.string().min(1),
    desired_action: z.string().min(1),
    funnel_stage: z.enum(["awareness", "consideration", "conversion"]),
    value_proposition: z.string().min(1),
    offer: z.string().nullable().optional(),
    proof: z.string().nullable().optional(),
  }),
  variants: z.array(z.object({
    angle: z.enum(AD_ANGLES),
    hypothesis: z.string().min(1),
    headline: z.string().min(1),
    primary_text: z.string().min(1),
    cta_button: z.string().min(1),
    visual: z.unknown(),
    kicker: z.unknown().optional(),
    highlight: z.unknown().optional(),
  })).min(AD_VARIANT_COUNT),
})

const SYSTEM_PROMPT = `You are a performance creative strategist for Meta (Facebook/Instagram) ads for Indian D2C brands. You decide the strategy first, then write ad variants that each test a different hypothesis. Respond with valid JSON only.
${QUALITY_BAR}`

function buildUserPrompt(brand: BrandRow, product: ProductRow | null, userDirection: string | undefined, format: string): string {
  return `${buildBrandContext(brand, product)}
${userDirection ? `\nThe user's own direction for this ad: "${userDirection}"\n` : ""}
Ad format: ${format} image ad${product ? ` for "${product.name}"` : ""}, the real product photo is placed in every image.

STEP 1 — AD BRIEF (decide this before writing anything):
- "audience": who this ad is for, specifically.
- "desired_action": the one thing they should do.
- "funnel_stage": awareness | consideration | conversion.
- "value_proposition": the ONE value proposition every variant serves.
- "offer": a real offer ONLY if one is stated in the brand or product facts above, otherwise null.
- "proof": real proof (rating, review count, award, result) ONLY if stated in the facts above, otherwise null.

STEP 2 — exactly ${AD_VARIANT_COUNT} VARIANTS, each a different creative hypothesis:
- "angle": one of ${AD_ANGLES.join(" | ")}. Every variant uses a DIFFERENT angle. Use "proof" only if ad_brief.proof is not null.
- "hypothesis": one line — why this angle might work for this audience.
- "headline": 40 characters or fewer. It is also the text placed on the image.
${kickerHighlightRule()}
- "primary_text": 125 characters or fewer.
- "cta_button": a standard Meta CTA matching desired_action (Shop Now, Learn More, Order Now, Get Offer, Book Now, Sign Up, Contact Us, See More).
- "visual": what the image must show, with the product clearly the hero:
  - "kind": product_scene | detail_closeup | before_after.
  - "must_show": 1-2 sentences, concrete and photographable — the product, its setting and the camera angle. Only visible things: never words, labels, prices, numbers, logos or captions.
  ${NO_TEXT_BEARING_SUBJECTS_RULE.slice(2)} The product's own real packaging (from the product photo) is the one exception.
  - "composition": where the product sits and which area stays calm for the headline.

RULES:
- Every variant serves the same value proposition, but with a different angle AND a different visual idea — never just a colour or wording change.
- Offer, proof, price, discount, testimonial, guarantee or urgency ONLY if present in the brand or product facts above. Otherwise leave offer/proof null and don't imply them.
- No empty adjectives ("premium", "elevated", "seamless", "luxurious") unless the same variant states the specific detail that justifies them.
- Only use facts from the brand and product context above.

Respond with ONLY this JSON:
{
  "ad_brief": { "audience": "...", "desired_action": "...", "funnel_stage": "consideration", "value_proposition": "...", "offer": null, "proof": null },
  "variants": [
    { "angle": "...", "hypothesis": "...", "headline": "...", "kicker": null, "highlight": null, "primary_text": "...", "cta_button": "Shop Now", "visual": { "kind": "product_scene", "must_show": "...", "composition": "..." } }
  ]
}`
}

function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
  const first = cleaned.indexOf("{")
  const last = cleaned.lastIndexOf("}")
  return JSON.parse(first !== -1 && last !== -1 ? cleaned.slice(first, last + 1) : cleaned)
}

/** A sanitized brief restricted to product-led kinds (anything else -> product_scene). */
function adVisual(raw: unknown): VisualBrief | undefined {
  const brief = sanitizeVisualBrief(raw)
  if (!brief) return undefined
  return AD_VISUAL_KINDS.has(brief.kind) ? brief : { ...brief, kind: "product_scene" }
}

export type AdStrategyResult = {
  brief: AdBrief
  variants: AdVariant[]
  model: string
  usage: TextUsage | undefined
  costUsd: number | null
  gate?: GateReport
}

/**
 * One MODELS.creative call deciding the ad brief and AD_VARIANT_COUNT
 * distinct variants. Throws on provider error, timeout or an unusable
 * response -- the caller falls back to brief-less generation.
 */
export async function generateAdStrategy(params: {
  brand: BrandRow
  product: ProductRow | null
  userDirection?: string
  format: string
  timeoutMs: number
  /** "ad_copy"-scope brand lessons (lib/ai/brand-brain.ts), fetched by the route. */
  lessons?: BrandLesson[]
  /** Epoch ms the strategy step must finish by -- the quality gate skips its repair past it. */
  deadline?: number
}): Promise<AdStrategyResult> {
  const { brand, product, format, timeoutMs } = params
  const userDirection = params.userDirection?.trim() || undefined
  const callParams = {
    stage: "ad_strategy",
    logPrefix: "ai/ad-strategy",
    system: SYSTEM_PROMPT,
    user: withLessons(buildUserPrompt(brand, product, userDirection, format), params.lessons),
    reasoningEffort: "medium" as const,
    // ESTIMATE, not measured: a brief + 3 short variants plus medium-effort
    // reasoning tokens.
    maxCompletionTokens: 4000,
    timeoutMs,
  }
  const first = await createCreativeCompletion(callParams)
  let usage = first.usage
  let costUsd = first.costUsd
  const raw = first.content ?? ""

  const guarded = await guardCopy({
    stage: "ad_strategy",
    data: extractJson(raw),
    facts: buildFactSource({ brand, product, brief: [userDirection] }),
    normalTimeoutMs: timeoutMs,
    retry: async (correction, retryTimeoutMs) => {
      const retry = await createCreativeCompletion({ ...callParams, timeoutMs: retryTimeoutMs, followUp: { previous: raw, correction } })
      usage = addTextUsage(usage, retry.usage)
      costUsd = sumCostUsd(costUsd, retry.costUsd)
      return extractJson(retry.content ?? "")
    },
  })

  const parsed = strategySchema.safeParse(guarded)
  if (!parsed.success) throw new Error(`ad strategy response invalid: ${parsed.error.issues[0]?.message ?? "unknown"}`)
  const { ad_brief, variants } = parsed.data

  const brief: AdBrief = { ...ad_brief, offer: ad_brief.offer ?? null, proof: ad_brief.proof ?? null }
  const toVariants = (list: typeof variants): AdVariant[] => list.slice(0, AD_VARIANT_COUNT).map((v) => ({
    angle: v.angle,
    hypothesis: v.hypothesis,
    headline: v.headline,
    primary_text: v.primary_text,
    cta_button: v.cta_button,
    visual: adVisual(v.visual),
    kicker: sanitizeKicker(v.kicker),
    highlight: sanitizeHighlight(v.highlight, v.headline),
  }))

  // Quality gate (lib/ai/quality-gate.ts): the variants' copy + visual
  // briefs, checked against the facts before any image is made.
  const facts = buildFactSource({ brand, product, brief: [userDirection] })
  const gated = await runQualityGate({
    format: "ad",
    data: { variants: toVariants(variants) },
    brand,
    product,
    brief: [userDirection],
    deadline: params.deadline,
    normalTimeoutMs: timeoutMs,
    // Ad Maker always generates from the real product photo.
    productReference: true,
    repair: async (correction, repairTimeoutMs) => {
      const fix = await createCreativeCompletion({ ...callParams, timeoutMs: repairTimeoutMs, followUp: { previous: raw, correction } })
      usage = addTextUsage(usage, fix.usage)
      costUsd = sumCostUsd(costUsd, fix.costUsd)
      const reparsed = strategySchema.safeParse(stripGuard("ad_strategy", extractJson(fix.content ?? ""), facts))
      if (!reparsed.success) throw new Error("repair response invalid")
      return { variants: toVariants(reparsed.data.variants) }
    },
  })
  usage = addTextUsage(usage, gated.gate.usage)
  costUsd = sumCostUsd(costUsd, gated.gate.costUsd)
  const cleanVariants = gated.data.variants

  const angles = cleanVariants.map((v) => v.angle)
  if (new Set(angles).size !== angles.length) console.warn(`[ad-strategy] variants share an angle: ${angles.join(", ")}`)
  if (!brief.proof && angles.includes("proof")) console.warn("[ad-strategy] a variant uses the proof angle but ad_brief.proof is null")
  for (const v of cleanVariants) {
    if (v.headline.length > 40) console.warn(`[ad-strategy] headline over 40 chars (${v.headline.length}): ${v.headline}`)
  }

  return { brief, variants: cleanVariants, model: first.model, usage, costUsd, gate: gated.gate }
}
