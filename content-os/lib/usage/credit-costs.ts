import type { ContentFormat } from "@/types/app"

/**
 * Weighted credit costs per feature — replaces the old flat "every
 * generation = 1 credit" model. Real provider cost varies enormously:
 * text-only generations cost a fraction of a rupee via Groq, while
 * image-bearing generations have a real per-call image-provider cost.
 * Charging flat 1 for both was selling every image-bearing generation
 * below its real cost.
 *
 * A "Post" (the Create → Full Post flow: hook + caption text, then a
 * composited AI image) is billed as ONE bundled 5-credit charge, not two
 * separate charges — the text-generation step at
 * app/api/v1/ai/fullpost/generate/route.ts charges 0 for format
 * "social_post" specifically, and the image step at
 * app/api/v1/ai/post-image/generate/route.ts charges the full POST cost.
 * The standalone Content tab's format "social_post" (caption-only, no
 * image ever produced in that flow — see app/api/v1/ai/content/generate/route.ts)
 * is a genuinely different, cheaper action and stays at HOOK_OR_CAPTION.
 *
 * NOTE (2026-10-25, image provider migrated Flux/Replicate -> OpenAI
 * gpt-image-2): these weights are still ESTIMATES, not measured from our
 * own historical usage. IMAGE below (and its two derivatives,
 * CAROUSEL_SLIDE_AI_BACKGROUND/STORY_SLIDE_AI_BACKGROUND) were recomputed
 * against gpt-image-2's real published per-token pricing -- see IMAGE's
 * own comment for the math and source. POST/STORY/AD_MAKER/CAROUSEL were
 * NOT recomputed: this file never documented a reproducible per-unit-cost
 * formula for those (unlike IMAGE/REEL), so changing them would be a
 * business pricing call, not a mechanical provider-cost swap -- left
 * as-is pending that decision. Revisit all of these against actual OpenAI
 * dashboard billing data once enough usage has accumulated to measure it.
 */
export const HOOK_OR_CAPTION = 1
export const BLOG_POST = 1
export const POST = 5
export const STORY = 6
export const AD_MAKER = 5
export const CAROUSEL = 9
// The standalone Images tab (lib/ai/image-generator.ts) — not in the
// original weight table, found while tracing every checkAndIncrementUsage
// call site. Produces one raw AI image, the same cost driver as Meme.
//
// Recomputed for the OpenAI gpt-image-2 migration (2026-10-25). Source:
// OpenAI's official pricing page (developers.openai.com/api/docs/pricing,
// checked 2026-10-25) publishes gpt-image-2 at $8.00/1M image-input
// tokens, $30.00/1M image-OUTPUT tokens, $5.00/1M text-input tokens --
// token-based, not a flat per-image rate. OpenAI does not publish a
// token-count-per-image table for gpt-image-2 itself; the best available
// proxy is gpt-image-1's own publicly documented output-token counts for
// a 1024x1024 image (~272 tokens at "low" quality, ~1056 at "medium",
// ~4160 at "high"), applied to gpt-image-2's new per-token prices, plus
// ~300 text-input tokens for a typical assembled prompt here:
//   medium (IMAGE_PROVIDER_CONFIG's configured default, lib/ai/image-provider.ts):
//     (1056/1e6 * $30) + (300/1e6 * $5) ≈ $0.033/image ≈ ₹2.9 (at ~₹87/$,
//     the same assumed FX rate REEL below already uses, not verified live)
// Applying this file's own existing cost-to-credit ratio (~₹2.02/credit,
// derived from the pre-migration Flux cost ÷ the old IMAGE=5) gives
// ~2.9/2.02 ≈ 1.4 credits -- rounded UP (not down) to 2, same
// don't-underprice-an-external-API-cost precedent as REEL's own comment
// below, since the token-count proxy above is a real approximation, not
// an exact gpt-image-2 figure.
export const IMAGE = 2

// PLACEHOLDER — not yet wired into any charging call site (REELS_ENABLED
// is false in lib/constants.ts; no reel-generation route calls
// checkAndIncrementUsage at all today). This is the credit weight to use
// once Reels launch — see lib/ai/fastlane.ts's submitAutopilotReel and
// app/api/v1/brands/[brandId]/reel-scripts/[scriptId]/video/route.ts for
// the call sites that will need it.
//
// Derived from a REAL documented cost, not a guess: lib/video/kling-client.ts's
// own header comment records PiAPI/Kling's measured price at ~$0.07-0.08/sec
// of generated video, and lib/ai/prompts.ts's reel script prompt specifies a
// 15-30s total reel duration. Midpoint: 22.5s x $0.075/sec = ~$1.69/reel =
// ~₹147 at ~₹87/$ (an assumed FX rate, not verified live). Applying the
// SAME implied cost-to-credit ratio POST=5 was originally set against
// (back when IMAGE/POST priced in Flux's real cost at ₹6.70-13.50, midpoint
// ₹10.10, i.e. ~₹2.02/credit -- a historical reference point for this
// ratio, not this file's current IMAGE figure, which was since recomputed
// for the OpenAI migration) gives ~147/2.02 = ~73 credits — rounded to 75.
//
// NOTE: this is well above the "5-10x a plain post" competitive framing
// (Predis.ai-style) that motivated adding this weight at all (5-10x POST=5
// would be 25-50) — 75 sits closer to 15x. Flagged rather than silently
// rounded down, since underpricing a feature this expensive to actually
// run is the real risk here, not overpricing it. MUST be corrected using
// actual PiAPI billing data (not this estimate, and not the "5-10x" framing
// either) before REELS_ENABLED is ever set to true.
export const REEL = 75

