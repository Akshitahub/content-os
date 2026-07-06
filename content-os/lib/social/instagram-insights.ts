import { interpretGraphError, type GraphErrorBody } from "./graph-api-errors"

const GRAPH_VERSION = "v21.0"
const INSIGHTS_WINDOW_DAYS = 30
const MEDIA_LIMIT = 25

export interface InsightsSeriesPoint {
  date: string
  value: number
}

export interface MetricAvailability<T> {
  available: boolean
  value: T | null
  /** Set whenever available is false — the reason, shown to the user instead of a fake zero. */
  note: string | null
}

export interface AccountMedia {
  id: string
  caption: string | null
  like_count: number
  comments_count: number
  timestamp: string
  media_type: string
  permalink: string
  media_url: string | null
}

export interface DemographicBreakdownItem {
  label: string
  value: number
  percentage: number
}

export interface AccountDemographics {
  ageRanges: DemographicBreakdownItem[]
  genderSplit: DemographicBreakdownItem[]
  topCities: DemographicBreakdownItem[]
  topCountries: DemographicBreakdownItem[]
}

export interface AccountInsightsData {
  windowDays: number
  reach: MetricAvailability<{ total: number; series: InsightsSeriesPoint[] }>
  followerGrowth: MetricAvailability<{ netChange: number; series: InsightsSeriesPoint[] }>
  engagement: MetricAvailability<{ totalInteractions: number; accountsEngaged: number | null }>
  demographics: MetricAvailability<AccountDemographics>
  media: AccountMedia[]
}

export type AccountInsightsResult =
  | { success: true; data: AccountInsightsData }
  | { success: false; error: string }

type RawTimeSeriesValue = { value?: number; end_time?: string }
type RawInsightMetric = { name?: string; values?: RawTimeSeriesValue[]; total_value?: { value?: number } }
type RawAccountMedia = {
  id?: string
  caption?: string
  like_count?: number
  comments_count?: number
  timestamp?: string
  media_type?: string
  permalink?: string
  media_url?: string
}

function toFriendlyMetricError(body: GraphErrorBody, fallback: string): string {
  const interpreted = interpretGraphError(body)
  if (interpreted.kind === "invalid_token" || interpreted.kind === "permission_error") {
    return "Instagram access token is invalid or expired. Reconnect the account."
  }
  if (interpreted.kind === "rate_limit") {
    return "Instagram rate limit reached — try again shortly."
  }
  return interpreted.message || fallback
}

type MetricFetchResult =
  | { ok: true; data: RawInsightMetric[] }
  | { ok: false; error: string }

/**
 * Fetches one group of account-level Insights metrics. Metric groups are
 * fetched separately (not all in one call) so that one metric being
 * unavailable for this account (e.g. follower_count needs 100+ followers)
 * can't take down metrics that would otherwise succeed.
 */
async function fetchInsightsMetric(
  igBusinessAccountId: string,
  accessToken: string,
  metrics: string,
  metricType: "time_series" | "total_value",
  sinceUnix: number,
  untilUnix: number
): Promise<MetricFetchResult> {
  try {
    const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${igBusinessAccountId}/insights`)
    url.searchParams.set("metric", metrics)
    url.searchParams.set("period", "day")
    url.searchParams.set("metric_type", metricType)
    url.searchParams.set("since", String(sinceUnix))
    url.searchParams.set("until", String(untilUnix))
    url.searchParams.set("access_token", accessToken)

    const res = await fetch(url.toString())
    const json = await res.json()

    if (!res.ok || !Array.isArray(json.data)) {
      const message = toFriendlyMetricError(json as GraphErrorBody, `Couldn't fetch ${metrics}.`)
      console.error(`[instagram-insights] fetch failed for ${metrics}:`, message)
      return { ok: false, error: message }
    }

    return { ok: true, data: json.data as RawInsightMetric[] }
  } catch (err) {
    console.error(`[instagram-insights] unexpected error fetching ${metrics}:`, err instanceof Error ? err.message : err)
    return { ok: false, error: `Unexpected error fetching ${metrics}.` }
  }
}

type RawDemographicBreakdownResult = { dimension_values?: string[]; value?: number }
type RawDemographicMetric = {
  name?: string
  total_value?: { breakdowns?: { results?: RawDemographicBreakdownResult[] }[] }
}

type DemographicFetchResult =
  | { ok: true; data: RawDemographicMetric[] }
  | { ok: false; error: string }

const GENDER_LABELS: Record<string, string> = { F: "Female", M: "Male", U: "Unspecified" }

/**
 * Fetches one dimension of follower_demographics (age/gender/city/country).
 * This uses different query params (period=lifetime, a breakdown dimension,
 * no since/until window) than fetchInsightsMetric above, so it's its own
 * function rather than a variant of that one. Each dimension is fetched
 * independently — same "one failure can't take down the others" reasoning
 * as the rest of this file, just applied across four calls instead of one.
 */
