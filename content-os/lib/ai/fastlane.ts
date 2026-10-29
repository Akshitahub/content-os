import { createCreativeCompletion } from "./creative-completion"
import { buildFactSource, guardCopy, stripGuard } from "./fact-guard"
import { addTextUsage, sumCostUsd, UsageCarryingError, type TextUsage } from "./pricing"
import { getUpcomingOccasionsForAutopilot } from "@/lib/occasions/get-upcoming-occasions"
import { submitSceneAssetJobs } from "@/lib/video/reel-scene-assets"
import type { KlingWebhookConfig } from "@/lib/video/kling-client"
import { createAdminClient } from "@/lib/supabase/server"
import { CONTENT_MIX, buildContentMix } from "@/lib/ai/autopilot-content-mix"
import { findContentQualityIssues, sanitizeLeakedArtifacts } from "@/lib/ai/content-quality-check"
import type { BrandRow, ProductRow } from "@/types/database"
import type { ContentStrategy, ContentSlot, GeneratedCaption, Platform, ReelScene, UserPlan } from "@/types/app"
import { withLessons, type BrandLesson } from "./brand-brain"
import { generatePostCopy } from "./post-copy"
import { generateCarouselWithRetry } from "./carousel-generator"
import { finishGeneratedCarousel } from "./carousel-postprocess"
import { briefScene, type VisualBrief } from "./visual-brief"
import type { GateReport } from "./quality-gate"
import type { BrandTypography } from "@/lib/design/fonts"

// Strategy planning + per-slot generation helpers for Autopilot. The run
// itself is no longer executed here in one request: app/api/v1/brands/
// fastlane/route.ts plans the strategy and enqueues one job per slot, and
// lib/ai/autopilot-worker.ts generates, commits (charges) and saves each
// slot independently from the background drain (see
// supabase/migrations/057_autopilot_slot_jobs.sql).

// Re-exported so app/api/v1/brands/fastlane/route.ts's existing
// `import { estimateAutopilotCreditCost, computeAutopilotSlotCount } from "@/lib/ai/fastlane"`
// keeps working unchanged -- the real implementations now live in
// lib/ai/autopilot-content-mix.ts (a pure module, safe to import from
// client code too, unlike this file's AI/Supabase-heavy imports above).
export { estimateAutopilotCreditCost, computeAutopilotSlotCount, buildContentMix } from "@/lib/ai/autopilot-content-mix"

// Same bucket used by app/api/v1/ai/post-image/generate/route.ts — Autopilot
// images go through the same pipeline and land in the same place.
export const IMAGE_BUCKET = "brand-images"

// Matches schedulePostSchema's MIN_CAROUSEL_IMAGES in
// app/api/v1/calendar/schedule-post/route.ts — Instagram's own minimum for
// a carousel post.
export const MIN_CAROUSEL_SLIDES = 2

// CONFIRMED bug: the regex fallback below used to extract each field with
// e.g. `/"caption"\s*:\s*"([^"]*)"/` (or, for "caption" specifically, a
// `[\s\S]*?` non-greedy variant) — neither accounts for a JSON-escaped
// quote (`\"`) inside the real value. `[^"]*` stops dead at the FIRST `"`
// it sees, escaped or not, silently truncating any field whose generated
// text contains a literal quote character (a quoted phrase, an inch/foot
// mark, a product name in quotes) at that exact point — a real, provable
// truncation bug, not a hypothetical one, and one that only ever fired
// through this fallback path (i.e. only when the primary JSON.parse below
// already failed), which is exactly the "sometimes" pattern intermittent
// corruption reports describe. Finds the value the same way a real JSON
// parser would: scan forward from the opening quote, treating `\\` as an
// escape for the next character, and stop at the first quote that ISN'T
// escaped -- then hand the exact matched `"..."` (with its escapes intact)
// to JSON.parse so \n/\"/\\/\uXXXX all decode correctly, instead of the
// old bare regex capture group's raw, still-escaped text.
function extractJsonStringValue(json: string, key: string): string | null {
  const keyPattern = new RegExp(`"${key}"\\s*:\\s*"`)
  const startMatch = keyPattern.exec(json)
  if (!startMatch) return null
  let i = startMatch.index + startMatch[0].length
  let escaped = false
  const chars: string[] = []
  for (; i < json.length; i++) {
    const c = json[i]!
    if (escaped) {
      chars.push(c)
      escaped = false
      continue
    }
    if (c === "\\") {
      chars.push(c)
      escaped = true
      continue
    }
    if (c === "\"") break
    chars.push(c)
  }
  try {
    return JSON.parse(`"${chars.join("")}"`) as string
  } catch {
    // Malformed escape sequence even within our own scan -- fall back to
    // the raw (still-escaped) text rather than losing the field entirely.
    return chars.join("")
  }
}

function sanitizeJsonString(raw: string): string {
  return raw
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim()
}

/**
 * Running model-usage/cost total for one unit of Autopilot work (the
 * strategy call, or one slot), so its tokens/cost_usd can be written onto
 * the run's ai_generation_logs row. Mutated by every text and image call
 * in that unit.
 */
export type AutopilotUsageTracker = {
  usage: TextUsage | undefined
  costUsd: number | null
  captionMs: number
  imageMs: number
}

export function trackUsage(tracker: AutopilotUsageTracker | undefined, usage: TextUsage | undefined, costUsd: number | null): void {
  if (!tracker) return
  tracker.usage = addTextUsage(tracker.usage, usage)
  tracker.costUsd = sumCostUsd(tracker.costUsd, costUsd)
}

