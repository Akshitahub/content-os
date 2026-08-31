"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Loader2, ArrowUpRight, ArrowDownRight, ExternalLink, Clock, Download, ChevronDown,
  Eye, Users, Heart, Lightbulb, ListChecks, Sparkles,
} from "lucide-react"
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { isApiError } from "@/types/api"

interface SeriesPoint {
  date: string
  value: number
}

interface MetricAvailability<T> {
  available: boolean
  value: T | null
  note: string | null
}

interface BestPost {
  permalink: string
  caption: string | null
  likeCount: number
  commentsCount: number
  timestamp: string
  engagement: number
}

interface RoiBreakdownItem {
  type: string
  label: string
  count: number
  minutesPerItem: number
  minutesSaved: number
}

interface RoiTracking {
  periodLabel: string
  periodStart: string
  periodEnd: string
  totalItems: number
  totalMinutesSaved: number
  totalHoursSaved: number
  breakdown: RoiBreakdownItem[]
  disclosure: string
}

interface DemographicBreakdownItem {
  label: string
  value: number
  percentage: number
}

interface AudienceDemographics {
  ageRanges: DemographicBreakdownItem[]
  genderSplit: DemographicBreakdownItem[]
  topCities: DemographicBreakdownItem[]
  topCountries: DemographicBreakdownItem[]
}

interface AnalyticsResponse {
  windowDays: number
  reach: MetricAvailability<{ total: number; series: SeriesPoint[] }>
  followerGrowth: MetricAvailability<{ netChange: number; series: SeriesPoint[] }>
  engagement: MetricAvailability<{ totalInteractions: number; accountsEngaged: number | null }>
  demographics: MetricAvailability<AudienceDemographics>
  bestPosts: BestPost[]
  aiInsights: string | null
  roi: RoiTracking
}

// ─── Stat cards ─────────────────────────────────────────────────────────────

type Accent = "violet" | "indigo" | "fuchsia"

const ACCENT_STYLES: Record<Accent, { wash: string; chip: string; text: string }> = {
  violet: { wash: "from-violet-500/10 via-violet-500/5", chip: "bg-violet-500/10", text: "text-violet-600 dark:text-violet-400" },
  indigo: { wash: "from-indigo-500/10 via-indigo-500/5", chip: "bg-indigo-500/10", text: "text-indigo-600 dark:text-indigo-400" },
  fuchsia: { wash: "from-fuchsia-500/10 via-fuchsia-500/5", chip: "bg-fuchsia-500/10", text: "text-fuchsia-600 dark:text-fuchsia-400" },
}

/** A real, derived-from-actual-data trend badge — never a fabricated
 * percentage. Compares the second half of a real daily series against the
 * first half of that same series, so it only ever appears when there's
 * enough real history behind it (4+ points) and a non-zero baseline to
 * compare against. */
function seriesTrend(series: SeriesPoint[]): { direction: "up" | "down"; label: string } | null {
  if (series.length < 4) return null
  const mid = Math.floor(series.length / 2)
  const firstSum = series.slice(0, mid).reduce((s, p) => s + p.value, 0)
  const secondSum = series.slice(mid).reduce((s, p) => s + p.value, 0)
  if (firstSum <= 0) return null
  const pct = ((secondSum - firstSum) / firstSum) * 100
  if (Math.abs(pct) < 1) return null
  return { direction: pct >= 0 ? "up" : "down", label: `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%` }
}

