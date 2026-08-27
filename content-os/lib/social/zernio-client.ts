const ZERNIO_API_BASE = "https://zernio.com/api/v1"

function zernioHeaders(): HeadersInit {
  const apiKey = process.env.ZERNIO_API_KEY
  if (!apiKey) throw new Error("ZERNIO_API_KEY is not configured")
  return {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  }
}

export interface ZernioProfile {
  _id: string
  name: string
}

export async function createZernioProfile(name: string): Promise<ZernioProfile> {
  const res = await fetch(`${ZERNIO_API_BASE}/profiles`, {
    method: "POST",
    headers: zernioHeaders(),
    body: JSON.stringify({ name, description: `SocioPosts brand: ${name}` }),
  })
  const json = await res.json()

  // Zernio enforces unique profile names per account. This fires when an
  // earlier attempt created the profile at Zernio but failed at a later
  // step before it got persisted to social_connections (e.g. a request
  // that failed on getZernioConnectUrl right after) — our DB never learns
  // that profile exists, so every retry keeps trying to create a duplicate
  // and keeps colliding with it. Zernio's own conflict response hands back
  // the existing profile's id, so recover by reusing it instead of
  // treating this as fatal — the caller's normal "existing profile" path
  // then persists it, self-healing the gap for next time.
  if (res.status === 409 && json?.code === "profile_name_conflict" && json?.details?.existingProfileId) {
    console.error(`[zernio-client] createZernioProfile: name conflict for "${name}", reusing existingProfileId ${json.details.existingProfileId}`)
    return { _id: json.details.existingProfileId, name }
  }

  if (!res.ok || !json._id) {
    console.error(`[zernio-client] createZernioProfile failed (status ${res.status}):`, JSON.stringify(json))
    throw new Error(json?.message ?? json?.error ?? `Failed to create Zernio profile (${res.status})`)
  }
  return json
}

export interface ZernioConnectUrlResult {
  authUrl: string
  state: string
}

export async function getZernioConnectUrl(
  platform: string,
  profileId: string,
  redirectUrl: string
): Promise<ZernioConnectUrlResult> {
  const url = new URL(`${ZERNIO_API_BASE}/connect/${platform}`)
  url.searchParams.set("profileId", profileId)
  url.searchParams.set("redirect_url", redirectUrl)

  const res = await fetch(url.toString(), { headers: zernioHeaders() })
  const json = await res.json()
  if (!res.ok || !json.authUrl) {
    // Log the full body — a bare .message string has been misleading here
    // before (e.g. a profile-creation confirmation message surfacing on a
    // connect-URL failure), so the raw shape is needed to tell a genuine
    // Zernio-side rejection apart from us reading the wrong field name.
    console.error(`[zernio-client] getZernioConnectUrl(${platform}) failed (status ${res.status}):`, JSON.stringify(json))
    throw new Error(json?.message ?? json?.error ?? `Failed to start Zernio connect flow (${res.status})`)
  }
  return json
}

export type ZernioPublishResult =
  | { success: true; postId: string }
  | { success: false; error: string; retryable: boolean }

export interface ZernioMediaItem {
  type: "image" | "video"
  url: string
}

export async function publishViaZernio(
  platform: string,
  accountId: string,
  content: {
    text: string
    mediaUrls?: string[]
    // Explicit typed media, required by Zernio for anything beyond a single
    // plain attachment — Instagram carousels/Reels/Stories and Pinterest pins
    // all need { type, url } items (and Stories/Pinterest also need
    // platformSpecificData below); see docs.zernio.com/platforms/instagram
    // and /pinterest. Plain mediaUrls keeps working for the simpler
    // Twitter/LinkedIn/YouTube posts already using it.
    mediaItems?: ZernioMediaItem[]
    platformSpecificData?: Record<string, unknown>
    scheduledFor?: string
    timezone?: string
  }
): Promise<ZernioPublishResult> {
  try {
    const platformEntry: Record<string, unknown> = { platform, accountId }
    if (content.platformSpecificData) platformEntry.platformSpecificData = content.platformSpecificData

    const body: Record<string, unknown> = {
      content: content.text,
      platforms: [platformEntry],
    }
    if (content.mediaItems?.length) body.mediaItems = content.mediaItems
    else if (content.mediaUrls?.length) body.mediaUrls = content.mediaUrls
    if (content.scheduledFor) {
      body.scheduledFor = content.scheduledFor
      body.timezone = content.timezone ?? "Asia/Kolkata"
    } else {
      body.publishNow = true
    }

    const res = await fetch(`${ZERNIO_API_BASE}/posts`, {
      method: "POST",
      headers: zernioHeaders(),
      body: JSON.stringify(body),
    })
    const json = await res.json()
    const postId: string | undefined = json?.post?._id ?? json?._id

    if (!res.ok || !postId) {
      const message = json?.message ?? json?.error ?? `Zernio publish failed (${res.status})`
      const retryable = res.status === 429 || res.status >= 500
      console.error(`[zernio-client] publish to ${platform} failed (status ${res.status}):`, JSON.stringify(json))
      return { success: false, error: message, retryable }
    }

    return { success: true, postId }
  } catch (err) {
    console.error("[zernio-client] unexpected publish error:", err instanceof Error ? err.message : err)
    return { success: false, error: "Unexpected error publishing via Zernio.", retryable: true }
  }
}

export interface ZernioPinterestBoard {
  id: string
  name: string
}