function buildStrategySystemPrompt(): string {
  return `You are a senior content strategist specializing in Indian D2C brands.
You create 30-day content calendars that drive engagement, build brand equity, and convert followers to buyers.
Consider platform-specific best practices, posting cadence, content variety, and seasonal relevance.
Always respond with valid JSON only. No markdown, no explanation outside the JSON.`
}

export interface AutopilotParams {
  frequency?: string
  platforms?: string[]
  vibe?: string
  focusAreas?: string[]
  /** How many slots this run should plan for — defaults to 30 (the
   * existing full Autopilot run). Starter's smaller tier passes a
   * smaller number (see PLAN_LIMITS[plan].autopilot in types/app.ts). */
  totalSlots?: number
  /** User's resolved plan — every plan resolves to the same image provider
   * now (see lib/ai/post-image-pipeline.ts's
   * fetchBackgroundImage); still threaded through for credit-charging
   * elsewhere in this flow. Defaults to "starter" if omitted. */
  plan?: UserPlan
  /** Internal owner-bypass — same provider regardless of `plan` (see
   * isInternalUnlimited). Defaults to false if omitted. */
  isInternalUnlimitedUser?: boolean
  /** Epoch ms after which a slot's fact-guard retry is skipped (claim
   * stripped instead) -- set by app/api/v1/brands/fastlane/route.ts so
   * retries can't push a run past its maxDuration. Omitted = no limit. */
  factGuardDeadline?: number
}

export interface StrategyOverview {
  goal: string
  suggested_frequency: string
  week_themes: string[]
}

function buildStrategyOverviewSystemPrompt(): string {
  return `You are a senior content strategist for Indian D2C brands.
Given a brand's identity, produce a short, honest one-month content strategy overview: a stated goal, a suggested posting cadence, and week-by-week themes.
Base the goal strictly on the brand's actual niche, audience, and values provided — never invent facts about the brand that weren't given to you.
Always respond with valid JSON only. No markdown, no explanation.`
}

