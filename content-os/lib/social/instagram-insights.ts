import {
  getZernioInstagramAccountInsights,
  getZernioInstagramFollowerHistory,
  listZernioPostAnalytics,
  type ZernioInsightMetric,
} from "./zernio-client"

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

function toDateStr(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function seriesFromMetric(metric: ZernioInsightMetric | undefined): InsightsSeriesPoint[] {
  if (!metric?.values) return []
  return metric.values
    .filter((v): v is { date: string; value: number } => typeof v.date === "string" && typeof v.value === "number")
    .map((v) => ({ date: v.date, value: v.value }))
}

function buildReachMetric(
  result: Awaited<ReturnType<typeof getZernioInstagramAccountInsights>>
): AccountInsightsData["reach"] {
  if (!result.ok) return { available: false, value: null, note: result.error }
  const metric = result.data.metrics?.reach
  const series = seriesFromMetric(metric)
  if (series.length === 0) {
    return { available: false, value: null, note: "Not enough reach data yet for this account." }
  }
  const total = typeof metric?.total === "number" ? metric.total : series.reduce((sum, p) => sum + p.value, 0)
  return { available: true, value: { total, series }, note: null }
}

function buildEngagementMetric(
  result: Awaited<ReturnType<typeof getZernioInstagramAccountInsights>>
): AccountInsightsData["engagement"] {
  if (!result.ok) return { available: false, value: null, note: result.error }
  const totalInteractions = result.data.metrics?.total_interactions?.total
  const accountsEngaged = result.data.metrics?.accounts_engaged?.total

  if (typeof totalInteractions !== "number") {
    return { available: false, value: null, note: "Not enough engagement data yet for this account." }
  }
  return {
    available: true,
    value: { totalInteractions, accountsEngaged: typeof accountsEngaged === "number" ? accountsEngaged : null },
    note: null,
  }
}

function buildFollowerGrowthMetric(
  result: Awaited<ReturnType<typeof getZernioInstagramFollowerHistory>>
): AccountInsightsData["followerGrowth"] {
  if (!result.ok) return { available: false, value: null, note: result.error }
  const series = seriesFromMetric(result.data.metrics?.follower_count)
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

async function fetchAccountMedia(
  zernioAccountId: string
): Promise<{ ok: true; data: AccountMedia[] } | { ok: false; error: string }> {
  const result = await listZernioPostAnalytics(zernioAccountId, "instagram", MEDIA_LIMIT)
  if (!result.ok) return { ok: false, error: result.error }

  const media: AccountMedia[] = result.items
    .filter((item): item is typeof item & { publishedAt: string } => typeof item.publishedAt === "string")
    .map((item, i) => ({
      id: item.platformPostUrl ?? `${zernioAccountId}-${i}`,
      caption: item.content ?? null,
      like_count: typeof item.analytics?.likes === "number" ? item.analytics.likes : 0,
      comments_count: typeof item.analytics?.comments === "number" ? item.analytics.comments : 0,
      timestamp: item.publishedAt,
      media_type: item.mediaType ?? "UNKNOWN",
      permalink: item.platformPostUrl ?? "",
      media_url: null,
    }))

  return { ok: true, data: media }
}

/**
 * Fetches real account-level Instagram Insights (reach, follower growth,
 * engagement) plus the account's own recent posts for best-performing-post
 * calculations — via Zernio's analytics endpoints (the account's real Meta
 * access token lives on Zernio's side, not this app's). Never throws. Each
 * metric group is fetched independently — if one fails or isn't available
 * for this account, it's marked unavailable with an explanatory note rather
 * than showing a zero that looks like real data.
 *
 * Audience demographics (age/gender/city/country) have no Zernio
 * equivalent — confirmed against Zernio's full API reference — so that
 * field is always returned unavailable with an honest note, not fetched.
 */
export async function getAccountInsights(zernioAccountId: string): Promise<AccountInsightsResult> {
  try {
    const until = toDateStr(new Date())
    const since = toDateStr(new Date(Date.now() - INSIGHTS_WINDOW_DAYS * 24 * 60 * 60 * 1000))

    const [reachResult, engagementResult, followerResult, mediaResult] = await Promise.all([
      getZernioInstagramAccountInsights(zernioAccountId, "reach", "time_series", since, until),
      getZernioInstagramAccountInsights(zernioAccountId, "accounts_engaged,total_interactions", "total_value", since, until),
      getZernioInstagramFollowerHistory(zernioAccountId, since, until),
      fetchAccountMedia(zernioAccountId),
    ])

    return {
      success: true,
      data: {
        windowDays: INSIGHTS_WINDOW_DAYS,
        reach: buildReachMetric(reachResult),
        followerGrowth: buildFollowerGrowthMetric(followerResult),
        engagement: buildEngagementMetric(engagementResult),
        // No Zernio equivalent exists for audience demographics — this is a
        // permanent, honest gap, not a failed fetch.
        demographics: {
          available: false,
          value: null,
          note: "Audience demographics aren't available through this app's current Instagram integration.",
        },
        // Best-performing posts is supplementary, not core — unlike the old
        // direct Graph API call (a cheap, reliable own-account /media edge),
        // this now comes from a broader Zernio endpoint, so a failure here
        // degrades to an empty list instead of failing the whole fetch.
        media: mediaResult.ok ? mediaResult.data : [],
      },
    }
  } catch (err) {
    console.error("[instagram-insights] unexpected error:", err instanceof Error ? err.message : err)
    return { success: false, error: "Unexpected error fetching Instagram insights." }
  }
}
