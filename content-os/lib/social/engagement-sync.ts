import type { SupabaseClient } from "@supabase/supabase-js"
import { listZernioPostAnalytics, type ZernioPostAnalyticsItem } from "./zernio-client"
import type { CalendarEntryRow } from "@/types/database"

// Fetches this brand's real Instagram post analytics (via
// listZernioPostAnalytics -- reused as-is from lib/social/zernio-client.ts,
// never re-implemented) and links each item it can confidently match back
// to the calendar_entries row that published it, storing the result in the
// content_engagement table (see supabase/migrations/051_content_engagement.sql
// for why that table is keyed by calendar_entry_id rather than columns on
// each content table, or a polymorphic content_type+id pair).
//
// Per-content-type reachability, checked against the real schema (see
// types/database.ts) before writing this:
// - captions: calendar_entries.caption_id -> captions.id -- but only when
//   the entry was created by the Autopilot/direct-generation insert paths
//   (lib/ai/fastlane.ts, app/api/v1/ai/captions/generate/route.ts). A post
//   scheduled from the Library (app/api/v1/calendar/schedule-post/route.ts)
//   never sets caption_id at all.
// - hooks: calendar_entries.hook_id -> hooks.id -- same caveat as captions.
// - generated_images: calendar_entries.content_project_id ->
//   generated_images.content_project_id, and only for the Create -> Full
//   Post flow -- Autopilot's own calendar_entries never set
//   content_project_id (its images live in platform_specific_data instead).
// - reel_scripts: reachable ONLY for Autopilot-generated reels, via the
//   reverse link reel_video_jobs.calendar_entry_id -> reel_video_jobs.id ->
//   reel_video_jobs.reel_script_id -> reel_scripts.id. A manually-generated
//   reel script later scheduled as a video has no such row and no link.
// - carousels, stories, ad_copies: NO link at all, in either direction.
//   Neither table has a calendar_entries column, and calendar_entries has
//   no carousel_id/story_id/ad_copy_id column either -- these three
//   content types are fully denormalized onto calendar_entries (slides/
//   image URLs copied into platform_specific_data at generation or
//   schedule time) with nothing left to join back to the original row.
//
// Anchoring content_engagement on calendar_entries.id sidesteps all of the
// above: every published post has exactly one calendar_entries row
// regardless of type or origin, so that's what this stores engagement
// against -- a future pass can decide how (or whether) to propagate a
// given entry's engagement back onto captions.performance_score /
// hooks.performance_score for the subset of entries that do have a clean
// FK, once buildPatternNote is actually wired up to use any of this.
export interface EngagementSyncResult {
  /** New calendar_entry <-> Zernio post matches found and stored this run. */
  matched: number
  /** Entries that already had a stored platform_post_url from a previous
   * sync -- refreshed via that direct URL match instead of re-running the
   * caption/time heuristic. */
  refreshed: number
  /** Published entries in the lookback window with no confident match in
   * this batch of Zernio analytics items (nothing wrong -- Zernio's own
   * analytics list is itself limited/paginated, same as
   * instagram-insights.ts's own fetchAccountMedia). */
  unmatched: number
  errors: string[]
}

// listZernioPostAnalytics's own practical page size -- matches
// instagram-insights.ts's MEDIA_LIMIT, so this sync sees the same recent
// window that tool already treats as "the account's recent posts."
const ANALYTICS_LIMIT = 25

// Published calendar entries older than this aren't worth checking against
// a 25-item recent-posts page at all -- nothing to gain from including
// them in the match pass.
const LOOKBACK_DAYS = 30

// Zernio's own recorded publishedAt for a post and this app's own
// updated_at at the moment cron/publish-scheduled/route.ts flips an entry
// to "published" can differ by more than a few seconds (processing time,
// Instagram's own ingestion delay, clock skew) -- generous, but still tight
// enough that two real posts published hours apart won't cross-match.
const PUBLISHED_AT_TOLERANCE_MS = 6 * 60 * 60 * 1000

function normalizeText(text: string | null | undefined): string {
  return (text ?? "").trim().toLowerCase().replace(/\s+/g, " ")
}