// Pinterest's boardId is "effectively required" on every pin per Zernio's
// docs, but board selection isn't part of the OAuth connect step — this is
// called right after connecting to auto-pick a default board, the same way
// the old direct-OAuth flow auto-picked the first board.
export async function getZernioPinterestBoards(accountId: string): Promise<ZernioPinterestBoard[]> {
  const res = await fetch(`${ZERNIO_API_BASE}/accounts/${accountId}/pinterest-boards`, {
    headers: zernioHeaders(),
  })
  const json = await res.json()
  const boards = Array.isArray(json) ? json : Array.isArray(json?.boards) ? json.boards : null
  if (!res.ok || !boards) {
    console.error(`[zernio-client] getZernioPinterestBoards failed (status ${res.status}):`, JSON.stringify(json))
    throw new Error(json?.message ?? json?.error ?? `Failed to fetch Pinterest boards (${res.status})`)
  }
  return boards
}

// ─── Analytics (replaces direct Meta Graph API calls) ─────────────────────
//
// Zernio-connected accounts never give this app a usable Meta access
// token (Zernio holds it on its own side), so account analytics has to go
// through Zernio's own analytics endpoints instead of graph.facebook.com.
// Confirmed against docs.zernio.com/analytics/*: reach/engagement live
// under account-insights, follower growth needs the separate
// follower-history endpoint (Meta dropped follower_count from Graph API
// v22+'s /insights, so Zernio built a dedicated replacement), and there is
// no audience-demographics equivalent anywhere in Zernio's API — that gap
// is real, not a gap in this integration.

export interface ZernioInsightTimeSeriesPoint {
  date?: string
  value?: number
}

export interface ZernioInsightMetric {
  total?: number
  values?: ZernioInsightTimeSeriesPoint[]
}

export interface ZernioAnalyticsResponse {
  success?: boolean
  metrics?: Record<string, ZernioInsightMetric>
  unavailableMetrics?: { metric?: string; reason?: string; message?: string }[]
}

type ZernioAnalyticsFetchResult =
  | { ok: true; data: ZernioAnalyticsResponse }
  | { ok: false; error: string }

async function fetchZernioAnalytics(path: string, params: Record<string, string>): Promise<ZernioAnalyticsFetchResult> {
  const url = new URL(`${ZERNIO_API_BASE}${path}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

  try {
    const res = await fetch(url.toString(), { headers: zernioHeaders() })
    const json = await res.json()
    if (!res.ok) {
      console.error(`[zernio-client] ${path} failed (status ${res.status}):`, JSON.stringify(json))
      return { ok: false, error: json?.message ?? json?.error ?? `Request failed (${res.status})` }
    }
    return { ok: true, data: json }
  } catch (err) {
    console.error(`[zernio-client] ${path} unexpected error:`, err instanceof Error ? err.message : err)
    return { ok: false, error: "Unexpected error reaching Zernio." }
  }
}

/** metrics is a comma-separated list (e.g. "reach" or "accounts_engaged,total_interactions").
 * metricType applies to the whole request — Zernio only supports time_series for "reach";
 * every other metric here is total_value only. since/until are YYYY-MM-DD, not unix timestamps. */
export async function getZernioInstagramAccountInsights(
  accountId: string,
  metrics: string,
  metricType: "time_series" | "total_value",
  since: string,
  until: string
): Promise<ZernioAnalyticsFetchResult> {
  return fetchZernioAnalytics("/analytics/instagram/account-insights", { accountId, metrics, metricType, since, until })
}

export async function getZernioInstagramFollowerHistory(
  accountId: string,
  since: string,
  until: string
): Promise<ZernioAnalyticsFetchResult> {
  return fetchZernioAnalytics("/analytics/instagram/follower-history", {
    accountId,
    metrics: "follower_count",
    metricType: "time_series",
    since,
    until,
  })
}

export interface ZernioPostAnalyticsItem {
  content?: string
  publishedAt?: string
  platformPostUrl?: string
  mediaType?: string
  analytics?: { likes?: number; comments?: number; reach?: number }
}

/** Lists an account's posts with per-post analytics — source=all includes
 * both posts published through Zernio and ones synced from the platform
 * directly, so this isn't limited to only what this app itself published. */
export async function listZernioPostAnalytics(
  accountId: string,
  platform: string,
  limit: number
): Promise<{ ok: true; items: ZernioPostAnalyticsItem[] } | { ok: false; error: string }> {
  const url = new URL(`${ZERNIO_API_BASE}/analytics`)
  url.searchParams.set("accountId", accountId)
  url.searchParams.set("platform", platform)
  url.searchParams.set("source", "all")
  url.searchParams.set("limit", String(limit))
  url.searchParams.set("sortBy", "publishedAt")
  url.searchParams.set("order", "desc")

  try {
    const res = await fetch(url.toString(), { headers: zernioHeaders() })
    const json = await res.json()
    if (!res.ok) {
      console.error(`[zernio-client] listZernioPostAnalytics failed (status ${res.status}):`, JSON.stringify(json))
      return { ok: false, error: json?.message ?? json?.error ?? `Request failed (${res.status})` }
    }
    const items = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : Array.isArray(json?.posts) ? json.posts : null
    if (!items) {
      console.error("[zernio-client] listZernioPostAnalytics: unexpected response shape:", JSON.stringify(json).slice(0, 500))
      return { ok: false, error: "Unexpected response shape from Zernio." }
    }
    return { ok: true, items }
  } catch (err) {
    console.error("[zernio-client] listZernioPostAnalytics unexpected error:", err instanceof Error ? err.message : err)
    return { ok: false, error: "Unexpected error reaching Zernio." }
  }
}