function TrendBadge({ trend }: { trend: { direction: "up" | "down"; label: string } }) {
  const positive = trend.direction === "up"
  return (
    <span
      className={cn(
        "flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        positive ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-red-500/10 text-red-600 dark:text-red-400"
      )}
    >
      {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {trend.label}
    </span>
  )
}

function StatCard({
  icon: Icon,
  label,
  accent,
  value,
  subtitle,
  trend,
}: {
  icon: React.ElementType
  label: string
  accent: Accent
  value: React.ReactNode
  subtitle?: string | null
  trend?: { direction: "up" | "down"; label: string } | null
}) {
  const styles = ACCENT_STYLES[accent]
  return (
    <div className={cn("relative overflow-hidden rounded-2xl border bg-gradient-to-br to-transparent p-5", styles.wash)}>
      <div className="flex items-start justify-between">
        <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl", styles.chip, styles.text)}>
          <Icon className="h-4 w-4" />
        </span>
        {trend && <TrendBadge trend={trend} />}
      </div>
      <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-bold tracking-tight text-foreground">{value}</p>
      {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  )
}

function StatCardEmpty({ icon: Icon, label, note }: { icon: React.ElementType; label: string; note: string }) {
  return (
    <div className="rounded-2xl border border-dashed p-5">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-xs text-muted-foreground">{note}</p>
    </div>
  )
}

// ─── Trend chart ────────────────────────────────────────────────────────────

type ChartMetricId = "reach" | "followers"

function TrendChartCard({
  reach,
  followerGrowth,
}: {
  reach: AnalyticsResponse["reach"]
  followerGrowth: AnalyticsResponse["followerGrowth"]
}) {
  const metrics: { id: ChartMetricId; label: string; series: SeriesPoint[]; color: string }[] = [
    ...(reach.available && reach.value!.series.length > 1 ? [{ id: "reach" as const, label: "Reach", series: reach.value!.series, color: "#8b5cf6" }] : []),
    ...(followerGrowth.available && followerGrowth.value!.series.length > 1 ? [{ id: "followers" as const, label: "Followers", series: followerGrowth.value!.series, color: "#6366f1" }] : []),
  ]

  const [metricId, setMetricId] = useState<ChartMetricId | null>(metrics[0]?.id ?? null)
  const active = metrics.find((m) => m.id === metricId) ?? metrics[0]

  // No real time series behind either metric — a chart here would either be
  // empty or, worse, invented. A stat card already covers the single
  // current value elsewhere on this page.
  if (!active) return null

  const chartData = active.series.map((p) => ({ date: p.date, value: p.value }))

  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm font-semibold">Trend</p>
        {metrics.length > 1 && (
          <div className="flex gap-0.5 rounded-full bg-muted p-0.5">
            {metrics.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMetricId(m.id)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  active.id === m.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
          <defs>
            <linearGradient id="analyticsTrendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={active.color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={active.color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
            minTickGap={28}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
            // CONFIRMED live: a fixed width of 36px visually clipped the
            // leading digit of any 3-digit tick value (e.g. "240" painted
            // as "40") even though the underlying DOM text node held the
            // correct, uncut string -- only visible in an actual
            // screenshot/render, not by inspecting the DOM. A compact
            // formatter keeps every label short regardless of magnitude
            // (matches the abbreviated-axis convention on Vercel/Stripe-
            // style dashboards anyway), and the wider allowance is a
            // second line of defense for whatever slips through it.
            tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : String(v))}
            width={44}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--popover))", fontSize: 12 }}
            labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
            labelFormatter={(d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            formatter={(value: number) => [value.toLocaleString(), active.label]}
          />
          <Area type="monotone" dataKey="value" stroke={active.color} strokeWidth={2} fill="url(#analyticsTrendFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Demographics ───────────────────────────────────────────────────────────

function DemographicBlock({ label, items }: { label: string; items: DemographicBreakdownItem[] }) {
  return (
    <div className="rounded-xl bg-muted/40 p-3.5">
      <p className="mb-2 text-xs font-medium text-muted-foreground">{label}</p>
      {items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/70">No data</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              <span className="w-14 shrink-0 truncate text-[11px]">{item.label}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-background">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500"
                  style={{ width: `${item.percentage}%` }}
                />
              </div>
              <span className="w-8 shrink-0 text-right text-[11px] font-medium tabular-nums">{item.percentage}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── AI insights & suggestions ─────────────────────────────────────────────

// The model is prompted (lib/ai/account-analytics.ts) to return exactly two
// labeled plain-text sections -- "INSIGHTS:" (2-3 short paragraphs) and
// "SUGGESTIONS:" (2-4 items, plain dashes if any bullet symbol at all).
// This only ever restructures that same text for display -- every word the
// AI wrote is still rendered in full, just split into { insights,
// suggestions } and, for each suggestion, a bold lead-in vs. supporting
// detail (splitLeadIn below). Never rewrites or drops content.
function parseAiInsights(text: string): { insights: string[]; suggestions: string[] } {
  const insightsMatch = text.match(/INSIGHTS:?\s*([\s\S]*?)(?:\n\s*SUGGESTIONS:?|$)/i)
  const suggestionsMatch = text.match(/SUGGESTIONS:?\s*([\s\S]*)$/i)

  const insightsRaw = (insightsMatch?.[1] ?? "").trim()
  const suggestionsRaw = (suggestionsMatch?.[1] ?? "").trim()

  const insights = insightsRaw
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)

  let suggestions = suggestionsRaw
    .split(/\n+/)
    .map((l) => l.replace(/^[-•*]\s*/, "").replace(/^\d+[.)]\s*/, "").trim())
    .filter(Boolean)

  // The model didn't break suggestions onto separate lines at all -- split
  // the one run-on block into sentences instead of showing a single giant
  // bullet (still the model's own sentences, just separated for scanning).
  if (suggestions.length <= 1 && suggestionsRaw) {
    const sentences = suggestionsRaw.match(/[^.!?]+[.!?]+(?=\s|$)/g)
    if (sentences && sentences.length > 1) suggestions = sentences.map((s) => s.trim())
  }

  // Neither label matched at all (e.g. the AI-unavailable fallback string,
  // or a malformed response) -- fall back to showing the whole thing as a
  // single insight rather than silently dropping it.
  if (insights.length === 0 && suggestions.length === 0 && text.trim()) {
    return { insights: [text.trim()], suggestions: [] }
  }
  return { insights, suggestions }
}

/** Splits one suggestion into a bold actionable lead-in and the rest as
 * supporting detail -- a presentation split only, every word is still
 * there in `lead`+`rest` combined, nothing paraphrased or dropped.
 * Prefers a real sentence boundary; confirmed live the model often
 * writes one long comma-joined sentence per suggestion rather than two
 * short ones, so a second pass splits at the first clause boundary
 * (comma/semicolon/colon) instead of bolding the entire bullet whenever
 * that happens -- still purely a presentation choice about where the
 * bold/light split falls, not a rewrite. */
function splitLeadIn(text: string): { lead: string; rest: string } {
  const sentenceMatch = text.match(/^([\s\S]{8,100}?[.!?])\s+([\s\S]+)$/)
  if (sentenceMatch) return { lead: sentenceMatch[1]!, rest: sentenceMatch[2]! }

  const clauseMatch = text.match(/^([\s\S]{15,90}?[,;:])\s+([\s\S]+)$/)
  if (clauseMatch) return { lead: clauseMatch[1]!, rest: clauseMatch[2]! }

  return { lead: text, rest: "" }
}

function InsightsSuggestionsSection({ text }: { text: string }) {
  const { insights, suggestions } = parseAiInsights(text)
  if (insights.length === 0 && suggestions.length === 0) return null

  return (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI insights &amp; suggestions</p>
      <div className="grid gap-4 md:grid-cols-2">
        {insights.length > 0 && (
          <div className="rounded-2xl border bg-gradient-to-br from-violet-500/5 to-transparent p-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
                <Lightbulb className="h-3.5 w-3.5" />
              </span>
              <p className="text-sm font-semibold">Insights</p>
            </div>
            <div className="space-y-3">
              {insights.map((p, i) => (
                <p key={i} className="text-sm leading-relaxed text-foreground/90">{p}</p>
              ))}
            </div>
          </div>
        )}

        {suggestions.length > 0 && (
          <div className="rounded-2xl border bg-gradient-to-br from-indigo-500/5 to-transparent p-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                <ListChecks className="h-3.5 w-3.5" />
              </span>
              <p className="text-sm font-semibold">Suggestions</p>
            </div>
            <ul className="space-y-3">
              {suggestions.map((s, i) => {
                const { lead, rest } = splitLeadIn(s)
                return (
                  <li key={i} className="flex gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                      <Sparkles className="h-3 w-3" />
                    </span>
                    <p className="text-sm leading-relaxed">
                      <span className="font-semibold text-foreground">{lead}</span>
                      {rest && <span className="text-muted-foreground"> {rest}</span>}
                    </p>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main ───────────────────────────────────────────────────────────────────

export function AnalyticsDashboard({ brandId }: { brandId: string }) {
  const [loading, setLoading] = useState(true)
  const [notConnected, setNotConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<AnalyticsResponse | null>(null)
  const [showRoiBreakdown, setShowRoiBreakdown] = useState(false)
  const [showDemographics, setShowDemographics] = useState(false)

  const fetchAnalytics = useCallback(async () => {
    setLoading(true)
    setError(null)
    setNotConnected(false)
    try {
      const res = await fetch(`/api/v1/brands/${brandId}/analytics`)
      const json: unknown = await res.json()
      if (!res.ok || isApiError(json)) {
        if (res.status === 400) {
          setNotConnected(true)
        } else {
          setError(isApiError(json) ? json.error.message : "Failed to load analytics.")
        }
        return
      }
      setData((json as { data: AnalyticsResponse }).data)
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setLoading(false)
    }
  }, [brandId])

  useEffect(() => {
    fetchAnalytics()
  }, [fetchAnalytics])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading analytics…
      </div>
    )
  }

  if (notConnected) {
    return (
      <div className="rounded-2xl border border-dashed p-6 text-center space-y-2">
        <p className="text-sm text-foreground">Connect Instagram to see analytics.</p>
        <Link
          href={`/brands/${brandId}`}
          className="text-xs font-semibold text-primary underline underline-offset-2 hover:text-primary/80"
        >
          Go to brand settings →
        </Link>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-destructive">{error}</p>
        <Button size="sm" variant="outline" onClick={fetchAnalytics}>Try again</Button>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Last {data.windowDays} days, from Instagram&apos;s own account Insights, independent of whether posts were published through SocioPosts.
      </p>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        {data.reach.available ? (
          <StatCard
            icon={Eye}
            label="Reach"
            accent="violet"
            value={data.reach.value!.total.toLocaleString()}
            subtitle="unique accounts reached"
            trend={seriesTrend(data.reach.value!.series)}
          />
        ) : (
          <StatCardEmpty icon={Eye} label="Reach" note={data.reach.note ?? "Not enough data yet"} />
        )}

        {data.followerGrowth.available ? (
          <StatCard
            icon={Users}
            label="Follower change"
            accent="indigo"
            value={`${data.followerGrowth.value!.netChange >= 0 ? "+" : ""}${data.followerGrowth.value!.netChange.toLocaleString()}`}
            subtitle="net change this window"
            trend={
              data.followerGrowth.value!.netChange !== 0
                ? { direction: data.followerGrowth.value!.netChange >= 0 ? "up" : "down", label: data.followerGrowth.value!.netChange >= 0 ? "growing" : "declining" }
                : null
            }
          />
        ) : (
          <StatCardEmpty icon={Users} label="Follower change" note={data.followerGrowth.note ?? "Not enough data yet"} />
        )}

        {data.engagement.available ? (
          <StatCard
            icon={Heart}
            label="Engagement"
            accent="fuchsia"
            value={data.engagement.value!.totalInteractions.toLocaleString()}
            subtitle={data.engagement.value!.accountsEngaged !== null ? `across ${data.engagement.value!.accountsEngaged.toLocaleString()} engaged accounts` : "total interactions"}
          />
        ) : (
          <StatCardEmpty icon={Heart} label="Engagement" note={data.engagement.note ?? "Not enough data yet"} />
        )}
      </div>

      {/* Trend chart — only for metrics with a real series behind them */}
      <TrendChartCard reach={data.reach} followerGrowth={data.followerGrowth} />

      {data.bestPosts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Best-performing posts</p>
          <ul className="space-y-2">
            {data.bestPosts.map((post) => (
              <li key={post.permalink || post.timestamp} className="rounded-xl border p-3 text-sm transition-colors hover:bg-muted/40">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{post.likeCount.toLocaleString()} likes, {post.commentsCount.toLocaleString()} comments</span>
                  {post.permalink && (
                    <a href={post.permalink} target="_blank" rel="noopener noreferrer" className="shrink-0 text-muted-foreground hover:text-foreground">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
                {post.caption && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{post.caption}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl border p-4 space-y-3">
        <button
          type="button"
          onClick={() => setShowDemographics((v) => !v)}
          className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          <span>Audience demographics</span>
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", showDemographics && "rotate-180")} />
        </button>

        {showDemographics && (
          data.demographics.available ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <DemographicBlock label="Age" items={data.demographics.value!.ageRanges} />
              <DemographicBlock label="Gender" items={data.demographics.value!.genderSplit} />
              <DemographicBlock label="Top cities" items={data.demographics.value!.topCities} />
              <DemographicBlock label="Top countries" items={data.demographics.value!.topCountries} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{data.demographics.note ?? "Not enough data"}</p>
          )
        )}
      </div>

      {data.aiInsights && <InsightsSuggestionsSection text={data.aiInsights} />}

      {/* Time saved — same stat-card visual language as the metrics above */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-violet-500/10 via-indigo-500/5 to-transparent p-5">
        <div className="flex items-start justify-between">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400">
            <Clock className="h-4 w-4" />
          </span>
        </div>
        <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">Time saved (estimate) · {data.roi.periodLabel}</p>
        <p className="mt-1 text-3xl font-bold tracking-tight text-foreground">
          {data.roi.totalHoursSaved} hrs
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            across {data.roi.totalItems} piece{data.roi.totalItems !== 1 ? "s" : ""} of content
          </span>
        </p>

        {data.roi.totalItems > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowRoiBreakdown((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", showRoiBreakdown && "rotate-180")} />
              {showRoiBreakdown ? "Hide breakdown" : "See breakdown"}
            </button>

            {showRoiBreakdown && (
              <ul className="mt-2 space-y-0.5">
                {data.roi.breakdown.filter((b) => b.count > 0).map((b) => (
                  <li key={b.type} className="text-[11px] text-muted-foreground">
                    {b.label}: {b.count} × {b.minutesPerItem} min = {b.minutesSaved} min
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <p className="mt-3 text-[10px] italic text-muted-foreground/80">{data.roi.disclosure}</p>
      </div>

      <a
        href={`/api/v1/brands/${brandId}/reports/monthly`}
        className="flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-medium transition-colors hover:bg-secondary"
      >
        <Download className="h-3.5 w-3.5" /> Download monthly report (PDF)
      </a>
    </div>
  )
}
