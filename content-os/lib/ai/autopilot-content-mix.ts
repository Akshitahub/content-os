import { POST as POST_CREDIT_COST, CAROUSEL as CAROUSEL_CREDIT_COST } from "@/lib/usage/credit-costs"

// Pure, no server-only imports (no Groq, no Supabase) -- safe to import
// from both server code (lib/ai/fastlane.ts) and client components
// (app/(dashboard)/brands/[brandId]/fastlane/page.tsx) alike, so the
// credit-cost/slot-count estimate shown before a run always matches what
// actually gets charged and generated, with no hand-duplicated copy of
// this math to drift out of sync.

export const CONTENT_MIX = [
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

/** Scales a content mix (whose counts sum to `sourceTotal`) down to sum to
 * `targetTotal` instead — proportional per category, with the leftover
 * from rounding handed to the categories with the largest fractional
 * remainder first (so the result still sums exactly to targetTotal).
 * Categories that round down to 0 are dropped entirely, since a "0 slots"
 * line in the prompt's required-mix list only confuses the model. Used for
 * Starter's smaller Autopilot tier (14 slots instead of 30) — a no-op when
 * targetTotal already matches sourceTotal. */
export function scaleMix(mix: typeof CONTENT_MIX, targetTotal: number): typeof CONTENT_MIX {
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

export function buildContentMix(focusAreas?: string[], totalSlots = 30): typeof CONTENT_MIX {
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

/**
 * A run's real slot count from the user's chosen posting frequency, capped
 * at the plan tier's own max — matching the "~13 posts" / "~22 posts" /
 * "30 posts" figures already shown in the UI (PricingSection.tsx's
 * MANUAL_POSTS_TARGET and the Autopilot setup screen's own frequency copy),
 * rather than always running every tier at its full tierMaxSlots regardless
 * of what frequency was actually picked.
 */
export function computeAutopilotSlotCount(frequency: string | undefined, tierDays: number, tierMaxSlots: number): number {
  const postsPerWeek = frequency === "3x_week" ? 3 : frequency === "5x_week" ? 5 : 7
  return Math.min(tierMaxSlots, Math.ceil((tierDays / 7) * postsPerWeek))
}

// Real per-slot-type credit cost — lib/ai/fastlane.ts shows every content_type
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
 * Exported so both app/api/v1/brands/fastlane/route.ts (pre-flight
 * affordability check and the real charge after the run completes) and the
 * Autopilot setup page's own pre-launch estimate can share the exact same
 * mix buildStrategyUserPrompt/executeFastlane actually use, instead of
 * duplicating buildContentMix's mix-selection logic or drifting out of
 * sync with it.
 */
export function estimateAutopilotCreditCost(focusAreas?: string[], totalSlots = 30): number {
  const mix = buildContentMix(focusAreas, totalSlots)
  return mix.reduce((sum, m) => sum + m.count * (SLOT_CONTENT_TYPE_CREDIT_COST[m.format] ?? 1), 0)
}
