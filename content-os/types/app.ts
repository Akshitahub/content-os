import type { BrandRow, ProductRow, CalendarEntryRow } from "./database"

/**
 * App-level types — these are what components and hooks work with.
 * They may extend or combine database row types.
 */

export type Platform =
  | "instagram"
  | "facebook"
  | "tiktok"
  | "youtube"
  | "linkedin"
  | "twitter"

export type ContentType = "reel" | "post" | "story" | "carousel" | "thread"

export type HookType =
  | "question"
  | "bold_statement"
  | "story"
  | "statistic"
  | "controversial"
  | "how_to"

export type ContentStatus =
  | "draft"
  | "review"
  | "approved"
  | "scheduled"
  | "published"

export type CalendarStatus =
  | "planned"
  | "content_ready"
  | "scheduled"
  | "published"
  | "missed"

export type UserPlan = "free" | "starter" | "pro" | "agency"

// Extended types with relations
export type BrandWithProducts = BrandRow & {
  products: ProductRow[]
}

// Generation types (for UI state, not DB)
export type GeneratedHook = {
  hook_text: string
  hook_type: HookType
  reasoning: string
}

export type GeneratedCaption = {
  caption_text: string
  hashtags: string[]
  cta: string
  character_count: number
  /** Honest, non-predictive pattern-match note vs. the brand's own rating history. */
  pattern_note?: string | null
  /** Only populated when requested via includeImagePrompt (Create → Full Post flow) — a visual scene description grounded in this same caption's specific message, for the AI post-image pipeline. */
  image_prompt?: string | null
}

export type AspectRatio = "1:1" | "4:5" | "9:16" | "16:9"

export type ImageStyle =
  | "product_photography"
  | "lifestyle"
  | "flat_lay"
  | "minimal_studio"
  | "festive"
  | "ugc_style"

// Generation types (for UI state, not DB)
export type GeneratedImage = {
  prompt: string
  full_prompt?: string
  style: ImageStyle | null
  aspect_ratio: AspectRatio
  public_url: string
  storage_path: string
}

// Generation request options
export type HookGenerationOptions = {
  brandId: string
  productId?: string
  hookTypes?: HookType[]
  count?: number
  platform?: Platform
  additionalContext?: string
}

export type CaptionGenerationOptions = {
  brandId: string
  productId?: string
  hookId?: string
  hookText?: string
  platform: Platform
  contentType: ContentType
  additionalContext?: string
}

export type ImageGenerationOptions = {
  brandId: string
  productId?: string
  prompt: string
  style?: ImageStyle
  aspectRatio?: AspectRatio
}

// ─── Content format types ──────────────────────────────────────────────────

export type ContentFormat =
  | "social_post"
  | "reel_script"
  | "story"
  | "carousel"
  | "blog_post"
  | "ad_copy"

export type ReelScene = {
  visual_direction: string
  voiceover_or_text_overlay: string
  duration_seconds: number
}

export type ReelScript = {
  hook: string
  scenes: ReelScene[]
  caption: string
  hashtags: string[]
}

export type StoryContent = {
  text: string
  sticker_suggestion: string
}

export type CarouselSlide = {
  slide_number: number
  headline: string
  body: string
}

export type CarouselContent = {
  slides: CarouselSlide[]
  caption: string
  hashtags: string[]
}

export type BlogPost = {
  title: string
  body: string
  meta_description: string
  /** Only populated by the dedicated Blog Post generator (lib/ai/blog-generator.ts) — optional so the generic content-generator.ts path is unaffected. */
  suggested_tags?: string[]
}

export type AdCopy = {
  headline: string
  primary_text: string
  description: string
  cta_button: string
}

// Maps each ContentFormat to its output type.
// social_post reuses the existing GeneratedCaption shape.
export type ContentFormatOutputMap = {
  social_post: GeneratedCaption
  reel_script: ReelScript
  story: StoryContent
  carousel: CarouselContent
  blog_post: BlogPost
  ad_copy: AdCopy
}

// ─── Plan limits ────────────────────────────────────────────────────────────

// Explicit, plan-aware Autopilot tiers — free gets a scaled preview (same
// strategy engine, fewer days/posts, cheaper), paid plans get the full run.
// Read by both the fastlane API route (server-side gating) and the
// Autopilot page (client-side copy/cost display) so the two can never
// drift out of sync with each other.
//
// `creditCost` is a static default estimate only — a real run's actual
// charge is computed server-side from its exact slot mix by
// lib/ai/fastlane.ts's estimateAutopilotCreditCost (sum of each slot's
// real weighted content-type cost, not a flat number; see
// lib/usage/credit-costs.ts). This field exists purely for upfront UI
// display before a run starts, and can differ slightly from the real
// charge if the user's chosen focusAreas shift the slot mix away from the
// default distribution these numbers were computed against.
export interface AutopilotTier {
  days: number
  slots: number
  creditCost: number
}

