"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2, TrendingUp, TrendingDown, ExternalLink, Clock, Download } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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

interface AnalyticsResponse {
  windowDays: number
  reach: MetricAvailability<{ total: number; series: SeriesPoint[] }>
  followerGrowth: MetricAvailability<{ netChange: number; series: SeriesPoint[] }>
  engagement: MetricAvailability<{ totalInteractions: number; accountsEngaged: number | null }>
  bestPosts: BestPost[]
  aiInsights: string | null
  roi: RoiTracking
}

function MetricTile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md bg-muted/50 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  )
}

export function AnalyticsDashboard({ brandId }: { brandId: string }) {
  const [loading, setLoading] = useState(true)
  const [notConnected, setNotConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<AnalyticsResponse | null>(null)

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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Analytics</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading analytics…
          </div>
        )}

        {!loading && notConnected && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-1.5">
            <p className="text-sm text-amber-900">Connect Instagram to see analytics.</p>
            <Link
              href={`/brands/${brandId}`}
              className="text-xs font-semibold text-amber-700 underline underline-offset-2 hover:text-amber-900"
            >
              Go to brand settings →
            </Link>
          </div>
        )}

        {!loading && error && (
          <div className="space-y-2">
            <p className="text-sm text-destructive">{error}</p>
            <Button size="sm" variant="outline" onClick={fetchAnalytics}>Try again</Button>
          </div>
        )}

        {!loading && data && (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Last {data.windowDays} days, from Instagram&apos;s own account Insights — independent of whether posts were published through ContentOS.
            </p>

            <div className="grid grid-cols-3 gap-3">
              <MetricTile label="Reach">
                {data.reach.available ? (
                  <p className="text-lg font-bold">{data.reach.value!.total.toLocaleString()}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">{data.reach.note ?? "Not enough data"}</p>
                )}
              </MetricTile>
              <MetricTile label="Follower change">
                {data.followerGrowth.available ? (
                  <p className={`flex items-center gap-1 text-lg font-bold ${data.followerGrowth.value!.netChange >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {data.followerGrowth.value!.netChange >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                    {data.followerGrowth.value!.netChange >= 0 ? "+" : ""}
                    {data.followerGrowth.value!.netChange}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">{data.followerGrowth.note ?? "Not enough data"}</p>
                )}
              </MetricTile>
              <MetricTile label="Engagement">
                {data.engagement.available ? (
                  <div>
                    <p className="text-lg font-bold">{data.engagement.value!.totalInteractions.toLocaleString()}</p>
                    {data.engagement.value!.accountsEngaged !== null && (
                      <p className="text-[11px] text-muted-foreground">{data.engagement.value!.accountsEngaged.toLocaleString()} accounts engaged</p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{data.engagement.note ?? "Not enough data"}</p>
                )}
              </MetricTile>
            </div>

            {data.bestPosts.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Best-performing posts</p>
                <ul className="space-y-1.5">
                  {data.bestPosts.map((post) => (
                    <li key={post.permalink || post.timestamp} className="rounded-md border px-2.5 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{post.likeCount.toLocaleString()} likes, {post.commentsCount.toLocaleString()} comments</span>
                        {post.permalink && (
                          <a href={post.permalink} target="_blank" rel="noopener noreferrer" className="shrink-0 text-muted-foreground hover:text-foreground">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                      {post.caption && <p className="mt-1 line-clamp-2 text-muted-foreground">{post.caption}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {data.aiInsights && (
              <div className="rounded-md bg-primary/5 border border-primary/10 p-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI insights &amp; suggestions</p>
                <p className="whitespace-pre-wrap text-xs leading-relaxed">{data.aiInsights}</p>
              </div>
            )}

            <div className="rounded-md border p-3 space-y-2">
              <div className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Time saved (estimate) — {data.roi.periodLabel}</p>
              </div>
              <p className="text-lg font-bold">
                {data.roi.totalHoursSaved} hrs
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  across {data.roi.totalItems} piece{data.roi.totalItems !== 1 ? "s" : ""} of content
                </span>
              </p>
              {data.roi.totalItems > 0 && (
                <ul className="space-y-0.5">
                  {data.roi.breakdown.filter((b) => b.count > 0).map((b) => (
                    <li key={b.type} className="text-[11px] text-muted-foreground">
                      {b.label}: {b.count} × {b.minutesPerItem} min = {b.minutesSaved} min
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[10px] italic text-muted-foreground/80">{data.roi.disclosure}</p>
            </div>

            <a
              href={`/api/v1/brands/${brandId}/reports/monthly`}
              className="flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium hover:bg-secondary"
            >
              <Download className="h-3.5 w-3.5" /> Download monthly report (PDF)
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
