import type { RatedItem } from "./pattern-match"

interface RatableCaption {
  id: string
  caption_text: string
  user_rating: number
}

/**
 * Blends each caption's real Instagram engagement (content_engagement,
 * reached via calendar_entries.caption_id -- see supabase/migrations/
 * 052_calendar_entries_content_links.sql and lib/social/engagement-sync.ts's
 * own reachability notes) into the manual 1-5 user_rating buildPatternNote
 * expects, for whichever of these captions actually published and has
 * synced engagement -- most won't, today, and just fall back to their
 * plain user_rating below.
 *
 * Why relative rank, not raw counts: engagement_score is a plain
 * like_count + comments_count sum (supabase/migrations/
 * 051_content_engagement.sql) -- an account with 500 followers and one
 * with 50,000 are never comparable on that raw number, so a fixed
 * "> N counts as great" threshold would either be meaningless for small
 * accounts or trivially true for large ones. Ranking a caption's
 * engagement_score only against this SAME brand's other captions that also
 * have real engagement data (never a cross-brand or platform-wide scale)
 * sidesteps that: "this did better than most of what I've posted" holds
 * regardless of account size. That percentile rank is then mapped onto the
 * same 1-5 scale user_rating already uses, purely so buildPatternNote --
 * which only ever compares against that scale -- doesn't need to know
 * engagement data exists at all.
 *
 * Real engagement, when it exists, takes PRIORITY over the manual star
 * rating rather than being averaged with it: a caption a user rated 5
 * stars that actually underperformed everything else they've posted is a
 * worse "what's worked before" example than its real result says, and vice
 * versa for a caption they underrated at the time. A manual rating is a
 * guess made before anyone saw the post; a synced engagement number is
 * what actually happened.
 */
export async function resolveCaptionEngagementRatings(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  captions: RatableCaption[]
): Promise<RatedItem[]> {
  const fallback = (): RatedItem[] => captions.map((c) => ({ text: c.caption_text, rating: c.user_rating }))
  if (captions.length === 0) return []

  try {
    const captionIds = captions.map((c) => c.id)
    const { data: entries } = await supabase
      .from("calendar_entries")
      .select("id, caption_id")
      .in("caption_id", captionIds) as { data: { id: string; caption_id: string | null }[] | null }

    const entryIds = (entries ?? []).map((e) => e.id)
    if (entryIds.length === 0) return fallback()

    const { data: engagementRows } = await supabase
      .from("content_engagement")
      .select("calendar_entry_id, engagement_score")
      .in("calendar_entry_id", entryIds) as { data: { calendar_entry_id: string; engagement_score: number }[] | null }

    if (!engagementRows || engagementRows.length === 0) return fallback()

    const scoreByEntryId = new Map(engagementRows.map((r) => [r.calendar_entry_id, r.engagement_score]))

    // Most recent calendar entry per caption_id -- the column isn't
    // guaranteed unique, though one entry per caption is the common case.
    const entryIdByCaptionId = new Map<string, string>()
    for (const e of entries ?? []) {
      if (e.caption_id && !entryIdByCaptionId.has(e.caption_id)) entryIdByCaptionId.set(e.caption_id, e.id)
    }

    const scoreByCaptionId = new Map<string, number>()
    for (const c of captions) {
      const entryId = entryIdByCaptionId.get(c.id)
      const score = entryId !== undefined ? scoreByEntryId.get(entryId) : undefined
      if (score !== undefined) scoreByCaptionId.set(c.id, score)
    }

    if (scoreByCaptionId.size === 0) return fallback()

    // Ranked only among captions that actually have real engagement data --
    // mixing in never-published/never-synced siblings (score undefined)
    // would dilute the ranking with entries that aren't a real result at
    // all, rather than a genuinely low one.
    const sortedScores = Array.from(scoreByCaptionId.values()).sort((a, b) => a - b)

    const percentileToRating = (score: number): number => {
      // A single data point has nothing to rank against -- treat it as the
      // scale's midpoint rather than arbitrarily calling it best or worst.
      if (sortedScores.length === 1) return 3
      const strictlyBelow = sortedScores.filter((s) => s < score).length
      const percentile = strictlyBelow / (sortedScores.length - 1)
      return Math.round((1 + percentile * 4) * 10) / 10
    }

    return captions.map((c) => {
      const score = scoreByCaptionId.get(c.id)
      return { text: c.caption_text, rating: score !== undefined ? percentileToRating(score) : c.user_rating }
    })
  } catch (err) {
    console.error("[engagement-ratings] resolveCaptionEngagementRatings failed (non-fatal):", err)
    return fallback()
  }
}