async function fetchDemographicBreakdown(
  igBusinessAccountId: string,
  accessToken: string,
  breakdown: "age" | "gender" | "city" | "country"
): Promise<DemographicFetchResult> {
  try {
    const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${igBusinessAccountId}/insights`)
    url.searchParams.set("metric", "follower_demographics")
    url.searchParams.set("period", "lifetime")
    url.searchParams.set("metric_type", "total_value")
    url.searchParams.set("breakdown", breakdown)
    url.searchParams.set("access_token", accessToken)

    const res = await fetch(url.toString())
    const json = await res.json()

    if (!res.ok || !Array.isArray(json.data)) {
      const message = toFriendlyMetricError(json as GraphErrorBody, `Couldn't fetch follower demographics (${breakdown}).`)
      console.error(`[instagram-insights] demographics fetch failed for ${breakdown}:`, message)
      return { ok: false, error: message }
    }

    return { ok: true, data: json.data as RawDemographicMetric[] }
  } catch (err) {
    console.error(`[instagram-insights] unexpected error fetching demographics (${breakdown}):`, err instanceof Error ? err.message : err)
    return { ok: false, error: `Unexpected error fetching follower demographics (${breakdown}).` }
  }
}

function extractDemographicResults(result: DemographicFetchResult): RawDemographicBreakdownResult[] {
  if (!result.ok) return []
  const metric = result.data.find((m) => m.name === "follower_demographics")
  return metric?.total_value?.breakdowns?.[0]?.results ?? []
}

function toBreakdownItems(
  results: RawDemographicBreakdownResult[],
  options?: { labelMap?: Record<string, string>; cap?: number }
): DemographicBreakdownItem[] {
  const valid = results.filter(
    (r): r is { dimension_values: string[]; value: number } =>
      Array.isArray(r.dimension_values) && typeof r.dimension_values[0] === "string" && typeof r.value === "number"
  )
  const total = valid.reduce((sum, r) => sum + r.value, 0)
  if (total === 0) return []

  const items = valid
    .map((r) => {
      const rawLabel = r.dimension_values[0]!
      return {
        label: options?.labelMap?.[rawLabel] ?? rawLabel,
        value: r.value,
        percentage: Math.round((r.value / total) * 100),
      }
    })
    .sort((a, b) => b.value - a.value)

  return options?.cap ? items.slice(0, options.cap) : items
}

function buildDemographicsMetric(
  ageResult: DemographicFetchResult,
  genderResult: DemographicFetchResult,
  cityResult: DemographicFetchResult,
  countryResult: DemographicFetchResult
): AccountInsightsData["demographics"] {
  const ageRanges = toBreakdownItems(extractDemographicResults(ageResult))
  const genderSplit = toBreakdownItems(extractDemographicResults(genderResult), { labelMap: GENDER_LABELS })
  const topCities = toBreakdownItems(extractDemographicResults(cityResult), { cap: 5 })
  const topCountries = toBreakdownItems(extractDemographicResults(countryResult), { cap: 5 })

  // Only treat the whole feature as unavailable if every dimension came back
  // empty — a single failing dimension (e.g. gender) shouldn't null out
  // dimensions that did succeed (e.g. city/country).
  if (ageRanges.length === 0 && genderSplit.length === 0 && topCities.length === 0 && topCountries.length === 0) {
    return {
      available: false,
      value: null,
      note: "Not enough audience data yet — Instagram requires 100+ followers before demographics become available.",
    }
  }

  return {
    available: true,
    value: { ageRanges, genderSplit, topCities, topCountries },
    note: null,
  }
}

