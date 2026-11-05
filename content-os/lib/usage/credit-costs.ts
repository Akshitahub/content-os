import type { ContentFormat } from "@/types/app"

/**
 * Credit costs per feature. One rule (2026-11-05): 1 credit per text
 * output, 4 credits per AI image.
 *
 * What a credit pays for: text runs on Groq (gpt-oss-120b / -20b, vision on
 * qwen3.8-27b) at ~₹0.06 a call; an AI image is gpt-image-2 at medium
 * quality, ~₹3.5-6 an image including 18% GST. The cheapest top-up is now
 * ~₹3/credit (Mega Pack, ₹1,499 for 500 credits, lib/usage/credit-packs.ts).
 * Pack prices include GST, so the net is lower (~₹2.54/credit), and an
 * image's 4 credits still come to ~₹10 net -- above its cost.
 *
 * A "Post" (the Create → Full Post flow: hook + caption text, then a
 * composited AI image) is billed as ONE bundled 5-credit charge (1 text + 4
 * image), not two separate charges — the text-generation step at
 * app/api/v1/ai/fullpost/generate/route.ts charges 0 for format
 * "social_post" specifically, and the image step at
 * app/api/v1/ai/post-image/generate/route.ts charges the full POST cost.
 * The standalone Content tab's format "social_post" (caption-only, no
 * image ever produced in that flow — see app/api/v1/ai/content/generate/route.ts)
 * is a genuinely different, cheaper action and stays at HOOK_OR_CAPTION.
 *
 * Story and Carousel each make one text call for the whole sequence plus
 * the hook/CTA AI backgrounds bundled into their price; an extra AI
 * background on any other slide is charged per slide at IMAGE.
 */
export const HOOK_OR_CAPTION = 1
export const BLOG_POST = 2
export const POST = 5
export const STORY = 10
// Ad Maker: 3 variations x 4 (IMAGE) -- VARIATION_COUNT gpt-image-2 images
// per run in app/api/v1/brands/[brandId]/ai/ad-maker/generate/route.ts --
// plus 3 for the strategy / copy text calls.
export const AD_MAKER = 15
export const CAROUSEL = 10
// The standalone Images tab (lib/ai/image-generator.ts): one raw AI image.
export const IMAGE = 4

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
// image generation; this path skips image generation entirely (the
// user's own photo IS the image) and costs only one vision+caption call.
//
// Vision (MODELS.vision) runs on Groq's qwen/qwen3.8-27b (since 2026-11-05):
// $0.80/1M input tokens, $4.00/1M output (lib/ai/pricing.ts), and each image
// counts as 2,048 input tokens (console.groq.com/docs/vision). One photo
// caption call is ~2,048 image + ~300 prompt tokens in and ~300 out:
// (2350/1e6*$0.80) + (300/1e6*$4.00) ≈ $0.0031/call ≈ ₹0.27 (at ~₹87/$) --
// far under a credit's value, so this stays at 1.
export const PHOTO_CAPTION = HOOK_OR_CAPTION

// app/api/v1/ai/repurpose: one call that repurposes existing content into
// several new formats at once.
// app/api/v1/ai/remove-background (calls the third-party remove.bg API,
// not the image-generation provider -- a different, much smaller cost
// than the image-generation weights above) stays at the base rate. Named
// separately from HOOK_OR_CAPTION so a route importing one of these isn't
// misleadingly labeled "hook or caption".
export const REPURPOSE = 4
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

// content/generate and fullpost/generate both dispatch on ContentFormat —
// one shared map so the two routes can never charge a different amount
// for the identical format. "social_post" here is content/generate's
// caption-only cost (HOOK_OR_CAPTION); fullpost/generate overrides
// "social_post" to 0 itself, per the bundled-Post design above — every
// other format charges what this map says in both routes alike.
//
// "reel_script" is its own literal 2 (a long multi-scene script), not
// HOOK_OR_CAPTION.
export const CONTENT_FORMAT_CREDIT_COSTS: Record<ContentFormat, number> = {
  social_post: HOOK_OR_CAPTION,
  reel_script: 2,
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
// NOTE: this is below Starter's own Autopilot cost (PLAN_LIMITS.starter
// .autopilot.creditCost for its 14-slot tier) — a trial account can fully explore manual generation
// (hooks, captions, carousels, images, etc.) but can never afford a
// single Autopilot run before subscribing. That side effect of the
// confirmed 50-credit number wasn't separately signed off on and is
// flagged back to the business rather than silently "fixed" here — see
// the pricing-revision task notes.
export const TRIAL_CREDIT_CAP = 50
