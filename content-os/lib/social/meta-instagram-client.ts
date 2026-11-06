/**
 * Instagram API with Instagram Login (Business Login for Instagram) -- the
 * direct connector, no Zernio. Per Meta's docs:
 *   authorize      https://www.instagram.com/oauth/authorize
 *   short-lived    POST https://api.instagram.com/oauth/access_token -> { data: [{ access_token, user_id, permissions }] }
 *   long-lived     GET  https://graph.instagram.com/access_token?grant_type=ig_exchange_token (60 days)
 *   refresh        GET  https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token
 *                  (token at least 24h old and not yet expired)
 *   publishing     POST /{ig-user-id}/media -> GET /{container}?fields=status_code -> POST /{ig-user-id}/media_publish
 *
 * Every function returns { ok: true, ... } | { ok: false, error } and never
 * throws. Tokens are never logged or put in an error: a failed provider
 * body is logged only through redactTokenFields, and request URLs (which
 * carry the token on GETs) are never logged.
 *
 * Image URLs must be public JPEGs -- Instagram accepts no other image
 * format (PNG / WebP fail at the container step). Converting our PNG
 * renders is done before these are called (commit 3).
 */
import { redactTokenFields } from "@/lib/social/oauth-log-safe"

const GRAPH_VERSION = "v27.0"
const GRAPH = `https://graph.instagram.com/${GRAPH_VERSION}`
const AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize"
const SHORT_TOKEN_URL = "https://api.instagram.com/oauth/access_token"
const LONG_TOKEN_URL = "https://graph.instagram.com/access_token"
const REFRESH_URL = "https://graph.instagram.com/refresh_access_token"

export const INSTAGRAM_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_insights",
] as const

/** Carousel children Instagram accepts. */
export const CAROUSEL_MIN = 2
export const CAROUSEL_MAX = 20

/** How long a container may take to process before we give up (ms). */
const POLL_CAP_MS = 60_000

export type Fail = { ok: false; error: string }
export type AuthorizeUrlResult = { ok: true; url: string } | Fail
export type TokenResult = { ok: true; token: string; expiresAt: string } | Fail
export type ExchangeResult = { ok: true; token: string; expiresAt: string; igUserId: string; username: string | null } | Fail
export type PublishResult = { ok: true; mediaId: string; permalink: string | null } | Fail
export type PublishingLimitResult = { ok: true; quotaUsage: number; quotaTotal: number | null; quotaDurationSeconds: number | null } | Fail

type Json = Record<string, unknown>

function appCredentials(): { ok: true; appId: string; appSecret: string } | Fail {
  const appId = process.env.INSTAGRAM_APP_ID
  const appSecret = process.env.INSTAGRAM_APP_SECRET
  if (!appId || !appSecret) return { ok: false, error: "Instagram direct connection is not configured" }
  return { ok: true, appId, appSecret }
}

/** Meta's error message from a body ({ error: { message } } or { error_message }), else a status line. */
function errorFrom(json: Json | null, status: number): string {
  const err = json?.error
  if (err && typeof err === "object" && typeof (err as Json).message === "string") return (err as Json).message as string
  if (typeof json?.error_message === "string") return json.error_message
  if (typeof err === "string") return err
  return `Instagram request failed (${status})`
}

/** One request: parsed JSON on 2xx, a token-free error otherwise. Never throws. */
async function request(label: string, url: string, init?: RequestInit): Promise<{ ok: true; json: Json } | Fail> {
  let res: Response
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) })
  } catch (e) {
    const name = e instanceof Error ? e.name : "Error"
    console.error(`[meta-instagram] ${label}: network error (${name})`)
    return { ok: false, error: name === "TimeoutError" ? "Instagram did not respond in time" : "Could not reach Instagram" }
  }
  const json = (await res.json().catch(() => null)) as Json | null
  if (!res.ok || !json || json.error) {
    console.error(`[meta-instagram] ${label} failed (status ${res.status}):`, JSON.stringify(redactTokenFields(json)))
    return { ok: false, error: errorFrom(json, res.status) }
  }
  return { ok: true, json }
}

function form(fields: Record<string, string>): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() }
}

function withQuery(base: string, params: Record<string, string>): string {
  const url = new URL(base)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return url.toString()
}