async function fetchAccountMedia(
  igBusinessAccountId: string,
  accessToken: string
): Promise<{ ok: true; data: AccountMedia[] } | { ok: false; error: string }> {
  try {
    const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${igBusinessAccountId}/media`)
    url.searchParams.set("fields", "id,caption,like_count,comments_count,timestamp,media_type,permalink,media_url")
    url.searchParams.set("limit", String(MEDIA_LIMIT))
    url.searchParams.set("access_token", accessToken)

    const res = await fetch(url.toString())
    const json = await res.json()

    if (!res.ok || !Array.isArray(json.data)) {
      const message = toFriendlyMetricError(json as GraphErrorBody, "Couldn't fetch recent media.")
      console.error("[instagram-insights] media fetch failed:", message)
      return { ok: false, error: message }
    }

    const rawMedia = json.data as RawAccountMedia[]
    const media: AccountMedia[] = rawMedia
      .filter((m): m is RawAccountMedia & { id: string; timestamp: string } => typeof m.id === "string" && typeof m.timestamp === "string")
      .map((m) => ({
        id: m.id,
        caption: m.caption ?? null,
        like_count: typeof m.like_count === "number" ? m.like_count : 0,
        comments_count: typeof m.comments_count === "number" ? m.comments_count : 0,
        timestamp: m.timestamp,
        media_type: m.media_type ?? "UNKNOWN",
        permalink: m.permalink ?? "",
        media_url: m.media_url ?? null,
      }))

    return { ok: true, data: media }
  } catch (err) {
    console.error("[instagram-insights] unexpected error fetching media:", err instanceof Error ? err.message : err)
    return { ok: false, error: "Unexpected error fetching recent media." }
  }
}

function seriesFromTimeSeries(metric: RawInsightMetric | undefined): InsightsSeriesPoint[] {
  if (!metric?.values) return []
  return metric.values
    .filter((v): v is { value: number; end_time: string } => typeof v.value === "number" && typeof v.end_time === "string")
    .map((v) => ({ date: v.end_time.slice(0, 10), value: v.value }))
}

function buildReachMetric(result: MetricFetchResult): AccountInsightsData["reach"] {
  if (!result.ok) return { available: false, value: null, note: result.error }
  const metric = result.data.find((m) => m.name === "reach")
  const series = seriesFromTimeSeries(metric)
  if (series.length === 0) {
    return { available: false, value: null, note: "Not enough reach data yet for this account." }
  }
  const total = series.reduce((sum, p) => sum + p.value, 0)
  return { available: true, value: { total, series }, note: null }
}

function buildFollowerGrowthMetric(result: MetricFetchResult): AccountInsightsData["followerGrowth"] {
  if (!result.ok) return { available: false, value: null, note: result.error }
  const metric = result.data.find((m) => m.name === "follower_count")
  const series = seriesFromTimeSeries(metric)
  if (series.length < 2) {
    return {
      available: false,
      value: null,
      note: "Not enough follower history yet to show growth (Instagram requires 100+ followers and a few days of data).",
    }
  }
  const netChange = series[series.length - 1]!.value - series[0]!.value
  return { available: true, value: { netChange, series }, note: null }
}

function buildEngagementMetric(result: MetricFetchResult): AccountInsightsData["engagement"] {
  if (!result.ok) return { available: false, value: null, note: result.error }
  const totalInteractionsMetric = result.data.find((m) => m.name === "total_interactions")
  const accountsEngagedMetric = result.data.find((m) => m.name === "accounts_engaged")
  const totalInteractions = totalInteractionsMetric?.total_value?.value
  const accountsEngaged = accountsEngagedMetric?.total_value?.value

  if (typeof totalInteractions !== "number") {
    return { available: false, value: null, note: "Not enough engagement data yet for this account." }
  }
  return {
    available: true,
    value: { totalInteractions, accountsEngaged: typeof accountsEngaged === "number" ? accountsEngaged : null },
    note: null,
  }
}

/**
 * Fetches real account-level Instagram Insights (reach, follower growth,
 * engagement) plus the account's own recent media for best-performing-post
 * calculations. Never throws. Each metric group is fetched independently —
 * if one fails or isn't available for this account (e.g. too new, too few
 * followers), it's marked unavailable with an explanatory note rather than
 * showing a zero that looks like real data.
 */
export async function getAccountInsights(
  igBusinessAccountId: string,
  accessToken: string
): Promise<AccountInsightsResult> {
  try {
    const untilUnix = Math.floor(Date.now() / 1000)
    const sinceUnix = untilUnix - INSIGHTS_WINDOW_DAYS * 24 * 60 * 60

    const [reachResult, followerResult, engagementResult, ageResult, genderResult, cityResult, countryResult, mediaResult] = await Promise.all([
      fetchInsightsMetric(igBusinessAccountId, accessToken, "reach", "time_series", sinceUnix, untilUnix),
      fetchInsightsMetric(igBusinessAccountId, accessToken, "follower_count", "time_series", sinceUnix, untilUnix),
      fetchInsightsMetric(igBusinessAccountId, accessToken, "accounts_engaged,total_interactions", "total_value", sinceUnix, untilUnix),
      fetchDemographicBreakdown(igBusinessAccountId, accessToken, "age"),
      fetchDemographicBreakdown(igBusinessAccountId, accessToken, "gender"),
      fetchDemographicBreakdown(igBusinessAccountId, accessToken, "city"),
      fetchDemographicBreakdown(igBusinessAccountId, accessToken, "country"),
      fetchAccountMedia(igBusinessAccountId, accessToken),
    ])

    if (!mediaResult.ok) {
      // Media failure is the one thing we can't gracefully degrade around —
      // best-performing posts depend on it.
      return { success: false, error: mediaResult.error }
    }

    return {
      success: true,
      data: {
        windowDays: INSIGHTS_WINDOW_DAYS,
        reach: buildReachMetric(reachResult),
        followerGrowth: buildFollowerGrowthMetric(followerResult),
        engagement: buildEngagementMetric(engagementResult),
        demographics: buildDemographicsMetric(ageResult, genderResult, cityResult, countryResult),
        media: mediaResult.data,
      },
    }
  } catch (err) {
    console.error("[instagram-insights] unexpected error:", err instanceof Error ? err.message : err)
    return { success: false, error: "Unexpected error fetching Instagram insights." }
  }
}
