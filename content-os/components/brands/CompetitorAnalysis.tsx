"use client"

import { useState, useCallback } from "react"
import { Loader2, AlertCircle, TrendingUp, ExternalLink, Flame } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { isApiError } from "@/types/api"

const MAX_COMPETITORS = 5

interface ViralPost {
  permalink: string
  caption: string | null
  likeCount: number
  commentsCount: number
  timestamp: string
  engagement: number
  multipleOfAverage: number
}

interface AccountMetrics {
  handle: string
  followersCount: number
  mediaCount: number
  sampledPostCount: number
  postsPerWeek: number | null
  avgEngagementRate: number | null
}

interface CompetitorMetrics extends AccountMetrics {
  viralPosts: ViralPost[]
}

interface CompetitorResult {
  handle: string
  success: boolean
  error: string | null
  profile: { username: string; followersCount: number; mediaCount: number; biography: string | null; website: string | null } | null
  metrics: CompetitorMetrics | null
  analysis: string | null
}

interface AnalysisResponse {
  own: AccountMetrics | null
  competitors: CompetitorResult[]
}

function formatRate(rate: number | null): string {
  return rate !== null ? `${(rate * 100).toFixed(2)}%` : "Not enough data"
}

function formatFrequency(perWeek: number | null): string {
  return perWeek !== null ? `${perWeek} posts/week` : "Not enough data"
}

function CompetitorCard({ result }: { result: CompetitorResult }) {
  if (!result.success || !result.metrics || !result.profile) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <p className="text-sm font-semibold">@{result.handle}</p>
        <p className="mt-1 flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          {result.error ?? "Lookup failed."}
        </p>
      </div>
    )
  }

  const { profile, metrics, analysis } = result

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">@{profile.username}</p>
        <span className="text-xs text-muted-foreground">{profile.followersCount.toLocaleString()} followers</span>
      </div>
      {profile.biography && <p className="text-xs text-muted-foreground line-clamp-2">{profile.biography}</p>}

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-md bg-muted/50 p-2.5">
          <p className="text-muted-foreground">Posting frequency</p>
          <p className="mt-0.5 font-semibold">{formatFrequency(metrics.postsPerWeek)}</p>
        </div>
        <div className="rounded-md bg-muted/50 p-2.5">
          <p className="text-muted-foreground">Avg. engagement rate</p>
          <p className="mt-0.5 font-semibold">{formatRate(metrics.avgEngagementRate)}</p>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Based on {metrics.sampledPostCount} recent posts sampled via Instagram Business Discovery.
      </p>

      {metrics.viralPosts.length > 0 && (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Flame className="h-3.5 w-3.5 text-orange-500" /> Viral posts (2x+ their average)
          </p>
          <ul className="space-y-1.5">
            {metrics.viralPosts.slice(0, 5).map((post) => (
              <li key={post.permalink} className="rounded-md border px-2.5 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{post.multipleOfAverage}x avg — {post.likeCount} likes, {post.commentsCount} comments</span>
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

      {analysis && (
        <div className="rounded-md bg-primary/5 border border-primary/10 p-3">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5" /> Content &amp; gap analysis
          </p>
          <p className="whitespace-pre-wrap text-xs leading-relaxed">{analysis}</p>
        </div>
      )}
    </div>
  )
}

export function CompetitorAnalysis({ brandId, competitorNames }: { brandId: string; competitorNames: string[] }) {
  const [handleInputs, setHandleInputs] = useState<string[]>(() =>
    Array.from({ length: MAX_COMPETITORS }, (_, i) => "")
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AnalysisResponse | null>(null)

  const updateHandle = useCallback((index: number, value: string) => {
    setHandleInputs((prev) => prev.map((h, i) => (i === index ? value : h)))
  }, [])

  const runAnalysis = useCallback(async () => {
    const handles = handleInputs.map((h) => h.trim().replace(/^@/, "")).filter(Boolean)
    if (handles.length === 0) {
      setError("Enter at least one competitor's Instagram handle.")
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`/api/v1/brands/${brandId}/competitor-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handles }),
      })
      const json: unknown = await res.json()
      if (!res.ok || isApiError(json)) {
        const msg = isApiError(json) ? json.error.message : "Failed to run competitor analysis."
        setError(msg)
        return
      }
      setResult((json as { data: AnalysisResponse }).data)
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setLoading(false)
    }
  }, [brandId, handleInputs])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Competitor analysis</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Uses Instagram&apos;s public Business Discovery API — real follower counts, posting frequency, and
          engagement rates for any public Instagram Business/Creator account. Requires Instagram connected above.
        </p>

        <div className="space-y-2">
          {handleInputs.map((value, i) => (
            <div key={i} className="flex items-center gap-2">
              <Label className="w-28 shrink-0 truncate text-xs" title={competitorNames[i]}>
                {competitorNames[i] ?? `Competitor ${i + 1}`}
              </Label>
              <Input
                placeholder="@handle"
                value={value}
                onChange={(e) => updateHandle(i, e.target.value)}
                className="text-sm"
              />
            </div>
          ))}
        </div>

        <Button size="sm" onClick={runAnalysis} disabled={loading} className="w-full">
          {loading ? (
            <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Running analysis…</>
          ) : (
            "Run analysis"
          )}
        </Button>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {loading && (
          <p className="text-xs text-muted-foreground text-center">
            Looking up each account and generating insights — this can take a moment for multiple competitors.
          </p>
        )}

        {result && (
          <div className="space-y-3">
            {result.own ? (
              <div className="rounded-md border px-3 py-2 text-xs">
                <span className="font-semibold">Your baseline (@{result.own.handle}): </span>
                {formatFrequency(result.own.postsPerWeek)} · {formatRate(result.own.avgEngagementRate)} avg engagement
              </div>
            ) : (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                No baseline data available for your own account yet — comparisons below are competitor-only.
              </div>
            )}

            {result.competitors.map((c) => (
              <CompetitorCard key={c.handle} result={c} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