// Create -> Full Post's "upload your own photo" path (lib/ai/vision.ts +
// app/api/v1/ai/fullpost/generate-from-photo/route.ts) — deliberately NOT
// priced like POST above. That 5-credit weight prices in a real AI
// image generation; this path skips image generation
// entirely (the user's own photo IS the image) and costs only one
// qwen/qwen3.6-27b vision+caption call. Measured live against a real
// photo (2026-08-26): ~1,400 prompt + ~130 completion tokens, ~$0.0012 —
// cheaper than an image-generation call and roughly in line with a
// single text-only HOOK_OR_CAPTION call, so it's priced the same rather
// than at POST's image-inclusive rate.
export const PHOTO_CAPTION = HOOK_OR_CAPTION

// Lightweight non-image AI actions, confirmed to stay at the base rate:
// app/api/v1/ai/repurpose (repurposing existing content into a new
// format — text-only) and app/api/v1/ai/remove-background (calls the
// third-party remove.bg API, not the image-generation provider — a
// different, much smaller cost than the image-generation weights above).
// Named separately from HOOK_OR_CAPTION so a route importing one of these
// isn't misleadingly labeled "hook or caption" — all three happen to
// share the same value.
export const REPURPOSE = 1
export const REMOVE_BACKGROUND = 1

// Optional "AI background for every slide" carousel mode — extends the
// always-bundled hook/CTA AI backgrounds to body slides too. Each body
// slide is a genuinely separate image-generation call, the same cost driver
// as the standalone Images tab, so it's priced identically
// to IMAGE rather than invented fresh. Charged PER SLIDE actually
// generated, on top of the base CAROUSEL charge — hook/CTA stay bundled
// free as before (see app/api/v1/ai/carousel/slide-image/generate/route.ts),
// this only meters the newly expanded surface.
export const CAROUSEL_SLIDE_AI_BACKGROUND = IMAGE

// Same "AI background for every slide" mode, for Stories -- reveal/buildup
// slides normally only get a flat vibe color (hook/cta stay bundled free
// into the base STORY charge, same as Carousel's hook/cta). Same real
// image-generation cost driver as CAROUSEL_SLIDE_AI_BACKGROUND, so priced
// identically rather than invented fresh. Charged PER SLIDE actually
// generated (see app/api/v1/ai/stories/slide-image/generate/route.ts).
export const STORY_SLIDE_AI_BACKGROUND = IMAGE

// Captions moved from Groq to OpenAI's MODELS.caption (gpt-5.5) -- see
// lib/ai/captions-generator.ts. Source: developers.openai.com/api/docs/pricing
// (checked 2026-10-25), gpt-5.5 at $5.00/1M input tokens, $30.00/1M output
// tokens. A typical caption call here (brand/product context + past-example
// few-shot block + QUALITY_BAR instructions in, max_completion_tokens 1200
// out, though actual completions usually run well under that cap) is
// roughly 1,500-2,500 input + 400-700 output tokens -- call it ~2,000 in +
// 600 out: (2000/1e6*$5) + (600/1e6*$30) ≈ $0.028/call ≈ ₹2.44 (at ~₹87/$).
// That's noticeably closer to HOOK_OR_CAPTION=1's ~₹2.02/credit value than
// the old Groq cost (effectively $0 against this file's own weights) ever
// was -- still under 1.5 credits' worth, so HOOK_OR_CAPTION stays at 1 for
// now, but the margin is thin enough that this should be one of the first
// things revisited once real OpenAI billing data exists, not treated as
// comfortably profitable the way the Groq-era estimate was.

// content/generate and fullpost/generate both dispatch on ContentFormat —
// one shared map so the two routes can never charge a different amount
// for the identical format. "social_post" here is content/generate's
// caption-only cost (HOOK_OR_CAPTION); fullpost/generate overrides
// "social_post" to 0 itself, per the bundled-Post design above — every
// other format charges what this map says in both routes alike.
export const CONTENT_FORMAT_CREDIT_COSTS: Record<ContentFormat, number> = {
  social_post: HOOK_OR_CAPTION,
  reel_script: HOOK_OR_CAPTION,
  story: STORY,
  carousel: CAROUSEL,
  blog_post: BLOG_POST,
  ad_copy: HOOK_OR_CAPTION,
}

// The 7-day no-card trial's credit ceiling (2026-08-26 pricing revision) —
// a confirmed business number, not derived from anything else, deliberately
// well below every real plan's monthly `generations` pool (see PLAN_LIMITS
// in types/app.ts) so the trial samples the product without giving away a
// full month's value for free. Used in place of PLAN_LIMITS[plan].generations
// while trialing — see lib/usage/trial-status.ts's resolveGenerationLimit,
// the single place this and the real plan pool are chosen between.
//
// NOTE: this is below Starter's own Autopilot cost (74 credits for its
// 14-slot tier) — a trial account can fully explore manual generation
// (hooks, captions, carousels, images, etc.) but can never afford a
// single Autopilot run before subscribing. That side effect of the
// confirmed 50-credit number wasn't separately signed off on and is
// flagged back to the business rather than silently "fixed" here — see
// the pricing-revision task notes.
export const TRIAL_CREDIT_CAP = 50
