import { after } from "next/server"
import { MODELS, getGroqClient } from "./models"
import { generateCarouselHtml } from "@/lib/design/post-card-generator"
import { getUpcomingOccasions } from "@/lib/data/indian-occasions"
import { generatePostImage } from "@/lib/ai/post-image-pipeline"
import { DEFAULT_POST_TEMPLATE_ID } from "@/lib/design/post-templates"
import { resolveColorThemes } from "@/lib/design/color-themes"
import { mergeCaptionWithHookAndCta } from "@/lib/utils/caption-merge"
import { submitSceneAssetJobs } from "@/lib/video/reel-scene-assets"
import type { KlingWebhookConfig } from "@/lib/video/kling-client"
import { MUSIC_OPTIONS, resolveMusicTrackId } from "@/lib/video/music-options"
import { renderCarouselSlidesToPng } from "@/lib/image/carousel-compositor"
import { uploadMediaToStorage } from "@/lib/storage/upload-media"
import { createAdminClient } from "@/lib/supabase/server"
import { POST as POST_CREDIT_COST, CAROUSEL as CAROUSEL_CREDIT_COST } from "@/lib/usage/credit-costs"
import type { BrandRow, ProductRow, CalendarEntryRow, Json } from "@/types/database"
import type { ContentStrategy, ContentSlot, FastlaneResult, Platform, ReelScene, UserPlan } from "@/types/app"
import type { SupabaseClient } from "@supabase/supabase-js"

// Same bucket used by app/api/v1/ai/post-image/generate/route.ts — Autopilot
// images go through the same pipeline and land in the same place.
const IMAGE_BUCKET = "brand-images"

// Matches schedulePostSchema's MIN_CAROUSEL_IMAGES in
// app/api/v1/calendar/schedule-post/route.ts — Instagram's own minimum for
// a carousel post.
const MIN_CAROUSEL_SLIDES = 2

const CONTENT_MIX = [
  { pillar: "product", format: "carousel" as const, count: 5, description: "Showcase products, features, and benefits" },
  { pillar: "behind_scenes", format: "reel_script" as const, count: 4, description: "Behind the scenes, team, how it's made" },
  { pillar: "educational", format: "carousel" as const, count: 4, description: "Tips, how-to, industry insights" },
  { pillar: "humor_meme", format: "hooks" as const, count: 3, description: "Relatable humor, meme-style content" },
  { pillar: "occasion", format: "hooks" as const, count: 4, description: "Occasion and trending moment content" },
  { pillar: "testimonial", format: "hooks" as const, count: 3, description: "Customer stories, reviews, social proof" },
  { pillar: "announcement", format: "hooks" as const, count: 3, description: "New launches, offers, announcements" },
  { pillar: "inspiration", format: "hooks" as const, count: 2, description: "Quotes, motivation, brand values" },
  { pillar: "founder_story", format: "reel_script" as const, count: 2, description: "Founder journey, brand origin story" },
]

function sanitizeJsonString(raw: string): string {
  return raw
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim()
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateWithRetry(groq: ReturnType<typeof getGroqClient>, params: any, retries = 1): Promise<any> {
  try {
    return await groq.chat.completions.create(params)
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()
    const isRateLimit = msg.includes("429") || msg.includes("rate_limit") || msg.includes("rate limit")
    if (retries > 0 && isRateLimit) {
      console.log("[fastlane] Rate limit hit, waiting 3000ms before retry...")
      await sleep(3000)
      return generateWithRetry(groq, params, retries - 1)
    }
    throw err
  }
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
   * existing full Autopilot run). The free plan's scaled preview passes a
   * smaller number (see PLAN_LIMITS[plan].autopilot in types/app.ts). */
  totalSlots?: number
  /** User's resolved plan — determines the image provider for every
   * slot's post image (see lib/ai/post-image-pipeline.ts's
   * resolveImageProvider). Defaults to "free" if omitted. */
  plan?: UserPlan
  /** Internal owner-bypass — always gets Flux regardless of `plan` (see
   * isInternalUnlimited). Defaults to false if omitted. */
  isInternalUnlimitedUser?: boolean
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
 * A single lightweight Groq call producing a strategy preview the user
 * confirms BEFORE the full 30-slot generation runs. Cheap to regenerate —
 * unlike executeFastlane below, which this function never touches.
 */
export async function generateStrategyOverview(brand: BrandRow, params?: AutopilotParams): Promise<StrategyOverview> {
  const groq = getGroqClient()
  // GPT-OSS reasoning tokens count against max_tokens. Short structured
  // preview (goal + frequency + 4 week themes) that still benefits from
  // real reasoning about the brand's specific strategy -- "medium". Budget
  // raised well past the old Llama-era 500.
  const res = await groq.chat.completions.create({
    model: MODELS.generation,
    temperature: 0.7,
    reasoning_effort: "medium",
    max_tokens: 1500,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildStrategyOverviewSystemPrompt() },
      { role: "user", content: buildStrategyOverviewUserPrompt(brand, params) },
    ],
  })

  const raw = res.choices[0]?.message?.content ?? "{}"
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