function expiresAtFrom(json: Json): string {
  const seconds = typeof json.expires_in === "number" ? json.expires_in : 60 * 24 * 3600
  return new Date(Date.now() + seconds * 1000).toISOString()
}

// ── Login ─────────────────────────────────────────────────────

export function buildAuthorizeUrl(state: string, redirectUri: string): AuthorizeUrlResult {
  const creds = appCredentials()
  if (!creds.ok) return creds
  return {
    ok: true,
    url: withQuery(AUTHORIZE_URL, {
      client_id: creds.appId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: INSTAGRAM_SCOPES.join(","),
      state,
    }),
  }
}

/** The ?code= from the redirect -> a long-lived (60-day) token and the account it's for. */
export async function exchangeCode(code: string, redirectUri: string): Promise<ExchangeResult> {
  const creds = appCredentials()
  if (!creds.ok) return creds
  // Instagram appends "#_" to the code in the redirect.
  const cleanCode = code.replace(/#_$/, "")

  const short = await request("exchangeCode: short-lived", SHORT_TOKEN_URL, form({
    client_id: creds.appId,
    client_secret: creds.appSecret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code: cleanCode,
  }))
  if (!short.ok) return short
  // Documented as { data: [{ ... }] }; older responses were flat.
  const first = (Array.isArray(short.json.data) ? short.json.data[0] : short.json) as Json | undefined
  const shortToken = typeof first?.access_token === "string" ? first.access_token : null
  if (!shortToken) return { ok: false, error: "Instagram returned no access token" }

  const long = await request("exchangeCode: long-lived", withQuery(LONG_TOKEN_URL, {
    grant_type: "ig_exchange_token",
    client_secret: creds.appSecret,
    access_token: shortToken,
  }))
  if (!long.ok) return long
  const token = typeof long.json.access_token === "string" ? long.json.access_token : null
  if (!token) return { ok: false, error: "Instagram returned no long-lived token" }

  // The professional account id publishing uses, and its handle.
  const me = await request("exchangeCode: me", withQuery(`${GRAPH}/me`, { fields: "user_id,username", access_token: token }))
  const fallbackId = first?.user_id != null ? String(first.user_id) : null
  const igUserId = me.ok && me.json.user_id != null ? String(me.json.user_id) : fallbackId
  if (!igUserId) return { ok: false, error: me.ok ? "Instagram returned no account id" : me.error }
  const username = me.ok && typeof me.json.username === "string" ? me.json.username : null

  return { ok: true, token, expiresAt: expiresAtFrom(long.json), igUserId, username }
}

/** A fresh 60 days for a long-lived token (it must be at least 24h old and unexpired). */
export async function refreshLongLivedToken(token: string): Promise<TokenResult> {
  const r = await request("refreshLongLivedToken", withQuery(REFRESH_URL, { grant_type: "ig_refresh_token", access_token: token }))
  if (!r.ok) return r
  const fresh = typeof r.json.access_token === "string" ? r.json.access_token : null
  if (!fresh) return { ok: false, error: "Instagram returned no refreshed token" }
  return { ok: true, token: fresh, expiresAt: expiresAtFrom(r.json) }
}

// ── Publishing ────────────────────────────────────────────────

async function createContainer(igUserId: string, token: string, fields: Record<string, string>, label: string): Promise<{ ok: true; id: string } | Fail> {
  const r = await request(`${label}: container`, `${GRAPH}/${encodeURIComponent(igUserId)}/media`, form({ ...fields, access_token: token }))
  if (!r.ok) return r
  return typeof r.json.id === "string" ? { ok: true, id: r.json.id } : { ok: false, error: "Instagram returned no container id" }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Poll a container's status_code until FINISHED: 1s, 2s, 4s, 8s... up to POLL_CAP_MS in all. */
async function waitUntilFinished(containerId: string, token: string, label: string): Promise<{ ok: true } | Fail> {
  const started = Date.now()
  let delay = 1000
  for (;;) {
    const r = await request(`${label}: status`, withQuery(`${GRAPH}/${encodeURIComponent(containerId)}`, { fields: "status_code,status", access_token: token }))
    if (!r.ok) return r
    const code = r.json.status_code
    if (code === "FINISHED" || code === "PUBLISHED") return { ok: true }
    if (code === "ERROR") return { ok: false, error: typeof r.json.status === "string" && r.json.status ? `Instagram could not process the media: ${r.json.status}` : "Instagram could not process the media" }
    if (code === "EXPIRED") return { ok: false, error: "The Instagram upload expired before it was published" }
    const left = POLL_CAP_MS - (Date.now() - started)
    if (left <= 0) return { ok: false, error: "Instagram is still processing the media -- try again in a few minutes" }
    await sleep(Math.min(delay, left))
    delay = Math.min(delay * 2, 10_000)
  }
}

async function publishContainer(igUserId: string, token: string, containerId: string, label: string): Promise<PublishResult> {
  const ready = await waitUntilFinished(containerId, token, label)
  if (!ready.ok) return ready
  const r = await request(`${label}: media_publish`, `${GRAPH}/${encodeURIComponent(igUserId)}/media_publish`, form({ creation_id: containerId, access_token: token }))
  if (!r.ok) return r
  const mediaId = typeof r.json.id === "string" ? r.json.id : null
  if (!mediaId) return { ok: false, error: "Instagram returned no media id" }
  // Published either way; the permalink is a nice-to-have.
  const link = await request(`${label}: permalink`, withQuery(`${GRAPH}/${encodeURIComponent(mediaId)}`, { fields: "permalink", access_token: token }))
  const permalink = link.ok && typeof link.json.permalink === "string" ? link.json.permalink : null
  return { ok: true, mediaId, permalink }
}

/** A feed image post. `imageUrl`: a public JPEG. */
export async function publishImage(igUserId: string, token: string, input: { imageUrl: string; caption: string }): Promise<PublishResult> {
  const c = await createContainer(igUserId, token, { image_url: input.imageUrl, caption: input.caption }, "publishImage")
  if (!c.ok) return c
  return publishContainer(igUserId, token, c.id, "publishImage")
}

/** A carousel of 2-20 images. Each `imageUrls` entry: a public JPEG. */
export async function publishCarousel(igUserId: string, token: string, input: { imageUrls: string[]; caption: string }): Promise<PublishResult> {
  const n = input.imageUrls.length
  if (n < CAROUSEL_MIN || n > CAROUSEL_MAX) return { ok: false, error: `A carousel needs ${CAROUSEL_MIN}-${CAROUSEL_MAX} images (got ${n})` }
  const children: string[] = []
  for (const [i, imageUrl] of input.imageUrls.entries()) {
    const label = `publishCarousel: item ${i + 1}`
    const c = await createContainer(igUserId, token, { image_url: imageUrl, is_carousel_item: "true" }, label)
    if (!c.ok) return c
    const ready = await waitUntilFinished(c.id, token, label)
    if (!ready.ok) return ready
    children.push(c.id)
  }
  const parent = await createContainer(igUserId, token, { media_type: "CAROUSEL", children: children.join(","), caption: input.caption }, "publishCarousel")
  if (!parent.ok) return parent
  return publishContainer(igUserId, token, parent.id, "publishCarousel")
}

/** A story image. `imageUrl`: a public JPEG. Stories take no caption. */
export async function publishStory(igUserId: string, token: string, input: { imageUrl: string }): Promise<PublishResult> {
  const c = await createContainer(igUserId, token, { media_type: "STORIES", image_url: input.imageUrl }, "publishStory")
  if (!c.ok) return c
  return publishContainer(igUserId, token, c.id, "publishStory")
}

/** A reel. `videoUrl`: a public video URL (MP4). */
export async function publishReel(igUserId: string, token: string, input: { videoUrl: string; caption: string }): Promise<PublishResult> {
  const c = await createContainer(igUserId, token, { media_type: "REELS", video_url: input.videoUrl, caption: input.caption }, "publishReel")
  if (!c.ok) return c
  return publishContainer(igUserId, token, c.id, "publishReel")
}

/** Posts used in the current 24h window, and the cap (Meta: enforced at media_publish). */
export async function getPublishingLimit(igUserId: string, token: string): Promise<PublishingLimitResult> {
  const r = await request("getPublishingLimit", withQuery(`${GRAPH}/${encodeURIComponent(igUserId)}/content_publishing_limit`, { fields: "quota_usage,config", access_token: token }))
  if (!r.ok) return r
  const row = (Array.isArray(r.json.data) ? r.json.data[0] : null) as Json | null
  if (!row || typeof row.quota_usage !== "number") return { ok: false, error: "Instagram returned no publishing limit" }
  const config = (row.config ?? null) as Json | null
  return {
    ok: true,
    quotaUsage: row.quota_usage,
    quotaTotal: typeof config?.quota_total === "number" ? config.quota_total : null,
    quotaDurationSeconds: typeof config?.quota_duration === "number" ? config.quota_duration : null,
  }
}

// ── Reading (insights scope: instagram_business_manage_insights) ──────────

export interface MetaMediaInsights {
  reach: number | null
  saved: number | null
  shares: number | null
  /** Meta's replacement for impressions (deprecated for media after July 2024). */
  views: number | null
}

export interface MetaMediaChild {
  id: string
  media_type: string
  media_url: string | null
  thumbnail_url: string | null
}

export interface MetaMedia {
  id: string
  caption: string | null
  media_type: string
  media_product_type: string | null
  media_url: string | null
  thumbnail_url: string | null
  permalink: string | null
  timestamp: string | null
  like_count: number | null
  comments_count: number | null
  children: MetaMediaChild[]
  insights: MetaMediaInsights
}

export interface MetaTaggedMedia {
  id: string
  caption: string | null
  media_type: string
  media_url: string | null
  permalink: string | null
  timestamp: string | null
  username: string | null
}

export interface MetaInsightPoint { date: string; value: number }
export interface MetaInsightMetric { total: number | null; values: MetaInsightPoint[] }
export type MetaInsightsResult = { ok: true; metrics: Record<string, MetaInsightMetric> } | Fail

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null)
const unix = (d: Date) => String(Math.floor(d.getTime() / 1000))
const NO_INSIGHTS: MetaMediaInsights = { reach: null, saved: null, shares: null, views: null }

/** Insights for one media item. Story / reel / feed support different metrics, so a refused set falls back to reach alone. */
async function mediaInsights(mediaId: string, productType: string | null, token: string): Promise<MetaMediaInsights> {
  const full = productType === "STORY" ? "reach,shares,views" : "reach,saved,shares,views"
  for (const metric of [full, "reach"]) {
    const r = await request("mediaInsights", withQuery(`${GRAPH}/${encodeURIComponent(mediaId)}/insights`, { metric, access_token: token }))
    if (!r.ok) continue
    const out = { ...NO_INSIGHTS }
    for (const row of (Array.isArray(r.json.data) ? r.json.data : []) as Json[]) {
      const first = Array.isArray(row.values) ? (row.values[0] as Json | undefined) : undefined
      const value = num(first?.value) ?? num((row.total_value as Json | undefined)?.value)
      if (row.name === "reach") out.reach = value
      else if (row.name === "saved") out.saved = value
      else if (row.name === "shares") out.shares = value
      else if (row.name === "views") out.views = value
    }
    return out
  }
  return { ...NO_INSIGHTS }
}

/** Runs `fn` over `items`, at most `n` at a time, keeping order. */
async function mapLimited<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]!)
  }))
  return out
}