// No shared id exists between what publishViaZernio returns at publish
// time (Zernio's own internal post _id) and what listZernioPostAnalytics
// returns per item (platformPostUrl/publishedAt/content) -- see this
// file's own module comment. Matches on caption-text overlap (one
// normalized string contains the other, so hashtags appended or stripped
// by either side don't break the match) plus published-time proximity,
// and picks whichever candidate's publishedAt is closest when more than
// one clears both bars.
function findMatchingAnalyticsItem(
  entry: Pick<CalendarEntryRow, "caption_text" | "updated_at">,
  items: ZernioPostAnalyticsItem[]
): ZernioPostAnalyticsItem | null {
  const entryCaption = normalizeText(entry.caption_text)
  const entryPublishedAt = new Date(entry.updated_at).getTime()
  if (!entryCaption || Number.isNaN(entryPublishedAt)) return null

  let best: { item: ZernioPostAnalyticsItem; deltaMs: number } | null = null
  for (const item of items) {
    if (!item.publishedAt) continue
    const itemCaption = normalizeText(item.content)
    if (!itemCaption) continue
    if (!itemCaption.includes(entryCaption) && !entryCaption.includes(itemCaption)) continue

    const itemPublishedAt = new Date(item.publishedAt).getTime()
    if (Number.isNaN(itemPublishedAt)) continue
    const deltaMs = Math.abs(itemPublishedAt - entryPublishedAt)
    if (deltaMs > PUBLISHED_AT_TOLERANCE_MS) continue

    if (!best || deltaMs < best.deltaMs) best = { item, deltaMs }
  }
  return best?.item ?? null
}

/**
 * Runs one engagement-sync pass for a single brand's Instagram account.
 * `supabase` is injected (not created here) so this works identically from
 * an on-demand, user-scoped route (RLS-enforced) or, later, an admin-scoped
 * cron across every brand -- same dependency-injection pattern
 * lib/ai/fastlane.ts's executeFastlane already uses. Never throws -- a
 * Zernio failure or an empty match set is a normal, loggable outcome.
 */
export async function syncEngagementForBrand(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  brandId: string,
  zernioAccountId: string
): Promise<EngagementSyncResult> {
  const result: EngagementSyncResult = { matched: 0, refreshed: 0, unmatched: 0, errors: [] }

  const analyticsResult = await listZernioPostAnalytics(zernioAccountId, "instagram", ANALYTICS_LIMIT)
  if (!analyticsResult.ok) {
    result.errors.push(analyticsResult.error)
    return result
  }
  const items = analyticsResult.items

  const sinceDate = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: publishedEntries, error: entriesError } = await supabase
    .from("calendar_entries")
    .select("id, caption_text, updated_at")
    .eq("brand_id", brandId)
    .eq("platform", "instagram")
    .eq("status", "published")
    .gte("updated_at", sinceDate) as {
      data: Pick<CalendarEntryRow, "id" | "caption_text" | "updated_at">[] | null
      error: { message: string } | null
    }

  if (entriesError) {
    result.errors.push(entriesError.message)
    return result
  }
  const entries = publishedEntries ?? []
  if (entries.length === 0) return result

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existingLinks } = await (supabase.from("content_engagement") as any)
    .select("calendar_entry_id, platform_post_url")
    .in("calendar_entry_id", entries.map((e) => e.id)) as {
      data: { calendar_entry_id: string; platform_post_url: string | null }[] | null
    }

  const existingUrlByEntry = new Map(
    (existingLinks ?? []).map((r) => [r.calendar_entry_id, r.platform_post_url])
  )

  for (const entry of entries) {
    const existingUrl = existingUrlByEntry.get(entry.id)
    // Fast path: already matched in a previous sync -- match directly by
    // the stored permalink instead of re-running the caption/time
    // heuristic (which could, in principle, drift onto a different post if
    // the brand has since published something with very similar text).
    let matchedItem = existingUrl ? items.find((i) => i.platformPostUrl === existingUrl) ?? null : null
    if (!matchedItem) matchedItem = findMatchingAnalyticsItem(entry, items)

    if (!matchedItem) {
      result.unmatched++
      continue
    }

    const likeCount = matchedItem.analytics?.likes ?? 0
    const commentsCount = matchedItem.analytics?.comments ?? 0

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upsertError } = await (supabase.from("content_engagement") as any)
      .upsert(
        {
          calendar_entry_id: entry.id,
          brand_id: brandId,
          platform: "instagram",
          platform_post_url: matchedItem.platformPostUrl ?? null,
          like_count: likeCount,
          comments_count: commentsCount,
          // A plain sum, not a weighted formula -- see the migration's own
          // comment on why this is left simple and honest for now.
          engagement_score: likeCount + commentsCount,
          fetched_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "calendar_entry_id" }
      )

    if (upsertError) {
      result.errors.push(`entry ${entry.id}: ${upsertError.message}`)
      continue
    }

    if (existingUrl) result.refreshed++
    else result.matched++
  }

  return result
}