/** Scales a content mix (whose counts sum to `sourceTotal`) down to sum to
 * `targetTotal` instead — proportional per category, with the leftover
 * from rounding handed to the categories with the largest fractional
 * remainder first (so the result still sums exactly to targetTotal).
 * Categories that round down to 0 are dropped entirely, since a "0 slots"
 * line in the prompt's required-mix list only confuses the model. Used for
 * the free plan's scaled Autopilot preview (e.g. 5 slots instead of 30) —
 * a no-op when targetTotal already matches sourceTotal. */
function scaleMix(mix: typeof CONTENT_MIX, targetTotal: number): typeof CONTENT_MIX {
  const sourceTotal = mix.reduce((sum, m) => sum + m.count, 0)
  if (sourceTotal === 0 || targetTotal === sourceTotal) return mix

  const exact = mix.map(m => (m.count / sourceTotal) * targetTotal)
  const floored = mix.map((m, i) => ({ ...m, count: Math.floor(exact[i]!) }))
  let remainder = targetTotal - floored.reduce((sum, m) => sum + m.count, 0)

  const byFraction = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac)
  for (let k = 0; k < byFraction.length && remainder > 0; k++) {
    floored[byFraction[k]!.i]!.count++
    remainder--
  }

  return floored.filter(m => m.count > 0)
}

function buildContentMix(focusAreas?: string[], totalSlots = 30): typeof CONTENT_MIX {
  const base = (() => {
    if (!focusAreas?.length) return CONTENT_MIX
    // Weight selected focus areas more heavily
    const selected = CONTENT_MIX.filter(m => focusAreas.includes(m.pillar))
    const others = CONTENT_MIX.filter(m => !focusAreas.includes(m.pillar))
    if (!selected.length) return CONTENT_MIX
    // Redistribute: selected pillars get ~70% of slots, others get ~30%
    // (always computed against a base of 30, then scaled to totalSlots
    // below — keeps this ratio identical regardless of plan tier).
    const total = 30
    const selectedTotal = Math.round(total * 0.7)
    const othersTotal = total - selectedTotal
    const perSelected = Math.floor(selectedTotal / selected.length)
    const perOthers = others.length ? Math.floor(othersTotal / others.length) : 0
    return [
      ...selected.map(m => ({ ...m, count: perSelected })),
      ...others.map(m => ({ ...m, count: perOthers })),
    ]
  })()

  return totalSlots === 30 ? base : scaleMix(base, totalSlots)
}

// Real per-slot-type credit cost — line 762 below shows every content_type
// EXCEPT "carousel" and "reel_script" routes through generatePostImage,
// i.e. is really a full bundled Post regardless of what its content_type
// label says (confirmed: "ad_copy" here still produces a caption+hashtags
// post with an image, NOT the standalone {headline,primary_text,description,
// cta_button} Ad Copy format used elsewhere — same string, different
// shape, a pre-existing naming collision in the content_type enum this
// wasn't the place to rename). reel_script intentionally stays at the
// pre-existing flat rate of 1 credit/slot: Reel credit logic
// (checkAndIncrementReelUsage, REELS_ENABLED) is explicitly out of scope
// for this change, so reel slots' contribution to the total is left at
// their historical implicit per-slot rate rather than inventing a new
// Reel weight here.
const SLOT_CONTENT_TYPE_CREDIT_COST: Record<string, number> = {
  hooks: POST_CREDIT_COST,
  caption: POST_CREDIT_COST,
  ad_copy: POST_CREDIT_COST,
  carousel: CAROUSEL_CREDIT_COST,
  reel_script: 1,
}

/**
 * The real weighted Autopilot cost for a run of `totalSlots` slots
 * (optionally narrowed by `focusAreas`) — sums each slot's actual weighted
 * content-type cost rather than a flat per-tier number, per
 * docs/research (weighted credit costs replace flat 1-credit-per-generation).
 * Exported so app/api/v1/brands/fastlane/route.ts can both pre-flight
 * check affordability and charge the real total against the exact same
 * mix buildStrategyUserPrompt/executeFastlane actually use, instead of
 * duplicating buildContentMix's mix-selection logic or drifting out of
 * sync with it.
 */
export function estimateAutopilotCreditCost(focusAreas?: string[], totalSlots = 30): number {
  const mix = buildContentMix(focusAreas, totalSlots)
  return mix.reduce((sum, m) => sum + m.count * (SLOT_CONTENT_TYPE_CREDIT_COST[m.format] ?? 1), 0)
}