function buildStrategyOverviewUserPrompt(brand: BrandRow, params?: AutopilotParams): string {
  const context = [
    `Brand: ${brand.name}`,
    brand.niche ? `Niche: ${brand.niche}` : null,
    brand.target_audience ? `Target audience: ${brand.target_audience}` : null,
    brand.tone_of_voice ? `Tone of voice: ${brand.tone_of_voice}` : null,
    brand.brand_values?.length ? `Brand values: ${brand.brand_values.join(", ")}` : null,
    brand.positioning ? `Positioning / What makes this brand different: ${brand.positioning}` : null,
    brand.content_pillars?.length ? `Content pillars: ${brand.content_pillars.join(", ")}` : null,
    brand.target_emotion ? `Target emotion: ${brand.target_emotion}` : null,
    brand.vibe ? `Brand vibe: ${brand.vibe}` : null,
  ].filter(Boolean).join("\n")

  const frequency = params?.frequency ?? brand.posting_frequency ?? null
  const platforms = params?.platforms?.length ? params.platforms : (brand.target_platforms ?? [])

  return `${context}
${frequency ? `User's preferred posting frequency: ${frequency}` : ""}
${platforms.length ? `Target platforms: ${platforms.join(", ")}` : ""}

Synthesize a concise one-month content strategy for this brand:
- goal: one sentence stating the primary objective for this month, inferred from the brand's actual niche/audience/values above — specific to this brand, not generic
- suggested_frequency: one short phrase for posting cadence (respect the user's stated preference above if given, otherwise suggest a sensible one for this niche)
- week_themes: exactly 4 short, punchy weekly focus phrases tied to the stated goal, formatted like "Week 1: <theme>"

Respond with this exact JSON:
{
  "goal": "one sentence goal for the month",
  "suggested_frequency": "e.g. 5 posts/week",
  "week_themes": ["Week 1: ...", "Week 2: ...", "Week 3: ...", "Week 4: ..."]
}`
}

/**
 * A single lightweight model call producing a strategy preview the user
 * confirms BEFORE the full 30-slot generation runs. Cheap to regenerate —
 * unlike executeFastlane below, which this function never touches.
 */
export async function generateStrategyOverview(brand: BrandRow, params?: AutopilotParams): Promise<StrategyOverview> {
  // Moved from Groq to OpenAI (MODELS.creative) in the Phase 1b migration.
  // Short structured preview (goal + frequency + 4 week themes) that still
  // benefits from real reasoning about the brand's specific strategy --
  // "medium", same effort and budget as on Groq (reasoning tokens count
  // against it on gpt-5.5 too).
  const { content } = await createCreativeCompletion({
    stage: "autopilot_strategy_overview",
    logPrefix: "fastlane",
    system: buildStrategyOverviewSystemPrompt(),
    user: buildStrategyOverviewUserPrompt(brand, params),
    reasoningEffort: "medium",
    maxCompletionTokens: 1500,
    // ESTIMATE, not measured (no OPENAI_API_KEY where this was written) --
    // see scripts/test-creative-stages.ts.
    timeoutMs: 30_000,
  })

  const raw = content ?? "{}"
  let cleaned = sanitizeJsonString(raw)
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (jsonMatch) cleaned = jsonMatch[0]

  let parsed: StrategyOverview
  try {
    parsed = JSON.parse(cleaned) as StrategyOverview
  } catch {
    console.error("[fastlane] strategy overview JSON parse failed. Raw:", raw.slice(0, 300))
    throw new Error("AI returned invalid JSON for strategy overview")
  }

  if (!parsed.goal || !Array.isArray(parsed.week_themes) || parsed.week_themes.length === 0) {
    console.error("[fastlane] strategy overview missing required fields:", JSON.stringify(parsed).slice(0, 300))
    throw new Error("AI returned an incomplete strategy overview")
  }

  return parsed
}

/** occurrenceDate is constructed at local midnight (see
 * getFestivalOccasionsInWindow) -- toISOString() converts to UTC first,
 * which shifts the date backward by a day in any positive-UTC-offset
 * timezone (e.g. IST, UTC+5:30: local midnight is 18:30 the *previous* UTC
 * day). Reading the local date components back out avoids that shift. */
function formatLocalDate(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

async function buildStrategyUserPrompt(brand: BrandRow, products: ProductRow[], params?: AutopilotParams): Promise<string> {
  const totalSlots = params?.totalSlots ?? 30
  const productNames = products.map(p => p.name).join(", ")
  const upcomingOccasions = await getUpcomingOccasionsForAutopilot(new Date(), totalSlots)
  const occasionsNote = upcomingOccasions.length > 0
    ? `\nUpcoming occasions in next ${totalSlots} days (plan slots around these):\n${upcomingOccasions.map(o => `- ${o.name} ${o.emoji} (${formatLocalDate(o.occurrenceDate)}): ${o.content_angle} — vibe: ${o.vibe}`).join("\n")}`
    : ""

  const mix = buildContentMix(params?.focusAreas, totalSlots)

  const frequencyNote = params?.frequency
    ? `Posting frequency: ${params.frequency === "3x_week" ? "3 times/week (~13 posts/month)" : params.frequency === "5x_week" ? "5 times/week (~22 posts/month)" : "daily (30 posts/month)"}`
    : ""

  const vibeNote = params?.vibe ? `Overall content vibe preference: ${params.vibe}` : ""

  const platformPref = params?.platforms?.length
    ? `ONLY use these platforms for every single slot, in no other combination: ${params.platforms.join(", ")}. Never output a platform outside this list.`
    : "Vary platforms: 40% instagram, 20% tiktok, 15% linkedin, rest facebook/youtube/twitter"

  return `Create a ${totalSlots}-day content strategy for this brand.

Brand: ${brand.name}
Niche: ${brand.niche ?? "General"}
Audience: ${brand.target_audience ?? "General audience"}
Tone: ${brand.tone_of_voice ?? "Conversational"}
${brand.positioning ? `Positioning / What makes this brand different: ${brand.positioning}` : ""}
${productNames ? `Products: ${productNames}` : ""}
${frequencyNote}
${vibeNote}
${occasionsNote}

REQUIRED content mix — distribute these across ${totalSlots} slots:
${mix.map(m => `- ${m.pillar} (${m.format}): ${m.count} slots`).join("\n")}

Return ONLY this JSON (no markdown, no explanation):
{
  "strategy_summary": "2-3 sentences on the strategy",
  "slots": [
    { "day": 1, "platform": "instagram", "content_type": "hooks", "theme": "Brand intro", "product_focus": null, "priority": "high", "content_pillar": "product" }
  ]
}

Rules:
- Exactly ${totalSlots} slots, days 1-${totalSlots}
- content_type: "hooks" | "caption" | "reel_script" | "carousel" | "ad_copy"
- platform: "instagram" | "tiktok" | "youtube" | "facebook" | "linkedin" | "twitter"
- priority: "high" | "medium" | "low"
- product_focus: product name string or null
- content_pillar: one of ${CONTENT_MIX.map(m => m.pillar).join(" | ")}
- content_type must match the pillar format from the required mix
- DO NOT repeat the same content_pillar twice in a row
- For occasion slots: tie theme to a relevant upcoming occasion if any
- ${platformPref}`
}

interface CarouselSlide {
  slide_number: number
  headline: string
  body: string
  kicker?: string | null
  highlight?: string | null
}

export interface SlotContent {
  title: string
  hook: string
  caption: string
  hashtags: string[]
  visual_direction: string
  audio_suggestion: string
  call_to_action: string
  /** Carousels: plain {headline, body} per slide -- the HTML preview and the plain renderer fallback. */
  slides?: CarouselSlide[]
  scenes?: ReelScene[]
  /** The one angle the model committed to (see SLOT_COPY_RULES) -- informational only, never persisted. */
  angle?: string
  /** On-image extras for the hook (lib/design/text-layouts.ts) -- posts only. */
  kicker?: string | null
  highlight?: string | null
  /** The model that wrote the copy (content events' meta). */
  model?: string
  /** Pre-image quality gate report (lib/ai/quality-gate.ts) -- posts and carousels; recorded via gateEventMeta. */
  gate?: GateReport
  /** Posts: the caption's visual brief, which drives generatePostImage. */
  visual?: VisualBrief
  /** Posts: the image prompt built from that brief (falls back to the caption's image_prompt). */
  imagePrompt?: string
  /** Carousels: the shared generator's slides after the manual route's
   * post-processing (lib/ai/carousel-postprocess.ts) -- typed slides with
   * visual briefs, typography and layouts, for per-slide backgrounds and the
   * rich compositor. Saved as the carousels row's slides. */
  carousel?: { slides: Record<string, unknown>[]; typography: BrandTypography }
}

const SLOT_CONTENT_SYSTEM_PROMPT = "You write Instagram/social copy for Indian D2C brands that stops the scroll. Before writing, pick ONE sharp angle for this post and commit to it. Write like a sharp human creator, not a brand. Respond with valid JSON only. No markdown."

// Shared by all three per-slot builders below. The fact guard
// (lib/ai/fact-guard.ts) still backstops the "never invent facts" rule.
const SLOT_COPY_RULES = `RULES:
ANGLE — pick exactly one: myth vs truth · common mistake · surprising specific detail · before/after · us vs them · "what's trending in [month] for [niche]" · "things you probably missed" · confession/behind the scenes · a hyper-specific real-life situation · conflict ("the X war nobody saw coming"). Return the chosen one in the "angle" field.
HOOK — under 12 words. Must create tension or a curiosity gap. Concrete, not abstract. Don't start with the brand name, "Are you", "Ever wondered", "Introducing", or "Discover".
SPECIFICITY — use at least one real detail from the data above (₹ price, a named benefit, an ingredient, the target customer's situation). NEVER invent facts: no made-up stats, prices, discounts, awards, customer quotes or customer names. If the data is thin, get specific through a relatable everyday Indian situation instead of claims.
CAPTION — short lines separated by line breaks, not one paragraph. The hook is shown above the caption, so the caption's first line continues the hook (don't repeat it). End with the brand's CTA phrase if one is given, else one clear action; call_to_action is that same closing line. No hashtags in the caption — they go in "hashtags" only.
BANNED — elevate, unleash, unlock, discover, embark, journey, game-changer, revolutionize, indulge, "look no further", "say goodbye to", "in today's fast-paced world", "experience the", "dive into", "we've got you covered", three-adjective lists, more than 2 emojis.
TESTIMONIAL pillar — describe a relatable customer situation; never a quote attributed to a person.`

function formatProductPrice(product: ProductRow): string | null {
  if (product.price == null) return null
  return product.currency?.toUpperCase() === "INR" ? `₹${product.price}` : `${product.currency} ${product.price}`
}

// Every non-empty brand/product field the per-slot copy can draw specifics
// from -- one line each, empty fields omitted.
function buildSlotContextLines(brand: BrandRow, product: ProductRow | null): string {
  const lines: string[] = [
    `Brand: ${brand.name}`,
    `Brand niche: ${brand.niche ?? "D2C brand"}`,
    `Brand tone: ${brand.tone_of_voice ?? "conversational"}`,
  ]
  const add = (label: string, value: string | null | undefined) => {
    if (value?.trim()) lines.push(`${label}: ${value.trim()}`)
  }
  add("Brand description", brand.description)
  add("Target audience", brand.target_audience)
  add("Positioning", brand.positioning)
  add("Target emotion", brand.target_emotion)
  add("Brand personality", brand.brand_personality)
  add("Brand values", brand.brand_values?.filter(Boolean).join(", "))
  add("Brand CTA phrase", brand.cta_phrase)
  if (product) {
    add("Product", product.name)
    add("Product description", product.description)
    add("Price", formatProductPrice(product))
    add("Category", product.category)
    add("Key benefits", product.key_benefits?.filter(Boolean).join("; "))
    add("Ingredients", product.ingredients)
    add("Target customer", product.target_customer)
  }
  return lines.join("\n")
}

const PILLAR_DESCRIPTIONS: Record<string, string> = {
  product: "showcase the product's features and benefits compellingly",
  behind_scenes: "reveal what happens behind the brand — authentic and human",
  educational: "teach something genuinely useful to the audience",
  humor_meme: "be witty and relatable — make them laugh or nod",
  occasion: "tie the brand to this occasion naturally without being forced",
  testimonial: "show a relatable customer situation the product fits into — no quotes or named customers",
  announcement: "build excitement around something new or upcoming",
  inspiration: "uplift and motivate — connect values to the audience's aspirations",
  founder_story: "share the brand's origin, mission, or founder journey",
}

/**
 * What one Autopilot slot is about, as the shared generators' brief text
 * (additionalContext for posts, the topic for carousels). It's also part of
 * the fact source, so the product details listed here are claimable facts.
 */
function buildSlotBrief(slot: ContentSlot, product: ProductRow | null, totalSlots: number): string {
  const pillar = slot.content_pillar
  return [
    `Theme: ${slot.theme}`,
    pillar ? `Content pillar: ${pillar} — ${PILLAR_DESCRIPTIONS[pillar] ?? "match the content pillar"}` : "",
    pillar === "testimonial" ? "Describe a relatable customer situation; never a quote attributed to a person." : "",
    product ? `Product focus: ${product.name}${formatProductPrice(product) ? ` (${formatProductPrice(product)})` : ""}${product.description?.trim() ? ` — ${product.description.trim()}` : ""}` : "",
    product?.key_benefits?.filter(Boolean).length ? `Key benefits: ${product.key_benefits.filter(Boolean).join("; ")}` : "",
    `This is Autopilot slot ${slot.day} of ${totalSlots}: take a different angle from this brand's other posts this month.`,
  ].filter(Boolean).join("\n")
}

