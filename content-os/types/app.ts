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

export type UserPlan = "starter" | "pro" | "agency"

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
//
// The per-feature weights this is built from (lib/usage/credit-costs.ts)
// are ESTIMATES, not measured from real usage — see the note at the top
// of that file for what to check once real Groq/Replicate billing
// history exists.
export interface AutopilotTier {
  days: number
  slots: number
  creditCost: number
  /** Hard cap on Autopilot RUNS per calendar month — independent of, and
   * enforced in addition to, the shared credit pool (a user with credits
   * to spare still can't exceed this). Applies per-user across all of
   * their brands (not per-brand): Agency's 4 runs/month against its 5
   * brands is intentional — the user manually chooses which brands to
   * spend their runs on each month, no automatic rotation. Enforced in
   * app/api/v1/brands/fastlane/route.ts via users.autopilot_run_count. */
  maxRunsPerMonth: number
}

// `price` is in whole rupees (₹/mo) — the single source Razorpay checkout
// and every UI price display should read from, rather than hand-copying
// the number. `influencerOutreach` gates the influencer discovery/outreach
// feature (Pro and Agency only). `carouselCtaAiBackground` gates the
// AI-generated background image on a carousel's closing (CTA) slide —
// Starter and above; the opening (hook) slide gets one on every plan
// unconditionally, so it has no flag of its own here.
// `annualPrice` is the full upfront yearly charge (not a monthly rate) —
// same unit as `price` (whole rupees). = monthly x 12 x 0.9 (the same
// ~10% annual discount used since annual billing launched), rounded down
// to whole rupees — confirmed: 499x12x0.9=5389.2, 1999x12x0.9=21589.2,
// 4999x12x0.9=53989.2, matching the values below exactly.
//
// autopilot.creditCost: the real weighted default for each tier's slot
// count — computed via lib/ai/fastlane.ts's estimateAutopilotCreditCost
// (undefined focusAreas, i.e. the default slot mix), not hand-typed.
// Starter's 74 is that same function's real output for 14 slots (its mix
// scales proportionally from the 30-slot base); Pro/Agency's 162 for 30
// slots is unchanged from before this pricing revision.
//
// autopilot.maxRunsPerMonth: a hard per-user monthly cap on Autopilot
// RUNS, separate from and enforced alongside the creditCost/generations
// check above (a user with credits to spare still can't exceed this).
// Deliberately not tied to brand count: Agency gets 4 runs/month against
// its 5 brands, and the user manually picks which brands to spend those
// runs on — no automatic rotation.
//
// Free tier removed entirely (2026-08-26 pricing revision) — every new
// signup instead starts on a 7-day no-card trial with a separate, much
// smaller credit cap than any paid tier's `generations` here (see
// TRIAL_CREDIT_CAP in lib/usage/credit-costs.ts and users.trial_ends_at/
// subscribed_at) rather than a standing free plan. `plan` itself is never
// "free" anymore — during a trial it still resolves to "starter" for
// every gate in this table (brands/products/features), the trial's own
// reduced credit cap is enforced separately in
// lib/usage/check-and-increment-usage.ts.
export const PLAN_LIMITS: Record<UserPlan, { price: number; annualPrice: number; generations: number; brands: number; products: number; zernioSocialPlatforms: boolean; reelsPerWeek: number; autopilot: AutopilotTier; influencerOutreach: boolean; carouselCtaAiBackground: boolean }> = {
  starter: { price: 499,  annualPrice: 5389,   generations: 150,  brands: 2, products: 30,   zernioSocialPlatforms: false, reelsPerWeek: 0, autopilot: { days: 14, slots: 14, creditCost: 74,  maxRunsPerMonth: 1 }, influencerOutreach: false, carouselCtaAiBackground: true },
  pro:     { price: 1999, annualPrice: 21589,  generations: 600,  brands: 3, products: 200,  zernioSocialPlatforms: true,  reelsPerWeek: 1, autopilot: { days: 30, slots: 30, creditCost: 162, maxRunsPerMonth: 3 }, influencerOutreach: true,  carouselCtaAiBackground: true },
  agency:  { price: 4999, annualPrice: 53989,  generations: 1600, brands: 5, products: 1000, zernioSocialPlatforms: true,  reelsPerWeek: 4, autopilot: { days: 30, slots: 30, creditCost: 162, maxRunsPerMonth: 4 }, influencerOutreach: true,  carouselCtaAiBackground: true },
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