function buildStrategyUserPrompt(brand: BrandRow, products: ProductRow[], params?: AutopilotParams): string {
  const totalSlots = params?.totalSlots ?? 30
  const productNames = products.map(p => p.name).join(", ")
  const upcomingOccasions = getUpcomingOccasions(new Date(), totalSlots)
  const occasionsNote = upcomingOccasions.length > 0
    ? `\nUpcoming occasions in next ${totalSlots} days (plan slots around these):\n${upcomingOccasions.map(o => `- ${o.name} ${o.emoji} (${o.date}): ${o.content_angle} — vibe: ${o.vibe}`).join("\n")}`
    : ""

  const mix = buildContentMix(params?.focusAreas, totalSlots)

  const frequencyNote = params?.frequency
    ? `Posting frequency: ${params.frequency === "3x_week" ? "3 times/week (~13 posts/month)" : params.frequency === "5x_week" ? "5 times/week (~22 posts/month)" : "daily (30 posts/month)"}`
    : ""

  const vibeNote = params?.vibe ? `Overall content vibe preference: ${params.vibe}` : ""

  const platformPref = params?.platforms?.length
    ? `Preferred platforms: ${params.platforms.join(", ")} (weight these more heavily)`
    : "Vary platforms: 40% instagram, 20% tiktok, 15% linkedin, rest facebook/youtube/twitter"

  return `Create a ${totalSlots}-day content strategy for this brand.

Brand: ${brand.name}
Niche: ${brand.niche ?? "General"}
Audience: ${brand.target_audience ?? "General audience"}
Tone: ${brand.tone_of_voice ?? "Conversational"}
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
}

interface SlotContent {
  title: string
  hook: string
  caption: string
  hashtags: string[]
  visual_direction: string
  audio_suggestion: string
  call_to_action: string
  slides?: CarouselSlide[]
  scenes?: ReelScene[]
}

function buildSlotContentPrompt(brand: BrandRow, slot: ContentSlot, product: ProductRow | null, totalSlots: number): string {
  const productCtx = product
    ? `\nProduct: ${product.name}${product.description ? ` - ${product.description}` : ""}`
    : ""
  const pillarCtx = slot.content_pillar ? `\nContent Pillar: ${slot.content_pillar}` : ""
  const pillarDescriptions: Record<string, string> = {
    product: "showcase the product's features and benefits compellingly",
    behind_scenes: "reveal what happens behind the brand — authentic and human",
    educational: "teach something genuinely useful to the audience",
    humor_meme: "be witty and relatable — make them laugh or nod",
    occasion: "tie the brand to this occasion naturally without being forced",
    testimonial: "share a customer success story or social proof angle",
    announcement: "build excitement around something new or upcoming",
    inspiration: "uplift and motivate — connect values to the audience's aspirations",
    founder_story: "share the brand's origin, mission, or founder journey",
  }
  const pillarInstruction = slot.content_pillar
    ? `This post should specifically: ${pillarDescriptions[slot.content_pillar] ?? "match the content pillar"}`
    : ""

  return `Create a complete ${slot.content_type} post for ${brand.name} on ${slot.platform}.
Brand niche: ${brand.niche ?? "D2C brand"}
Brand tone: ${brand.tone_of_voice ?? "conversational"}
Theme: ${slot.theme}${productCtx}${pillarCtx}
Day: ${slot.day} of ${totalSlots}${pillarInstruction ? `\n${pillarInstruction}` : ""}

IMPORTANT: This is slot ${slot.day}/${totalSlots}. Make it UNIQUE — different angle than typical posts for this brand.

Return this exact JSON:
{"title":"post title","hook":"attention-grabbing opening line that stops the scroll","caption":"full post caption (2-4 sentences, brand voice, ends with CTA)","hashtags":["hashtag1","hashtag2","hashtag3","hashtag4","hashtag5"],"visual_direction":"describe the ideal image/video for this post","audio_suggestion":"suggested background music mood or sound","call_to_action":"specific action you want the audience to take"}`
}

function buildReelScriptSlotContentPrompt(brand: BrandRow, slot: ContentSlot, product: ProductRow | null, totalSlots: number): string {
  const productCtx = product
    ? `\nProduct: ${product.name}${product.description ? ` - ${product.description}` : ""}`
    : ""
  const pillarCtx = slot.content_pillar ? `\nContent Pillar: ${slot.content_pillar}` : ""

  return `Create a complete short-form reel script for ${brand.name} on ${slot.platform}.
Brand niche: ${brand.niche ?? "D2C brand"}
Brand tone: ${brand.tone_of_voice ?? "conversational"}
Theme: ${slot.theme}${productCtx}${pillarCtx}
Day: ${slot.day} of ${totalSlots}

IMPORTANT: This is slot ${slot.day}/${totalSlots}. Make it UNIQUE — different angle than typical posts for this brand.

Break the reel into 3-5 scenes totaling 15-30 seconds (3-8 seconds each). Each scene needs exactly what the viewer sees (visual_direction) and exactly what's heard or read on screen (voiceover_or_text_overlay).

Return this exact JSON:
{"title":"post title","hook":"attention-grabbing opening line that stops the scroll","caption":"full post caption (2-4 sentences, brand voice, ends with CTA)","hashtags":["hashtag1","hashtag2","hashtag3","hashtag4","hashtag5"],"visual_direction":"one-line overall visual style/mood for the reel","audio_suggestion":"suggested background music mood or sound","call_to_action":"specific action you want the audience to take","scenes":[{"visual_direction":"what the viewer sees in this scene","voiceover_or_text_overlay":"spoken words or on-screen text for this scene","duration_seconds":5}]}`
}

function buildCarouselSlotContentPrompt(brand: BrandRow, slot: ContentSlot, product: ProductRow | null): string {
  const productCtx = product
    ? `\nProduct: ${product.name}${product.description ? ` - ${product.description}` : ""}`
    : ""
  return `Create a 5-slide carousel post for ${brand.name} on ${slot.platform}.
Brand niche: ${brand.niche ?? "D2C brand"}
Brand tone: ${brand.tone_of_voice ?? "conversational"}
Theme: ${slot.theme}${productCtx}

Return this exact JSON (exactly 5 slides):
{"title":"carousel title","hook":"compelling cover headline","slides":[{"slide_number":1,"headline":"Cover headline","body":"Teaser of what readers will learn"},{"slide_number":2,"headline":"Point 1 title","body":"First key insight in 1-2 sentences"},{"slide_number":3,"headline":"Point 2 title","body":"Second key insight in 1-2 sentences"},{"slide_number":4,"headline":"Point 3 title","body":"Third key insight in 1-2 sentences"},{"slide_number":5,"headline":"Save this post!","body":"Call to action and follow for more"}],"hashtags":["hashtag1","hashtag2","hashtag3","hashtag4","hashtag5"],"visual_direction":"visual style for the carousel","audio_suggestion":"background music mood","call_to_action":"what you want the audience to do"}`
}

export async function generateContentStrategy(brand: BrandRow, products: ProductRow[], params?: AutopilotParams): Promise<ContentStrategy> {
  const groq = getGroqClient()
  // GPT-OSS reasoning tokens count against max_tokens. The big 30-day/
  // 30-slot planner -- measured live with a comparable 30-slot test JSON
  // consuming 4685/12000 total tokens (3128 of them reasoning), comfortably
  // within this budget -- "medium" for real cross-slot planning coherence.
  const res = await generateWithRetry(groq, {
    model: MODELS.generation,
    temperature: 0.7,
    reasoning_effort: "medium",
    max_tokens: 12000,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildStrategySystemPrompt() },
      { role: "user", content: buildStrategyUserPrompt(brand, products, params) },
    ],
  })

  const raw: string = res.choices[0]?.message?.content ?? "{}"
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

  return parsed
}

async function generateSlotContent(
  brand: BrandRow,
  slot: ContentSlot,
  product: ProductRow | null,
  totalSlots: number,
): Promise<SlotContent> {
  const groq = getGroqClient()
  const isCarousel = slot.content_type === "carousel"
  const isReel = slot.content_type === "reel_script"

  // GPT-OSS reasoning tokens count against max_tokens. Final single-post
  // content generation, similar scale/purpose to the tested captions/
  // social_post call sites -- "low". Budget raised well past the old
  // Llama-era 700/400.
  const res = await generateWithRetry(groq, {
    model: MODELS.generation,
    temperature: 0.8,
    reasoning_effort: "low",
    max_tokens: isCarousel || isReel ? 1800 : 1200,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You are an expert social media content creator. Generate complete, ready-to-post content. Respond with valid JSON only. No markdown.",
      },
      {
        role: "user",
        content: isCarousel
          ? buildCarouselSlotContentPrompt(brand, slot, product)
          : isReel
            ? buildReelScriptSlotContentPrompt(brand, slot, product, totalSlots)
            : buildSlotContentPrompt(brand, slot, product, totalSlots),
      },
    ],
  })

  const raw: string = res.choices[0]?.message?.content ?? ""
  let cleaned = sanitizeJsonString(raw)
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (jsonMatch) cleaned = jsonMatch[0]

  try {
    const parsed = JSON.parse(cleaned) as SlotContent
    if (isCarousel && parsed.slides !== undefined && !Array.isArray(parsed.slides)) {
      parsed.slides = []
    }
    if (isReel && parsed.scenes !== undefined && !Array.isArray(parsed.scenes)) {
      parsed.scenes = []
    }
    return parsed
  } catch {
    // Regex fallback for malformed JSON
    const titleMatch = cleaned.match(/"title"\s*:\s*"([^"]*)"/)
    const hookMatch = cleaned.match(/"hook"\s*:\s*"([^"]*)"/)
    const captionMatch = cleaned.match(/"caption"\s*:\s*"([\s\S]*?)"(?:\s*,|\s*\})/)
    const visualMatch = cleaned.match(/"visual_direction"\s*:\s*"([^"]*)"/)
    const audioMatch = cleaned.match(/"audio_suggestion"\s*:\s*"([^"]*)"/)
    const ctaMatch = cleaned.match(/"call_to_action"\s*:\s*"([^"]*)"/)

    let hashtags: string[] = []
    const hashtagsMatch = cleaned.match(/"hashtags"\s*:\s*\[([^\]]*)\]/)
    if (hashtagsMatch) {
      hashtags = hashtagsMatch[1]
        .split(",")
        .map(h => h.trim().replace(/^"|"$/g, "").replace(/^#/, "").trim())
        .filter(Boolean)
    }

    return {
      title: titleMatch?.[1] ?? slot.theme,
      hook: hookMatch?.[1] ?? `${slot.theme} — you need to see this`,
      caption: captionMatch?.[1]?.replace(/\\n/g, " ") ?? `${brand.name} brings you ${slot.theme}.`,
      hashtags,
      visual_direction: visualMatch?.[1] ?? "",
      audio_suggestion: audioMatch?.[1] ?? "",
      call_to_action: ctaMatch?.[1] ?? "",
      slides: [],
      scenes: [],
    }
  }
}

// Same filtering as parseScenes() in
// reel-scripts/[scriptId]/video/route.ts, applied to the AI's freshly
// parsed JSON instead of a stored Json column — scenes missing a real
// visual_direction are dropped rather than fed into Kling with nothing to
// generate from.
function normalizeReelScenes(raw: unknown): ReelScene[] {
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
async function submitAutopilotReel(input: SubmitAutopilotReelInput): Promise<void> {
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

export async function executeFastlane(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  brandId: string,
  params?: AutopilotParams,
  // Id of the row app/api/v1/brands/fastlane/route.ts already inserted
  // into autopilot_run_status before calling this -- updated with real
  // progress after each batch below, and marked done/error at the end, so
  // a navigation away mid-run doesn't destroy all visibility into it. This
  // whole function body is wrapped in a try/catch purely to mark that row
  // 'error' on the way out; every existing throw site (brand not found,
  // strategy generation failure, etc.) is otherwise untouched and still
  // propagates to the caller exactly as before.
  runStatusId?: string,
): Promise<FastlaneResult> {
  try {
    return await executeFastlaneInner(supabase, userId, brandId, params, runStatusId)
  } catch (err) {
    if (runStatusId) {
      const message = err instanceof Error ? err.message : String(err)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from("autopilot_run_status") as any)
        .update({ status: "error", error_message: message, completed_at: new Date().toISOString() })
        .eq("id", runStatusId)
    }
    throw err
  }
}

async function executeFastlaneInner(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  brandId: string,
  params: AutopilotParams | undefined,
  runStatusId: string | undefined,
): Promise<FastlaneResult> {
  const errors: string[] = []

  const { data: brand, error: brandErr } = await supabase
    .from("brands")
    .select("*")
    .eq("id", brandId)
    .eq("user_id", userId)
    .single<BrandRow>()

  if (brandErr || !brand) throw new Error("Brand not found")

  // Determines the image provider for every slot's post image (Free ->
  // Pollinations, paid -> Flux) — see
  // lib/ai/post-image-pipeline.ts's resolveImageProvider. Resolved once
  // from the caller-supplied plan/bypass flag rather than re-fetched per
  // slot; app/api/v1/brands/fastlane/route.ts already looked these up for
  // its own usage/credit gating before calling executeFastlane.
  const plan: UserPlan = params?.plan ?? "free"
  const isInternalUnlimitedUser = params?.isInternalUnlimitedUser ?? false

  const { data: products } = await supabase
    .from("products")
    .select("*")
    .eq("brand_id", brandId)
    .eq("is_active", true)
    .returns<ProductRow[]>()

  const productList: ProductRow[] = products ?? []
  const productByName = new Map(productList.map(p => [p.name.toLowerCase(), p]))

  // The shared post-image pipeline's template/colorTheme are a manual
  // picker choice in the Create flow — Autopilot has no per-slot (or
  // brand-level) equivalent selection to read, so these fall back to the
  // same defaults the Create UI itself starts with before a user touches
  // the picker (DEFAULT_POST_TEMPLATE_ID, and the brand's own resolved
  // color theme — brand colors if set, else the first curated preset).
  // Resolved once so all of this run's images share one consistent look,
  // rather than re-resolving (identically) per slot.
  const imageTemplate = DEFAULT_POST_TEMPLATE_ID
  const imageColorTheme = resolveColorThemes(brand)[0]!

  // Storage RLS expects the path to start with the user's auth uid — admin
  // bypasses RLS safely here since brand ownership is already verified
  // above (same pattern as app/api/v1/ai/post-image/generate/route.ts).
  const admin = await createAdminClient()

  let strategy: ContentStrategy
  try {
    strategy = await generateContentStrategy(brand, productList, params)
  } catch (err) {
    console.error("[fastlane] generateContentStrategy failed:", err)
    throw new Error("Failed to generate content strategy")
  }

  const totalSlots = params?.totalSlots ?? 30
  const slots = strategy.slots.slice(0, totalSlots)
  const slotsPlanned = slots.length
  let slotsGenerated = 0
  let calendarEntriesCreated = 0
  const createdEntries: CalendarEntryRow[] = []

  const batchSize = 3
  const baseDate = new Date()
  baseDate.setHours(0, 0, 0, 0)

  for (let i = 0; i < slots.length; i += batchSize) {
    if (i > 0) await sleep(1500)

    const batch = slots.slice(i, i + batchSize)
    const results = await Promise.allSettled(
      batch.map(async (slot) => {
        const product = slot.product_focus
          ? (productByName.get(slot.product_focus.toLowerCase()) ?? null)
          : null

        const slotDate = new Date(baseDate)
        slotDate.setDate(baseDate.getDate() + slot.day - 1)
        const scheduledDate = slotDate.toISOString().split("T")[0]

        const generated = await generateSlotContent(brand, slot, product, totalSlots)

        // The per-slot prompt (buildSlotContentPrompt) has no structural
        // guarantee that `caption` already opens with the hook or closes
        // with the CTA — unlike the Create → Full Post caption prompt, this
        // one is generic. Merge them in now so caption_text (the only field
        // publish-scheduled/route.ts actually sends) is the true final text.
        const mergedCaption = generated.caption
          ? mergeCaptionWithHookAndCta(generated.caption, generated.hook, generated.call_to_action)
          : generated.caption

        // Persist hook (non-fatal)
        let hookId: string | null = null
        if (generated.hook) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: hookData } = await (supabase.from("hooks") as any)
              .insert({
                brand_id: brandId,
                hook_text: generated.hook,
                hook_type: "bold_statement",
                generation_prompt: `fastlane day:${slot.day} platform:${slot.platform}`,
                model_used: MODELS.generation,
                is_saved: true,
              })
              .select("id")
              .single() as { data: { id: string } | null }
            hookId = hookData?.id ?? null
          } catch {
            // non-fatal
          }
        }

        // Persist caption (non-fatal)
        let captionId: string | null = null
        if (generated.caption) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: captionData } = await (supabase.from("captions") as any)
              .insert({
                brand_id: brandId,
                hook_id: hookId,
                caption_text: mergedCaption,
                hashtags: generated.hashtags ?? [],
                cta: generated.call_to_action || null,
                character_count: mergedCaption.length,
                platform: slot.platform,
                model_used: MODELS.generation,
                is_saved: true,
              })
              .select("id")
              .single() as { data: { id: string } | null }
            captionId = captionData?.id ?? null
          } catch {
            // non-fatal
          }
        }

        const isCarousel = slot.content_type === "carousel"
        const isReel = slot.content_type === "reel_script"

        // Generate the AI post image via the same shared pipeline (prompt
        // grounding, quality-check/retry, template compositing) manually
        // created posts use — non-blocking, a failure here still lets the
        // slot's text content through. The shared pipeline returns
        // composited image bytes, not a URL, so the buffer is uploaded to
        // Storage here (same bucket/path convention as
        // app/api/v1/ai/post-image/generate/route.ts). Skipped for reel
        // slots (get a real rendered video below) and carousel slots (get
        // real per-slide images below) — neither needs this generic single
        // image standing in for the real thing.
        let imageUrl: string | null = null
        if (!isReel && !isCarousel) {
          try {
            // Autopilot has no interactive caption box for a human to opt
            // into text overlay from -- it's a fully automated batch flow,
            // unlike Create -> Full Post's interactive generation where a
            // human picks (or skips) text per image. So it always takes the
            // pipeline's clean-image default (no captionText) rather than
            // fabricating text on the user's behalf.
            const imageResult = await generatePostImage({
              imagePrompt: generated.visual_direction || "professional product photography",
              brandNiche: brand.niche,
              targetAudience: brand.target_audience,
              template: imageTemplate,
              colorTheme: imageColorTheme,
              logoUrl: brand.logo_url,
              plan,
              isInternalUnlimitedUser,
            })

            if (imageResult.success) {
              const storagePath = `${userId}/${brandId}/${Date.now()}-${crypto.randomUUID()}.png`
              const { error: uploadError } = await admin.storage
                .from(IMAGE_BUCKET)
                .upload(storagePath, imageResult.buffer, { contentType: imageResult.mimeType, upsert: false })

              if (uploadError) {
                console.error(`[fastlane] day ${slot.day}: image generated but storage upload failed:`, uploadError.message)
              } else {
                const { data: publicUrlData } = admin.storage.from(IMAGE_BUCKET).getPublicUrl(storagePath)
                imageUrl = publicUrlData.publicUrl
              }
            } else {
              console.error(`[fastlane] day ${slot.day}: image generation failed:`, imageResult.error)
            }
          } catch (err) {
            console.error(`[fastlane] day ${slot.day}: image generation unexpected error:`, err instanceof Error ? err.message : err)
          }
        }

        // Generate carousel HTML for carousel slots — kept purely for the
        // on-screen iframe preview in CalendarEntryPanel.tsx (still the
        // only thing that renders it); it was never rasterized into real
        // images, which is the actual publishing gap fixed below.
        let carouselHtmlStr: string | null = null
        const carouselSlides = Array.isArray(generated.slides) ? generated.slides : []
        if (isCarousel && carouselSlides.length > 0) {
          try {
            carouselHtmlStr = generateCarouselHtml(brand, generated.hook, carouselSlides)
          } catch {
            // non-fatal
          }
        }

        // Render each carousel slide to a real PNG (SVG built to match
        // generateCarouselHtml's layout/colors, rasterized via resvg — see
        // lib/image/carousel-compositor.ts) and host it, so the carousel
        // has actual publishable images instead of only an HTML preview.
        // Instagram carousels need at least 2 images; below that there's
        // nothing worth publishing, so it's left unset and the entry falls
        // back to review-only (same as any other failed generation step).
        let carouselImageUrls: string[] = []
        if (isCarousel && carouselSlides.length >= MIN_CAROUSEL_SLIDES) {
          try {
            const slidePngs = await renderCarouselSlidesToPng({ brand, coverHook: generated.hook || slot.theme, slides: carouselSlides })
            const uploaded: string[] = []
            for (let idx = 0; idx < slidePngs.length; idx++) {
              const uploadResult = await uploadMediaToStorage(
                { kind: "buffer", buffer: slidePngs[idx]!, mimeType: "image/png" },
                `${brandId}/carousel/${Date.now()}-${idx}`
              )
              if ("publicUrl" in uploadResult) {
                uploaded.push(uploadResult.publicUrl)
              } else {
                console.error(`[fastlane] day ${slot.day}: carousel slide ${idx} upload failed:`, uploadResult.error)
              }
            }
            if (uploaded.length >= MIN_CAROUSEL_SLIDES) {
              carouselImageUrls = uploaded
            } else {
              console.error(`[fastlane] day ${slot.day}: only ${uploaded.length}/${slidePngs.length} carousel slide(s) uploaded, need at least ${MIN_CAROUSEL_SLIDES} to publish`)
            }
          } catch (err) {
            console.error(`[fastlane] day ${slot.day}: carousel image rendering failed:`, err instanceof Error ? err.message : err)
          }
        }

        // Build platform_specific_data JSONB
        const platformData: Record<string, string | string[]> = {}
        if (imageUrl) platformData.image_url = imageUrl
        if (carouselHtmlStr) platformData.carousel_html = carouselHtmlStr
        if (carouselImageUrls.length > 0) {
          // Matches the exact shape schedule-post/route.ts produces for a
          // manually-scheduled carousel — publish-scheduled/route.ts reads
          // hosted_image_urls first and only re-hosts from image_urls if
          // that's empty, so setting both to the same already-hosted URLs
          // lets the cron skip re-hosting entirely.
          platformData.content_format = "carousel"
          platformData.image_urls = carouselImageUrls
          platformData.hosted_image_urls = carouselImageUrls
        }

        // Reel slots: save the script + queue a real render job (Kling
        // scenes + TTS + JSON2Video composition, same pipeline as manually
        // generated reels) instead of a static image. The render itself is
        // genuinely slow (several minutes) — it's kicked off via after()
        // below, once the calendar entry exists to update, rather than
        // awaited here inline.
        let reelScriptId: string | null = null
        let reelVideoJobId: string | null = null
        let reelScenes: ReelScene[] = []
        let reelMusicUrl: string | null = null

        if (isReel) {
          reelScenes = normalizeReelScenes(generated.scenes)
          platformData.content_format = "video"

          if (reelScenes.length === 0) {
            platformData.video_status = "failed"
            platformData.video_error = "Couldn't plan out scenes for this reel."
            console.error(`[fastlane] day ${slot.day}: reel script has no usable scenes, skipping video render`)
          } else {
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const { data: scriptRow } = await (supabase.from("reel_scripts") as any)
                .insert({
                  brand_id: brandId,
                  product_id: product?.id ?? null,
                  platform: slot.platform,
                  hook: generated.hook || slot.theme,
                  scenes: reelScenes as unknown as Json,
                  caption: mergedCaption || null,
                  hashtags: generated.hashtags ?? [],
                  is_saved: true,
                })
                .select("id")
                .single() as { data: { id: string } | null }
              reelScriptId = scriptRow?.id ?? null
            } catch (err) {
              console.error(`[fastlane] day ${slot.day}: failed to save reel script:`, err instanceof Error ? err.message : err)
            }

            if (!reelScriptId) {
              platformData.video_status = "failed"
              platformData.video_error = "Couldn't save the reel script for rendering."
            } else {
              const musicOption =
                MUSIC_OPTIONS.find(m => m.id === resolveMusicTrackId(generated.audio_suggestion)) ?? MUSIC_OPTIONS.find(m => m.id === "upbeat")!
              reelMusicUrl = musicOption.url

              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data: jobRow } = await (supabase.from("reel_video_jobs") as any)
                  .insert({
                    brand_id: brandId,
                    reel_script_id: reelScriptId,
                    status: "pending",
                    progress_message: "Queued by Autopilot…",
                    music_url: reelMusicUrl,
                  })
                  .select("id")
                  .single() as { data: { id: string } | null }
                reelVideoJobId = jobRow?.id ?? null
              } catch (err) {
                console.error(`[fastlane] day ${slot.day}: failed to create reel video job:`, err instanceof Error ? err.message : err)
              }

              if (reelVideoJobId) {
                platformData.video_status = "rendering"
              } else {
                platformData.video_status = "failed"
                platformData.video_error = "Couldn't start video rendering."
              }
            }
          }
        }

        // Insert calendar entry with full generated content. Selecting the
        // inserted row back lets the caller show a review/approval list
        // (Autopilot never auto-schedules — status stays content_ready
        // until the user explicitly bulk-schedules from that review step).
        // For reel slots this is still "content_ready" even while the video
        // is rendering — there's no dedicated calendar_entries status for
        // that, so platform_specific_data.video_status carries it instead.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: insertedEntry, error: insertErr } = await (supabase.from("calendar_entries") as any).insert({
          brand_id: brandId,
          title: generated.title || slot.theme,
          scheduled_date: scheduledDate,
          platform: slot.platform as Platform,
          content_type: isCarousel ? "carousel"
            : isReel ? "reel"
            : "post",
          status: "content_ready",
          hook_text: generated.hook || null,
          caption_text: mergedCaption || null,
          hashtags: generated.hashtags ?? [],
          visual_direction: generated.visual_direction || null,
          audio_suggestion: generated.audio_suggestion || null,
          notes: generated.call_to_action || null,
          hook_id: hookId,
          caption_id: captionId,
          is_ready: true,
          platform_specific_data: platformData,
          color: slot.priority === "high" ? "#6366f1"
            : slot.priority === "medium" ? "#8b5cf6"
            : "#a78bfa",
        }).select().single() as { data: CalendarEntryRow | null; error: { message: string } | null }

        if (insertErr) throw new Error(`Calendar insert failed for day ${slot.day}: ${insertErr.message}`)

        if (isReel && reelScriptId && reelVideoJobId && insertedEntry) {
          const calendarEntryId = insertedEntry.id
          const jobId = reelVideoJobId
          const scriptId = reelScriptId
          const scenesForRender = reelScenes

          // Links the job back to this calendar entry so
          // app/api/v1/webhooks/kling/route.ts can find and update it once
          // every scene has reported in and the video is actually done —
          // set here (not at job-creation time above) since the calendar
          // entry itself didn't exist yet then.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase.from("reel_video_jobs") as any)
            .update({ calendar_entry_id: calendarEntryId })
            .eq("id", jobId)

          after(async () => {
            await submitAutopilotReel({ brandId, scriptId, jobId, calendarEntryId, scenes: scenesForRender })
          })
        }

        return insertedEntry
      }),
    )

    for (const result of results) {
      if (result.status === "fulfilled") {
        slotsGenerated++
        calendarEntriesCreated++
        if (result.value) createdEntries.push(result.value)
      } else {
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason)
        errors.push(msg)
        console.error("[fastlane] slot error:", msg)
      }
    }

    // Real progress, not a simulated animation -- one UPDATE per batch
    // (not per slot) so this stays cheap next to the actual generation
    // work. completed_slots counts slots attempted so far (success or
    // failure), matching slotsPlanned's denominator on the frontend.
    if (runStatusId) {
      const completedSoFar = Math.min(i + batch.length, slotsPlanned)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from("autopilot_run_status") as any)
        .update({ completed_slots: completedSoFar })
        .eq("id", runStatusId)
    }
  }

  const finalResult: FastlaneResult = {
    brand_id: brandId,
    slots_planned: slotsPlanned,
    slots_generated: slotsGenerated,
    calendar_entries_created: calendarEntriesCreated,
    strategy_summary: strategy.strategy_summary,
    errors,
    created_entries: createdEntries,
  }

  if (runStatusId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("autopilot_run_status") as any)
      .update({ status: "done", completed_slots: slotsPlanned, result: finalResult as unknown as Json, completed_at: new Date().toISOString() })
      .eq("id", runStatusId)
  }

  return finalResult
}