/** The account's recent media, newest first, each with its insights (missing ones null). */
export async function listMedia(igUserId: string, token: string, limit: number): Promise<{ ok: true; items: MetaMedia[] } | Fail> {
  const fields = "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,children{id,media_type,media_url,thumbnail_url}"
  const r = await request("listMedia", withQuery(`${GRAPH}/${encodeURIComponent(igUserId)}/media`, { fields, limit: String(Math.max(1, Math.min(limit, 100))), access_token: token }))
  if (!r.ok) return r
  const rows = (Array.isArray(r.json.data) ? r.json.data : []) as Json[]
  const items = await mapLimited(rows, 5, async (m): Promise<MetaMedia> => {
    const id = String(m.id ?? "")
    const productType = str(m.media_product_type)
    const children = ((m.children as Json | undefined)?.data ?? []) as Json[]
    return {
      id,
      caption: str(m.caption),
      media_type: str(m.media_type) ?? "UNKNOWN",
      media_product_type: productType,
      media_url: str(m.media_url),
      thumbnail_url: str(m.thumbnail_url),
      permalink: str(m.permalink),
      timestamp: str(m.timestamp),
      like_count: num(m.like_count),
      comments_count: num(m.comments_count),
      children: children.map((c) => ({ id: String(c.id ?? ""), media_type: str(c.media_type) ?? "UNKNOWN", media_url: str(c.media_url), thumbnail_url: str(c.thumbnail_url) })),
      insights: id ? await mediaInsights(id, productType, token) : { ...NO_INSIGHTS },
    }
  })
  return { ok: true, items }
}