function buildReelScriptSlotContentPrompt(brand: BrandRow, slot: ContentSlot, product: ProductRow | null, totalSlots: number): string {
  const pillarCtx = slot.content_pillar ? `\nContent Pillar: ${slot.content_pillar}` : ""

  return `Create a complete short-form reel script for ${brand.name} on ${slot.platform}.
${buildSlotContextLines(brand, product)}
Theme: ${slot.theme}${pillarCtx}
Day: ${slot.day} of ${totalSlots}

IMPORTANT: This is slot ${slot.day}/${totalSlots}. Make it UNIQUE — different angle than typical posts for this brand.

${SLOT_COPY_RULES}

Break the reel into 3-5 scenes totaling 15-30 seconds (3-8 seconds each). Each scene needs exactly what the viewer sees (visual_direction) and exactly what's heard or read on screen (voiceover_or_text_overlay). The first scene's voiceover/text delivers the hook.

Return this exact JSON:
{"angle":"the one angle you picked","title":"post title","hook":"the hook, per HOOK rules","caption":"caption as short lines separated by \\n, per CAPTION rules","hashtags":["hashtag1","hashtag2","hashtag3","hashtag4","hashtag5"],"visual_direction":"one-line overall visual style/mood for the reel","audio_suggestion":"suggested background music mood or sound","call_to_action":"the caption's closing action line","scenes":[{"visual_direction":"what the viewer sees in this scene","voiceover_or_text_overlay":"spoken words or on-screen text for this scene","duration_seconds":5}]}`
}

