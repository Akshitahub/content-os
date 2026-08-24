import type { ContentFormat } from "@/types/app"

/**
 * Weighted credit costs per feature — replaces the old flat "every
 * generation = 1 credit" model. Real provider cost varies enormously:
 * text-only generations cost a fraction of a rupee via Groq, while
 * image-bearing generations cost ₹6.70-13.50 via Flux/Replicate on paid
 * plans. Charging flat 1 for both was selling every image-bearing
 * generation below its real cost.
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
 * NOTE (August 2026): these weights are ESTIMATES — based on public
 * Flux/Replicate pricing and typical Groq token counts, not measured
 * from our own historical usage (no real billing history existed yet
 * when these were set). Revisit against actual Groq and Replicate
 * dashboard billing data (real token counts and image counts per
 * generation type) once enough usage has accumulated to measure it.
 */
export const HOOK_OR_CAPTION = 1
export const BLOG_POST = 1
export const POST = 5
export const STORY = 6
export const AD_MAKER = 5
export const CAROUSEL = 9
// The standalone Images tab (lib/ai/image-generator.ts) — not in the
// original weight table, found while tracing every checkAndIncrementUsage
// call site. Produces one raw Flux/Pollinations image, the same cost
// driver as Meme, so weighted the same pending explicit confirmation.
export const IMAGE = 5

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
// SAME implied cost-to-credit ratio already used for POST=5 (this file's
// own comment above cites Flux's real cost at ₹6.70-13.50, midpoint ₹10.10,
// i.e. ~₹2.02/credit) gives ~147/2.02 = ~73 credits — rounded to 75.
//
// NOTE: this is well above the "5-10x a plain post" competitive framing
// (Predis.ai-style) that motivated adding this weight at all (5-10x POST=5
// would be 25-50) — 75 sits closer to 15x. Flagged rather than silently
// rounded down, since underpricing a feature this expensive to actually
// run is the real risk here, not overpricing it. MUST be corrected using
// actual PiAPI billing data (not this estimate, and not the "5-10x" framing
// either) before REELS_ENABLED is ever set to true.
export const REEL = 75

// Lightweight non-image AI actions, confirmed to stay at the base rate:
// app/api/v1/ai/repurpose (repurposing existing content into a new
// format — text-only) and app/api/v1/ai/remove-background (calls the
// third-party remove.bg API, not Flux — a different, much smaller cost
// than the Flux-driven weights above). Named separately from
// HOOK_OR_CAPTION so a route importing one of these isn't misleadingly
// labeled "hook or caption" — all three happen to share the same value.
export const REPURPOSE = 1
export const REMOVE_BACKGROUND = 1

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
