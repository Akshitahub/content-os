/**
 * One way to read a brand's Instagram, whichever way it's connected: a
 * Zernio row reads through the existing Zernio functions, unchanged; a
 * direct row (provider 'meta') reads Meta's API with the stored token. The
 * results come back in the shapes callers already use -- Zernio's post
 * analytics items and its insights response -- so nothing downstream
 * changes.
 *
 * Server-only: decrypts tokens (lib/social/token-crypto.ts).
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import type { SocialConnectionRow } from "@/types/database"
import {
  getZernioInstagramAccountInsights,
  getZernioInstagramFollowerHistory,
  listZernioPostAnalytics,
  type ZernioAnalyticsFetchResult,
  type ZernioPostAnalyticsItem,
} from "./zernio-client"
import { getAccountInsights, getFollowerHistory, listMedia, listTaggedMedia, type MetaTaggedMedia } from "./meta-instagram-client"
import { decryptToken } from "./token-crypto"

export type InstagramSource =
  | { kind: "zernio"; accountId: string }
  | { kind: "meta"; igUserId: string; token: string }

/**
 * A Zernio post analytics item, plus what a direct read also knows: the
 * Instagram media id (exact engagement matching) and the image URLs (the
 * fields lib/brand-photos.ts already looks for).
 */
export type InstagramPostItem = ZernioPostAnalyticsItem & {
  igMediaId?: string
  mediaUrl?: string
  thumbnailUrl?: string
  children?: { mediaType: string; mediaUrl?: string }[]
}

type ConnectionFields = Pick<SocialConnectionRow, "zernio_account_id" | "ig_business_account_id" | "access_token"> & { provider?: string | null }

/** How to read this connection -- or null when it can't be read (no account linked, or an unusable token). */
export function instagramSourceFor(conn: ConnectionFields | null | undefined): InstagramSource | null {
  if (!conn) return null
  if (conn.provider === "meta") {
    if (!conn.ig_business_account_id || !conn.access_token) return null
    const token = decryptToken(conn.access_token)
    if (!token.ok) {
      console.error(`[instagram-source] direct connection token unusable: ${token.error}`)
      return null
    }
    return { kind: "meta", igUserId: conn.ig_business_account_id, token: token.value }
  }
  return conn.zernio_account_id ? { kind: "zernio", accountId: conn.zernio_account_id } : null
}

/**
 * The brand's active Instagram connection as a source. select("*") so it
 * works before migration 072 adds provider (every row reads as Zernio then).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadInstagramSource(db: SupabaseClient<any>, brandId: string): Promise<InstagramSource | null> {
  const { data } = await db.from("social_connections").select("*").eq("brand_id", brandId).eq("platform", "instagram").eq("is_active", true).maybeSingle() as { data: ConnectionFields | null }
  return instagramSourceFor(data)
}

/** Recent posts with per-post analytics, newest first. */
export async function listInstagramPosts(source: InstagramSource, limit: number): Promise<{ ok: true; items: InstagramPostItem[] } | { ok: false; error: string }> {
  if (source.kind === "zernio") return listZernioPostAnalytics(source.accountId, "instagram", limit)
  const res = await listMedia(source.igUserId, source.token, limit)
  if (!res.ok) return res
  return {
    ok: true,
    items: res.items.map((m): InstagramPostItem => ({
      content: m.caption ?? undefined,
      publishedAt: m.timestamp ?? undefined,
      platformPostUrl: m.permalink ?? undefined,
      mediaType: m.media_type,
      analytics: {
        likes: m.like_count ?? undefined,
        comments: m.comments_count ?? undefined,
        reach: m.insights.reach ?? undefined,
        saves: m.insights.saved ?? undefined,
        shares: m.insights.shares ?? undefined,
        // Meta replaced impressions with views; it fills the same column.
        impressions: m.insights.views ?? undefined,
      },
      igMediaId: m.id,
      mediaUrl: m.media_url ?? undefined,
      thumbnailUrl: m.thumbnail_url ?? undefined,
      children: m.children.length ? m.children.map((c) => ({ mediaType: c.media_type, mediaUrl: c.media_url ?? undefined })) : undefined,
    })),
  }
}

const fromDateStr = (d: string, endOfDay = false) => new Date(`${d}T${endOfDay ? "23:59:59" : "00:00:00"}Z`)

/** Account insights in Zernio's response shape. metrics: comma-separated; since/until: YYYY-MM-DD. */
export async function instagramAccountInsights(
  source: InstagramSource,
  metrics: string,
  metricType: "time_series" | "total_value",
  since: string,
  until: string
): Promise<ZernioAnalyticsFetchResult> {
  if (source.kind === "zernio") return getZernioInstagramAccountInsights(source.accountId, metrics, metricType, since, until)
  const res = await getAccountInsights(source.igUserId, source.token, { metrics: metrics.split(","), metricType, since: fromDateStr(since), until: fromDateStr(until, true) })
  if (!res.ok) return res
  return {
    ok: true,
    data: { metrics: Object.fromEntries(Object.entries(res.metrics).map(([name, m]) => [name, { total: m.total ?? undefined, values: m.values }])) },
  }
}

/** Follower totals over time in Zernio's response shape (metrics.follower_count). */
export async function instagramFollowerHistory(source: InstagramSource, since: string, until: string): Promise<ZernioAnalyticsFetchResult> {
  if (source.kind === "zernio") return getZernioInstagramFollowerHistory(source.accountId, since, until)
  const res = await getFollowerHistory(source.igUserId, source.token, fromDateStr(since), fromDateStr(until, true))
  if (!res.ok) return res
  return { ok: true, data: { metrics: { follower_count: { values: res.values } } } }
}

/** Media the account is tagged in -- direct connections only (Zernio has no such listing). */
export async function instagramTaggedMedia(source: Extract<InstagramSource, { kind: "meta" }>): Promise<{ ok: true; items: MetaTaggedMedia[] } | { ok: false; error: string }> {
  return listTaggedMedia(source.igUserId, source.token)
}