/**
 * Account insights over [since, until] (Meta caps a range at 30 days, so a
 * longer one is trimmed to the last 30). time_series: one point per day,
 * total = their sum; total_value: the total only.
 */
export async function getAccountInsights(
  igUserId: string,
  token: string,
  opts: { metrics: string[]; metricType: "time_series" | "total_value"; since: Date; until: Date }
): Promise<MetaInsightsResult> {
  const maxRange = 30 * 24 * 3600 * 1000
  const since = opts.until.getTime() - opts.since.getTime() > maxRange ? new Date(opts.until.getTime() - maxRange) : opts.since
  const r = await request("getAccountInsights", withQuery(`${GRAPH}/${encodeURIComponent(igUserId)}/insights`, {
    metric: opts.metrics.join(","),
    period: "day",
    metric_type: opts.metricType,
    since: unix(since),
    until: unix(opts.until),
    access_token: token,
  }))
  if (!r.ok) return r
  const metrics: Record<string, MetaInsightMetric> = {}
  for (const row of (Array.isArray(r.json.data) ? r.json.data : []) as Json[]) {
    const name = str(row.name)
    if (!name) continue
    const values = ((Array.isArray(row.values) ? row.values : []) as Json[])
      .map((v) => ({ date: str(v.end_time)?.slice(0, 10) ?? "", value: num(v.value) }))
      .filter((v): v is MetaInsightPoint => !!v.date && v.value !== null)
    const totalValue = num((row.total_value as Json | undefined)?.value)
    metrics[name] = { total: totalValue ?? (values.length ? values.reduce((s, v) => s + v.value, 0) : null), values }
  }
  return { ok: true, metrics }
}