export async function generateContentStrategy(brand: BrandRow, products: ProductRow[], params?: AutopilotParams, tracker?: AutopilotUsageTracker): Promise<ContentStrategy> {
  const userPrompt = await buildStrategyUserPrompt(brand, products, params)
  // Moved from Groq to OpenAI (MODELS.creative) in the Phase 1b migration.
  // The big 30-day/30-slot planner -- measured on Groq's gpt-oss-120b with
  // a comparable 30-slot test JSON consuming 4685/12000 total tokens (3128
  // of them reasoning) -- "medium" for real cross-slot planning coherence,
  // same budget. The SDK's own maxRetries: 1 (inside
  // createCreativeCompletion) replaces the old Groq-specific 429 retry
  // wrapper; it also honors OpenAI's retry-after header.
  const { content, usage, costUsd } = await createCreativeCompletion({
    stage: "autopilot_strategy",
    logPrefix: "fastlane",
    system: buildStrategySystemPrompt(),
    user: userPrompt,
    reasoningEffort: "medium",
    maxCompletionTokens: 12000,
    // ESTIMATE, not measured (no OPENAI_API_KEY where this was written) --
    // see scripts/test-creative-stages.ts. The single slowest text call in
    // the app (~4-5k completion tokens at medium effort); generous, but
    // still well inside app/api/v1/brands/fastlane/route.ts's
    // maxDuration=300 for the run as a whole. 60s since the 2026-10-26 move
    // back to Groq gpt-oss-120b, which is much faster than gpt-5.5 was.
    timeoutMs: 60_000,
  })

  trackUsage(tracker, usage, costUsd)
  const raw: string = content ?? "{}"
  let cleaned = sanitizeJsonString(raw)
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (jsonMatch) cleaned = jsonMatch[0]
  let parsed: ContentStrategy
  try {
    parsed = JSON.parse(cleaned) as ContentStrategy
  } catch {
    console.error("[fastlane] JSON parse failed. Raw:", raw.slice(0, 500))
    throw new Error("AI returned invalid JSON for content strategy")
  }

  if (!Array.isArray(parsed.slots) || parsed.slots.length === 0) {
    console.error("[fastlane] No slots in response:", JSON.stringify(parsed).slice(0, 300))
    throw new Error("AI returned strategy with no content slots")
  }

  // Safety net for the "ONLY use these platforms" instruction above --
  // guarantees the constraint even if the model ignores it. Any slot whose
  // platform isn't in the allowed list gets round-robin reassigned to one
  // that is, rather than dropped or left violating the user's explicit
  // platform selection.
  if (params?.platforms?.length) {
    const allowed = params.platforms
    parsed.slots = parsed.slots.map((slot, i) =>
      allowed.includes(slot.platform) ? slot : { ...slot, platform: allowed[i % allowed.length] as Platform }
    )
  }

  return parsed
}

// Lightweight sanity pass over every real text field this generator
// produces, before it's persisted -- see lib/ai/content-quality-check.ts
// for what this catches (leaked "✓"/"✗" formatting markers, unfilled
// "[Placeholder]" brackets, raw template expressions, a stray unattached
// "x"). Autopilot has no per-slot validate-and-retry loop (re-running an
// entire day's content over one bad word in one field would be a much
// heavier fix than the problem warrants, and this whole function already
// has its own JSON.parse-then-regex-fallback tier), so this is a
// mechanical fix-in-place, logged loudly whenever it actually changes
// something.
function sanitizeSlotContent(content: SlotContent): SlotContent {
  const fix = (value: string): string => {
    if (findContentQualityIssues(value).length === 0) return value
    const cleaned = sanitizeLeakedArtifacts(value)
    console.error(`[fastlane] stripped leaked artifact(s) from generated text: ${JSON.stringify(value)} -> ${JSON.stringify(cleaned)}`)
    return cleaned
  }
  return {
    ...content,
    title: fix(content.title),
    hook: fix(content.hook),
    caption: fix(content.caption),
    visual_direction: fix(content.visual_direction),
    audio_suggestion: fix(content.audio_suggestion),
    call_to_action: fix(content.call_to_action),
    slides: content.slides?.map((s) => ({ ...s, headline: fix(s.headline), body: fix(s.body) })),
  }
}

