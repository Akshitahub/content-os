/**
 * The critic's criteria and score math (lib/ai/critic.ts) -- client-safe, so
 * the calendar card and the manual tools show the same numbers.
 */

export const CRITIC_CRITERIA = [
  { id: "stops_scroll", label: "Stops the scroll", weight: 2, ask: "Would a thumb stop on this in a busy feed? Bold, clear focal point, readable at phone size." },
  { id: "speaks_to_buyer", label: "Speaks to the buyer", weight: 1.5, ask: "Does it talk to this brand's actual buyer about something they care about?" },
  { id: "one_message", label: "One clear message", weight: 1, ask: "Is there exactly one idea, understood in two seconds?" },
  { id: "image_copy_agree", label: "Image and copy agree", weight: 1.5, ask: "Do the picture, the words on it and the caption say the same thing? Wrong product or mismatched scene fails." },
  { id: "craft", label: "Craft", weight: 1.5, ask: "Type, crop, contrast and layout: clean and intentional, nothing cut off, overlapping or illegible." },
  { id: "real_indian", label: "Looks real and Indian", weight: 1, ask: "Does it feel like a real photo of Indian life and buyers, not stock or obviously AI?" },
  { id: "reason_to_act", label: "Reason to act", weight: 1, ask: "Is there a concrete reason to tap, save, buy or reply now?" },
] as const

export type CriticCriterionId = (typeof CRITIC_CRITERIA)[number]["id"]
export type CriticScores = Record<CriticCriterionId, { score: number; reason: string }>

/** At or above this, a post goes out without a second look. */
export const CRITIC_PASS = 8
/** A score below this on a gate criterion caps the overall. */
export const CRITIC_FAIL_BELOW = 5
export const CRITIC_CAP = 6
const GATES: CriticCriterionId[] = ["image_copy_agree", "craft"]

/** Weighted average, one decimal; capped at 6 when image/copy agreement or craft fails. */
export function criticOverall(scores: CriticScores): number {
  let sum = 0
  let weights = 0
  for (const c of CRITIC_CRITERIA) {
    sum += scores[c.id].score * c.weight
    weights += c.weight
  }
  const avg = Math.round((sum / weights) * 10) / 10
  return GATES.some((g) => scores[g].score < CRITIC_FAIL_BELOW) ? Math.min(avg, CRITIC_CAP) : avg
}

/** What's saved on a calendar entry / shown on a card (platform_specific_data.critic). */
export interface SavedCritic {
  overall: number
  needs_approval: boolean
  top_fix: string
  /** The lowest-scoring criteria's reasons, worst first. */
  reasons: string[]
  candidates?: number
  regenerated?: boolean
}

export function toSavedCritic(r: { scores: CriticScores; overall: number; top_fix: string }, extra: { candidates?: number; regenerated?: boolean } = {}): SavedCritic {
  const reasons = [...CRITIC_CRITERIA]
    .sort((a, b) => r.scores[a.id].score - r.scores[b.id].score)
    .slice(0, 3)
    .filter((c) => r.scores[c.id].score < CRITIC_PASS)
    .map((c) => `${c.label} ${r.scores[c.id].score}/10: ${r.scores[c.id].reason}`)
  return { overall: r.overall, needs_approval: r.overall < CRITIC_PASS, top_fix: r.top_fix, reasons, ...extra }
}

export function isSavedCritic(v: unknown): v is SavedCritic {
  return !!v && typeof v === "object" && typeof (v as SavedCritic).overall === "number" && typeof (v as SavedCritic).needs_approval === "boolean"
}