/**
 * Follower count per day over the last ~30 days. Meta's follower_count is
 * new followers per day (accounts with 100+ followers only), so the totals
 * are rebuilt backwards from today's followers_count.
 */
export async function getFollowerHistory(igUserId: string, token: string, since: Date, until: Date): Promise<{ ok: true; values: MetaInsightPoint[] } | Fail> {
  const [daily, profile] = await Promise.all([
    getAccountInsights(igUserId, token, { metrics: ["follower_count"], metricType: "time_series", since, until }),
    request("getFollowerHistory: profile", withQuery(`${GRAPH}/${encodeURIComponent(igUserId)}`, { fields: "followers_count", access_token: token })),
  ])
  if (!daily.ok) return daily
  if (!profile.ok) return profile
  const current = num(profile.json.followers_count)
  if (current === null) return { ok: false, error: "Instagram returned no follower count" }
  const gains = [...(daily.metrics.follower_count?.values ?? [])].sort((a, b) => a.date.localeCompare(b.date))
  // The total at the end of each day = today's count minus every gain after that day.
  let after = 0
  const values: MetaInsightPoint[] = []
  for (let i = gains.length - 1; i >= 0; i--) {
    values.unshift({ date: gains[i]!.date, value: current - after })
    after += gains[i]!.value
  }
  return { ok: true, values }
}

/**
 * Media the account is tagged in (the /tags edge). Meta documents this edge
 * for Facebook Login; with Instagram Login it may be refused -- that comes
 * back as { ok: false } like any other error.
 */
export async function listTaggedMedia(igUserId: string, token: string, limit = 50): Promise<{ ok: true; items: MetaTaggedMedia[] } | Fail> {
  const r = await request("listTaggedMedia", withQuery(`${GRAPH}/${encodeURIComponent(igUserId)}/tags`, {
    fields: "id,caption,media_type,media_url,permalink,timestamp,username",
    limit: String(limit),
    access_token: token,
  }))
  if (!r.ok) return r
  const rows = (Array.isArray(r.json.data) ? r.json.data : []) as Json[]
  return {
    ok: true,
    items: rows.map((m) => ({
      id: String(m.id ?? ""),
      caption: str(m.caption),
      media_type: str(m.media_type) ?? "UNKNOWN",
      media_url: str(m.media_url),
      permalink: str(m.permalink),
      timestamp: str(m.timestamp),
      username: str(m.username),
    })).filter((m) => m.id),
  }
}