/**
 * One Autopilot slot's copy. Posts and carousels go through the same shared
 * generators the manual flows use -- plan, visual brief, fact guard and the
 * pre-image quality gate -- and are mapped into this worker-facing shape;
 * reels (REELS_ENABLED is false) keep the single-shot path below.
 */
export async function generateSlotContent(
  brand: BrandRow,
  slot: ContentSlot,
  product: ProductRow | null,
  totalSlots: number,
  tracker?: AutopilotUsageTracker,
  factGuardDeadline?: number,
  /** Brand lessons for this slot's scope (lib/ai/brand-brain.ts), fetched by the worker. */
  lessons?: BrandLesson[],
  /** Posts only: "hook"-scope lessons for the hook generator. */
  hookLessons?: BrandLesson[],
): Promise<SlotContent> {
  if (slot.content_type === "reel_script") return generateReelSlotContent(brand, slot, product, totalSlots, tracker, factGuardDeadline, lessons)
  if (slot.content_type === "carousel") return generateCarouselSlot(brand, slot, product, totalSlots, tracker, factGuardDeadline, lessons)
  // hooks / caption / ad_copy are all a full post with an image.
  return generatePostSlot(brand, slot, product, totalSlots, tracker, factGuardDeadline, lessons, hookLessons)
}

// Same opener the post pipeline uses for an abstract_mood brief.
const POST_BRIEF_ABSTRACT_OPENER = "abstract atmospheric background image for a social media post"

/** The image prompt a post's visual brief makes -- what the brief says to show, where. */
function briefImagePrompt(brief: VisualBrief): string {
  return `${briefScene(brief, POST_BRIEF_ABSTRACT_OPENER)}${brief.composition ? `, composition: ${brief.composition}` : ""}`
}

// Post slot: the Full Post caption (post_plan, visual brief, image prompt,
// quality gate), then the hook written from its plan (lib/ai/post-copy.ts).
async function generatePostSlot(
  brand: BrandRow,
  slot: ContentSlot,
  product: ProductRow | null,
  totalSlots: number,
  tracker: AutopilotUsageTracker | undefined,
  factGuardDeadline: number | undefined,
  lessons: BrandLesson[] | undefined,
  hookLessons: BrandLesson[] | undefined,
): Promise<SlotContent> {
  const brief = buildSlotBrief(slot, product, totalSlots)
  // Each call's usage is tracked as it completes (onUsage).
  const { caption: contentResult, hook: hookResult } = await generatePostCopy(brand, {
    product, platform: slot.platform, additionalContext: brief, factGuardDeadline,
    captionLessons: lessons, hookLessons,
    onUsage: (_step, usage, costUsd) => trackUsage(tracker, usage, costUsd),
  })

  const hook = hookResult.hooks[0]?.hook_text?.trim()
  if (!hook) throw new Error("Hook generation returned no results")
  const caption = contentResult.data as GeneratedCaption
  const visual = caption.visual ?? undefined
  const imagePrompt = visual ? briefImagePrompt(visual) : caption.image_prompt?.trim() || undefined
  return {
    title: slot.theme,
    hook,
    caption: caption.caption_text,
    hashtags: caption.hashtags ?? [],
    visual_direction: imagePrompt ?? "",
    audio_suggestion: "",
    call_to_action: caption.cta ?? "",
    kicker: caption.kicker ?? null,
    highlight: caption.highlight ?? null,
    model: contentResult.model,
    gate: contentResult.gate,
    visual,
    imagePrompt,
  }
}

const AUTOPILOT_CAROUSEL_SLIDES = 5

/**
 * The carousel's caption, built from its own (guarded, gated) copy: the
 * plan's takeaway and each content slide's headline. The shared generator
 * writes no caption (the manual builder has the user write one), and an
 * entry with no caption can't publish. The worker merges the hook and CTA in.
 */
function carouselCaption(d: Record<string, unknown>, slides: Record<string, unknown>[]): string {
  const plan = d.narrative_plan as { takeaway?: unknown } | undefined
  const takeaway = typeof plan?.takeaway === "string" ? plan.takeaway.trim() : ""
  const points = slides
    .filter((s) => s.type === "content" && typeof s.headline === "string" && s.headline.trim())
    .map((s) => `→ ${(s.headline as string).trim()}`)
  return [takeaway, points.join("\n")].filter(Boolean).join("\n\n")
}

