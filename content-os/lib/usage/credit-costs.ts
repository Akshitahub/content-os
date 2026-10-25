import type { ContentFormat } from "@/types/app"

/**
 * Weighted credit costs per feature — replaces the old flat "every
 * generation = 1 credit" model. Real provider cost varies enormously:
 * text-only generations on Groq still cost a fraction of a rupee (scoring,
 * extraction, account analytics, etc. -- see lib/ai/models.ts for which
 * stages stayed on Groq), while the stages migrated to OpenAI (captions,
 * hooks, reel scripts, blog, ad copy, vision, story, carousel, repurpose,
 * Autopilot text, and every image generation) have a real, much higher per-call
 * provider cost. Charging flat 1 for all of these was selling the
 * expensive ones below their real cost.
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
// HOOK_OR_CAPTION stays 1 through the Phase 1 text-stages migration
// (hooks, reel_script, ad_copy, social_post all moved or already on
// OpenAI) -- see the per-stage cost notes further down (search
// "Phase 1 text-stages migration") for why each of those stays
// comfortably under this value's ~₹2.02/credit budget. reel_script is
// the one exception: its real cost now exceeds this shared value, so it
// gets its own override in CONTENT_FORMAT_CREDIT_COSTS below rather than
// this constant being bumped for every stage that shares it.
export const HOOK_OR_CAPTION = 1
// Recomputed for the Phase 1 text-stages migration (2026-10-25) -- see the
// "Phase 1 text-stages migration" comment block further down for the
// sourced math. Was 1; real cost now runs close to 2x that.
export const BLOG_POST = 2
export const POST = 5
// Recomputed for the Phase 1b text-stages migration (2026-10-25) -- was 6.
// See the "Phase 1b text-stages migration" block further down for the math.
export const STORY = 8
export const AD_MAKER = 5
// Re-checked for the Phase 1b text-stages migration (2026-10-25) -- still
// covers the new OpenAI text cost, unchanged. See that block further down.
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
// image generation; this path skips image generation entirely (the
// user's own photo IS the image) and costs only one vision+caption call.
//
// Vision moved from Groq's qwen/qwen3.6-27b to OpenAI's gpt-5.5
// (MODELS.vision) in the Phase 1 text-stages migration (2026-10-25). The
// old $0.0012/call Groq measurement no longer applies. OpenAI's pricing
// page (developers.openai.com/api/docs/pricing, checked 2026-10-25) bills
// image input under the same per-token input rate as text for a chat
// model ($5.00/1M input tokens, $30.00/1M output for gpt-5.5) rather than
// a separate image-generation-style rate -- but doesn't publish exactly
// how many tokens one photo costs at a given detail level, so this is a
// looser estimate than PHOTO_CAPTION's old Groq-measured figure: assuming
// ~1,000 combined image+text input tokens + ~300 output tokens,
// (1000/1e6*$5) + (300/1e6*$30) ≈ $0.014/call ≈ ₹1.22 (at ~₹87/$) -- still
// comfortably under HOOK_OR_CAPTION's ~₹2.02/credit budget, so this stays
// at 1, but with less confidence than before; revisit once real OpenAI
// billing data (or a confirmed image-token count for gpt-5.5) exists.
export const PHOTO_CAPTION = HOOK_OR_CAPTION

// ─── Phase 1 text-stages migration (2026-10-25) ────────────────────────────
// Groq -> OpenAI gpt-5.5 (MODELS.creative) for hooks (lib/ai/hooks-generator.ts),
// reel_script/blog_post/ad_copy inside lib/ai/content-generator.ts, and the
// dedicated lib/ai/blog-generator.ts. Source for all the $ figures below:
// developers.openai.com/api/docs/pricing (checked 2026-10-25), gpt-5.5 at
// $5.00/1M input tokens, $30.00/1M output tokens. All of the following are
// ESTIMATES (typical token counts, not measured from real usage), using
// this file's existing ~₹2.02/credit reference ratio (at ~₹87/$, same
// assumed FX rate already used elsewhere in this file) to convert $ to
// credits:
//
// - hooks (reasoning_effort "low", max_completion_tokens 1000): a short
//   brainstorm list -- ~1,000 input + ~400 output tokens ≈
//   (1000/1e6*$5)+(400/1e6*$30) ≈ $0.017/call ≈ ₹1.48. Comfortably under
//   HOOK_OR_CAPTION's 1-credit budget -- no change needed.
// - ad_copy (reasoning_effort "low", max_completion_tokens 1200): similar
//   short-form scale to hooks -- stays safely under HOOK_OR_CAPTION's
//   1-credit budget, no change needed.
// - reel_script (reasoning_effort "medium", max_completion_tokens 2500):
//   a multi-scene script -- ~2,000 input + ~1,200 output tokens ≈
//   (2000/1e6*$5)+(1200/1e6*$30) ≈ $0.046/call ≈ ₹4.0 -- roughly 2x
//   HOOK_OR_CAPTION's ~₹2.02/credit value. Rather than bumping
//   HOOK_OR_CAPTION itself (which would overcharge hooks/ad_copy/
//   social_post, all genuinely cheaper), reel_script gets its own
//   override below in CONTENT_FORMAT_CREDIT_COSTS.
// - blog_post (both the dedicated tool and the Content-tab format,
//   reasoning_effort "medium", token budget scales with word count): an
//   800-word target ≈ ~2,000 input + ~1,200 output tokens ≈ the same
//   ~$0.046/call ≈ ₹4.0 math as reel_script -- BLOG_POST above was
//   recomputed from 1 to 2 for this reason.
//
// NOT recomputed: hooks/ad_copy's shared HOOK_OR_CAPTION value (real cost
// is comfortably under it, see above) and vision/PHOTO_CAPTION (see its
// own comment just above this block). story/carousel moved in Phase 1b --
// see the next block.

// ─── Phase 1b text-stages migration (2026-10-25) ───────────────────────────
// Groq -> OpenAI gpt-5.5 (MODELS.creative) for story, carousel, repurpose,
// occasion content and Autopilot's text calls. Source: OpenAI's official
// pricing page (developers.openai.com/api/docs/pricing, re-checked
// 2026-10-25): gpt-5.5 (<272K context, standard tier) at $5.00/1M input
// tokens, $30.00/1M output tokens (hidden reasoning tokens bill as output).
// ESTIMATES: the prices are sourced, the token counts are typical sizes
// for each prompt/budget, NOT measured from real usage. Same ~₹87/$ and
// ~₹2.02/credit reference ratio as above; rounded UP, same
// don't-underprice precedent as IMAGE/REEL.
//
// Per GENERATION, not per call: Story and Carousel each make ONE text call
// for the whole sequence (every slide in one JSON response), plus the two
// hook/CTA AI backgrounds already bundled into their price
// (2 x IMAGE = 4 credits).
//
// - STORY (app/api/v1/ai/stories/generate, "medium", budget
//   max(3000, slides*350)): ~2,500 input + ~2,000 output for a typical
//   5-slide sequence ≈ (2500/1e6*$5)+(2000/1e6*$30) ≈ $0.073 ≈ ₹6.3 ≈ 3.1
//   credits; a 10-slide sequence at its full ~3,500-token budget ≈ $0.118
//   ≈ 5.1 credits. + 4 bundled-background credits = ~7.1 typical (~9.1
//   worst case) -> 8 (was 6).
// - CAROUSEL (app/api/v1/ai/carousel/generate, "medium", budget
//   max(4000, slides*500)): ~3,000 input + ~2,000 output for a typical
//   7-slide carousel (Groq measured 1,499 completion tokens for this) ≈
//   $0.075 ≈ 3.2 credits; 10 slides ≈ ~3,000 output ≈ $0.105 ≈ 4.5
//   credits. + 4 bundled-background credits = ~7.2 typical (~8.5 worst
//   case, excluding the rare JSON-parse retry) -> existing 9 still covers
//   it, unchanged.
// - REPURPOSE (app/api/v1/ai/repurpose, "medium", 4500 budget, the widest
//   single output in the app): ~2,000 input (up to 5,000 chars of source
//   content) + ~2,500 output ≈ (2000/1e6*$5)+(2500/1e6*$30) ≈ $0.085 ≈
//   ₹7.4 ≈ 3.7 credits -> 4 (was 1). A JSON-parse retry (rare) doubles it.
// - Full Post / Content tab "story"/"carousel" formats (content-generator.ts,
//   text only, no images) charge these same STORY/CAROUSEL weights via
//   CONTENT_FORMAT_CREDIT_COSTS below. Their real cost is much lower
//   (~$0.03-0.07 including the parallel hooks call), so they're
//   overcharged relative to cost. Not changed here: lowering them is a
//   business pricing call, and that map shares one weight per format by
//   design.
// - Occasion content (app/api/v1/brands/[brandId]/generate-occasion-content):
//   ~300 input + ~600 output ≈ $0.020 ≈ 0.8 credits -- but this route has
//   never charged credits at all (no checkAndIncrementUsage call), so
//   there's no weight here to update. Flagged, not added.
// - Autopilot (lib/ai/fastlane.ts, charged per slot via
//   lib/ai/autopilot-content-mix.ts): per-slot text ("low", 1200-1800
//   budget) ≈ ~400 input + ~800-1,200 output ≈ $0.026-0.038 ≈ 1.1-1.6
//   credits. POST (5) and CAROUSEL (9) slot weights still cover that. The
//   once-per-run 30-slot planner (~1,500 input + ~5,000 output ≈ $0.16 ≈
//   6.8 credits) is absorbed by a run's total (~100+ credits for 30 slots).
//   Reel slots at their flat 1 credit run slightly under the ~1.6-credit
//   text cost, but reel credit logic is explicitly out of scope (see
//   autopilot-content-mix.ts). The strategy preview (~$0.04) is uncharged,
//   as before.

// app/api/v1/ai/repurpose (repurposing existing content into new formats,
// text-only) was on the base rate until it moved to OpenAI in Phase 1b
// (2026-10-25) -- see that block above for why it's now 4.
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
//
// "reel_script" is its own literal 2, not HOOK_OR_CAPTION, as of the Phase
// 1 text-stages migration (2026-10-25) -- see that migration's comment
// block above (search "Phase 1 text-stages migration") for why: its real
// OpenAI cost (~₹4.0/call) runs close to 2x HOOK_OR_CAPTION's ~₹2.02/credit
// value, and bumping HOOK_OR_CAPTION itself would overcharge the other
// formats that share it (social_post, ad_copy) even though their own real
// cost didn't move. ad_copy stays on HOOK_OR_CAPTION -- its real cost is
// still comfortably within budget.
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
// NOTE: this is below Starter's own Autopilot cost (74 credits for its
// 14-slot tier) — a trial account can fully explore manual generation
// (hooks, captions, carousels, images, etc.) but can never afford a
// single Autopilot run before subscribing. That side effect of the
// confirmed 50-credit number wasn't separately signed off on and is
// flagged back to the business rather than silently "fixed" here — see
// the pricing-revision task notes.
export const TRIAL_CREDIT_CAP = 50
