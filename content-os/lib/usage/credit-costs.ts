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
 */
export const HOOK_OR_CAPTION = 1
export const BLOG_POST = 1
export const POST = 5
export const STORY = 6
export const MEME = 5
export const AD_MAKER = 5
export const CAROUSEL = 9
// The standalone Images tab (lib/ai/image-generator.ts) — not in the
// original weight table, found while tracing every checkAndIncrementUsage
// call site. Produces one raw Flux/Pollinations image, the same cost
// driver as Meme, so weighted the same pending explicit confirmation.
export const IMAGE = 5

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