// Carousel slot: the manual carousel generator + the manual route's
// post-processing (CTA merge, vibe backgrounds, typography, layouts). The
// worker makes each slide's background from its visual brief.
async function generateCarouselSlot(
  brand: BrandRow,
  slot: ContentSlot,
  product: ProductRow | null,
  totalSlots: number,
  tracker: AutopilotUsageTracker | undefined,
  factGuardDeadline: number | undefined,
  lessons: BrandLesson[] | undefined,
): Promise<SlotContent> {
  let gen: Awaited<ReturnType<typeof generateCarouselWithRetry>>
  try {
    gen = await generateCarouselWithRetry(brand, buildSlotBrief(slot, product, totalSlots), AUTOPILOT_CAROUSEL_SLIDES, slot.platform, undefined, [], lessons, factGuardDeadline)
  } catch (err) {
    // Billed calls that still failed are tracked before the slot fails.
    if (err instanceof UsageCarryingError) trackUsage(tracker, err.usage, err.costUsd)
    throw err
  }
  trackUsage(tracker, gen.usage, gen.costUsd)

  const d = gen.data as Record<string, unknown>
  if (!Array.isArray(d.slides) || d.slides.length === 0) throw new Error("AI returned no carousel slides")
  const realHandle = brand.instagram_handle ? `@${brand.instagram_handle}` : undefined
  const finished = finishGeneratedCarousel(d, brand, { realHandle })
  const slides = finished.slides
  const cta = slides.find((s) => s.type === "cta")
  const hook = (typeof finished.coverHook === "string" && finished.coverHook.trim()) || (typeof slides[0]?.headline === "string" ? slides[0].headline : "") || slot.theme
  const text = (v: unknown) => (typeof v === "string" ? v : "")

  return {
    title: (typeof finished.title === "string" && finished.title.trim()) || slot.theme,
    hook,
    caption: carouselCaption(d, slides),
    hashtags: Array.isArray(d.hashtags) ? d.hashtags.filter((h): h is string => typeof h === "string").map((h) => h.replace(/^#+/, "")) : [],
    visual_direction: text((slides[0]?.visual as { must_show?: unknown } | undefined)?.must_show),
    audio_suggestion: "",
    call_to_action: text(cta?.cta),
    slides: slides.map((s, i) => ({
      slide_number: i + 1,
      headline: text(s.headline),
      body: text(s.subtext) || (Array.isArray(s.points) ? s.points.filter((p): p is string => typeof p === "string").join(" · ") : "") || text(s.cta),
      kicker: typeof s.kicker === "string" ? s.kicker : null,
      highlight: typeof s.highlight === "string" ? s.highlight : null,
    })),
    model: gen.model,
    gate: gen.gate,
    carousel: { slides, typography: finished.typography },
  }
}

// Reel slot (REELS_ENABLED is false): the original single-shot generation,
// unchanged -- one creative call, the fact guard, a regex fallback.
async function generateReelSlotContent(
  brand: BrandRow,
  slot: ContentSlot,
  product: ProductRow | null,
  totalSlots: number,
  tracker?: AutopilotUsageTracker,
  factGuardDeadline?: number,
  lessons?: BrandLesson[],
): Promise<SlotContent> {
  // Moved from Groq to OpenAI (MODELS.creative) in the Phase 1b migration.
  const stage = `autopilot_slot_${slot.content_type}`
  const callParams = {
    stage,
    logPrefix: "fastlane",
    system: SLOT_CONTENT_SYSTEM_PROMPT,
    user: withLessons(buildReelScriptSlotContentPrompt(brand, slot, product, totalSlots), lessons),
    reasoningEffort: "low" as const,
    maxCompletionTokens: 1800,
    // ESTIMATE, not measured (no OPENAI_API_KEY where this was written) --
    // see scripts/test-creative-stages.ts. Kept tight: the slot shares its
    // lease with the rest of the worker's steps.
    timeoutMs: 30_000,
  }
  const { content, usage, costUsd } = await createCreativeCompletion(callParams)

  trackUsage(tracker, usage, costUsd)
  const raw: string = content ?? ""
  const cleaned = extractSlotJson(raw)
  const facts = buildFactSource({ brand, product, brief: [slot.theme, slot.product_focus] })

  let parsed: SlotContent
  try {
    parsed = parseSlotJson(raw, false, true)
  } catch {
    parsed = slotContentFromRegex(cleaned, brand, slot)
    // No corrective retry on this path (the model's JSON was already
    // broken) -- strip-only fact guard instead.
    return stripGuard(stage, parsed, facts)
  }

  // Fact guard (lib/ai/fact-guard.ts): one corrective retry when the run's
  // time budget allows, then strip. Fail-soft.
  return guardCopy({
    stage,
    data: parsed,
    facts,
    normalTimeoutMs: callParams.timeoutMs,
    deadline: factGuardDeadline,
    retry: async (correction, timeoutMs) => {
      const retry = await createCreativeCompletion({ ...callParams, timeoutMs, followUp: { previous: raw, correction } })
      trackUsage(tracker, retry.usage, retry.costUsd)
      return parseSlotJson(retry.content ?? "", false, true)
    },
  })
}

function extractSlotJson(raw: string): string {
  let cleaned = sanitizeJsonString(raw)
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (jsonMatch) cleaned = jsonMatch[0]
  return cleaned
}

function parseSlotJson(raw: string, isCarousel: boolean, isReel: boolean): SlotContent {
  const parsed = JSON.parse(extractSlotJson(raw)) as SlotContent
  if (isCarousel && parsed.slides !== undefined && !Array.isArray(parsed.slides)) {
    parsed.slides = []
  }
  if (isReel && parsed.scenes !== undefined && !Array.isArray(parsed.scenes)) {
    parsed.scenes = []
  }
  return sanitizeSlotContent(parsed)
}

function slotContentFromRegex(cleaned: string, brand: BrandRow, slot: ContentSlot): SlotContent {
  // Regex fallback for malformed JSON -- see extractJsonStringValue's own
  // comment for why this no longer uses a bare `[^"]*`-style capture
  // group (that silently truncated any field containing a literal quote
  // character).
  const caption = extractJsonStringValue(cleaned, "caption")

  let hashtags: string[] = []
  const hashtagsMatch = cleaned.match(/"hashtags"\s*:\s*\[([^\]]*)\]/)
  if (hashtagsMatch) {
    hashtags = hashtagsMatch[1]
      .split(",")
      .map(h => h.trim().replace(/^"|"$/g, "").replace(/^#/, "").trim())
      .filter(Boolean)
  }

  return sanitizeSlotContent({
    title: extractJsonStringValue(cleaned, "title") ?? slot.theme,
    hook: extractJsonStringValue(cleaned, "hook") ?? `${slot.theme} — you need to see this`,
    // extractJsonStringValue already ran the matched text through
    // JSON.parse, so a real newline character (not the literal two-byte
    // "\n" escape the old code matched) is what needs flattening here.
    caption: caption?.replace(/\n/g, " ") ?? `${brand.name} brings you ${slot.theme}.`,
    hashtags,
    visual_direction: extractJsonStringValue(cleaned, "visual_direction") ?? "",
    audio_suggestion: extractJsonStringValue(cleaned, "audio_suggestion") ?? "",
    call_to_action: extractJsonStringValue(cleaned, "call_to_action") ?? "",
    slides: [],
    scenes: [],
  })
}

// Same filtering as parseScenes() in
// reel-scripts/[scriptId]/video/route.ts, applied to the AI's freshly
// parsed JSON instead of a stored Json column — scenes missing a real
// visual_direction are dropped rather than fed into Kling with nothing to
// generate from.
export function normalizeReelScenes(raw: unknown): ReelScene[] {
  if (!Array.isArray(raw)) return []
  const scenes: ReelScene[] = []
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue
    const s = item as Record<string, unknown>
    const visual_direction = typeof s.visual_direction === "string" ? s.visual_direction.trim() : ""
    if (!visual_direction) continue
    scenes.push({
      visual_direction,
      voiceover_or_text_overlay: typeof s.voiceover_or_text_overlay === "string" ? s.voiceover_or_text_overlay : "",
      duration_seconds: typeof s.duration_seconds === "number" && s.duration_seconds > 0 ? s.duration_seconds : 5,
    })
  }
  return scenes
}

interface SubmitAutopilotReelInput {
  brandId: string
  scriptId: string
  jobId: string
  calendarEntryId: string
  scenes: ReelScene[]
}

/**
 * Submits one Kling video job per scene (webhook-driven, see
 * lib/video/kling-client.ts) plus each scene's TTS voiceover — mirrors
 * reel-scripts/[scriptId]/video/route.ts's own after() callback exactly.
 * Actual completion (JSON2Video render, writing the finished video back
 * into this reel's calendar entry) is handled centrally by
 * app/api/v1/webhooks/kling/route.ts once every scene has reported in, via
 * reel_video_jobs.calendar_entry_id (set on the job row right after the
 * calendar entry itself is inserted — see executeFastlane below). This
 * function only needs to handle the case where every single scene fails to
 * even submit, since then no webhook will ever arrive to report that.
 * Deferred into the caller's after() so it runs post-response.
 */
export async function submitAutopilotReel(input: SubmitAutopilotReelInput): Promise<void> {
  const admin = await createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jobsTable = (admin as any).from("reel_video_jobs")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entriesTable = (admin as any).from("calendar_entries")

  const failEntry = async (message: string) => {
    const { data: current } = await entriesTable
      .select("platform_specific_data")
      .eq("id", input.calendarEntryId)
      .single()
    const existing = (current?.platform_specific_data ?? {}) as Record<string, unknown>
    await entriesTable
      .update({ platform_specific_data: { ...existing, content_format: "video", video_status: "failed", video_error: message } })
      .eq("id", input.calendarEntryId)
  }

  if (!process.env.NEXT_PUBLIC_APP_URL || !process.env.KLING_WEBHOOK_SECRET) {
    console.error(`[fastlane] reel job ${input.jobId}: NEXT_PUBLIC_APP_URL or KLING_WEBHOOK_SECRET not configured`)
    await jobsTable
      .update({ status: "failed", progress_message: null, error_message: "Video generation isn't configured yet." })
      .eq("id", input.jobId)
    await failEntry("Video generation isn't configured yet.")
    return
  }

  const webhookConfig: KlingWebhookConfig = {
    endpoint: `${process.env.NEXT_PUBLIC_APP_URL}/api/v1/webhooks/kling`,
    secret: process.env.KLING_WEBHOOK_SECRET,
  }

  try {
    await jobsTable
      .update({ status: "generating_images", progress_message: "Generating AI video scenes and voiceover, this can take a few minutes…" })
      .eq("id", input.jobId)

    const result = await submitSceneAssetJobs(admin, input.brandId, input.scriptId, input.jobId, input.scenes, undefined, webhookConfig)

    if (result.pendingCount === 0) {
      console.error(`[fastlane] reel job ${input.jobId}: all ${result.totalScenes} scene(s) failed to submit`)
      await jobsTable
        .update({
          status: "failed",
          progress_message: null,
          error_message: "Couldn't generate any usable scene assets for this video.",
        })
        .eq("id", input.jobId)
      await failEntry("Couldn't generate any usable scene assets for this video.")
      return
    }

    await jobsTable
      .update({
        status: "generating_voiceover",
        progress_message:
          result.immediateFailureCount > 0
            ? `${result.immediateFailureCount} scene(s) failed to start — generating the rest…`
            : "Generating AI video scenes — this can take a few minutes…",
      })
      .eq("id", input.jobId)
  } catch (err) {
    console.error(`[fastlane] reel job ${input.jobId} submit failed:`, err instanceof Error ? err.message : err)
    await jobsTable
      .update({ status: "failed", progress_message: null, error_message: "Video generation failed." })
      .eq("id", input.jobId)
    await failEntry("Video generation failed.")
  }
}