// `price` is in whole rupees (₹/mo) — the single source Razorpay checkout
// and every UI price display should read from, rather than hand-copying
// the number. `influencerOutreach` gates the influencer discovery/outreach
// feature (Pro and Agency only). `carouselCtaAiBackground` gates the
// AI-generated background image on a carousel's closing (CTA) slide —
// Starter and above; the opening (hook) slide gets one on every plan
// including Free unconditionally, so it has no flag of its own here.
// `annualPrice` is the full upfront yearly charge (not a monthly rate) —
// same unit as `price` (whole rupees). Free has no annual option, but
// carries 0 here anyway so every tier shares one shape rather than making
// the field optional. ~10% cheaper than 12x the monthly price on every
// paid tier.
// autopilot.creditCost below: 29 (free, 5 slots) and 162 (starter/pro/
// agency, 30 slots) are the real weighted defaults — computed via
// lib/ai/fastlane.ts's estimateAutopilotCreditCost(undefined, slots)
// against the default (no focusAreas override) slot mix. Unchanged by
// the pool resize below — per-feature weights aren't touched here, only
// how many credits each plan gets to spend against them.
//
// `generations` below was resized from the old flat 15/350/1200/2000 to
// keep Posts-only usage capacity the same or better after weighted costs
// landed (see lib/usage/credit-costs.ts) — under the old flat-1 system,
// `generations` WAS the max number of Posts a plan could generate; under
// weighted costs (POST = 5), the same old number now buys 1/5 as many
// Posts unless the pool grows to compensate. New values are old x 5,
// rounded to a clean number.
//
// Free was rounded up to 100 (not the raw 75) specifically so its
// Autopilot preview stays genuinely usable: the preview's real weighted
// cost is autopilot.creditCost = 29 (5 slots, mostly Post-weighted —
// see estimateAutopilotCreditCost in lib/ai/fastlane.ts), which briefly
// exceeded Free's entire old 15-credit pool outright, making the preview
// mathematically impossible to ever run. 29 against a 100-credit pool
// leaves 71 credits of real headroom for the rest of that month's usage
// on top of one preview run — confirmed this resize alone resolves it,
// no separate slot-count or Autopilot-specific change was needed.
export const PLAN_LIMITS: Record<UserPlan, { price: number; annualPrice: number; generations: number; brands: number; products: number; zernioSocialPlatforms: boolean; reelsPerWeek: number; autopilot: AutopilotTier; influencerOutreach: boolean; carouselCtaAiBackground: boolean }> = {
  free:    { price: 0,    annualPrice: 0,     generations: 100,   brands: 1, products: 5,    zernioSocialPlatforms: false, reelsPerWeek: 0, autopilot: { days: 3,  slots: 5,  creditCost: 29 },  influencerOutreach: false, carouselCtaAiBackground: false },
  starter: { price: 1199, annualPrice: 12949, generations: 1750,  brands: 2, products: 30,   zernioSocialPlatforms: false, reelsPerWeek: 0, autopilot: { days: 30, slots: 30, creditCost: 162 }, influencerOutreach: false, carouselCtaAiBackground: true },
  pro:     { price: 2999, annualPrice: 32389, generations: 6000,  brands: 3, products: 200,  zernioSocialPlatforms: true,  reelsPerWeek: 1, autopilot: { days: 30, slots: 30, creditCost: 162 }, influencerOutreach: true,  carouselCtaAiBackground: true },
  agency:  { price: 8000, annualPrice: 86400, generations: 10000, brands: 5, products: 1000, zernioSocialPlatforms: true,  reelsPerWeek: 4, autopilot: { days: 30, slots: 30, creditCost: 162 }, influencerOutreach: true,  carouselCtaAiBackground: true },
}

// ─── Trending context ────────────────────────────────────────────────────────

export interface TrendingContext {
  topics: string[]
  scraped_at: string
  success: boolean
}

// ─── Content strategy (Fastlane) ─────────────────────────────────────────────

export interface ContentSlot {
  day: number
  platform: Platform
  content_type: "hooks" | "caption" | "reel_script" | "carousel" | "ad_copy"
  theme: string
  product_focus: string | null
  priority: "high" | "medium" | "low"
  content_pillar?: string
}

export interface ContentStrategy {
  strategy_summary: string
  recommended_platforms: Platform[]
  posting_frequency: { platform: string; posts_per_week: number }[]
  content_mix: { type: string; percentage: number; reasoning: string }[]
  monthly_themes: { week: number; theme: string; rationale: string }[]
  slots: ContentSlot[]
}

export interface FastlaneResult {
  brand_id: string
  slots_planned: number
  slots_generated: number
  calendar_entries_created: number
  strategy_summary: string
  errors: string[]
  created_entries: CalendarEntryRow[]
}

// ─── Influencer types ────────────────────────────────────────────────────────

export type InfluencerStatus =
  | "discovered"
  | "contacted"
  | "replied"
  | "negotiating"
  | "partnered"
  | "rejected"
  | "completed"

export type PartnershipStatus = "draft" | "sent" | "active" | "completed" | "cancelled"
export type OutreachChannel = "dm" | "email" | "whatsapp"
export type InfluencerPlatform = "instagram" | "tiktok" | "youtube" | "linkedin"
