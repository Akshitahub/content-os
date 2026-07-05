"use client"

import { useEffect, useState } from "react"
import { Loader2, AlertCircle, FileText, Film, BookOpen, LayoutGrid, ChevronLeft } from "lucide-react"
import { useGenerationStore } from "@/stores/generationStore"
import { getFriendlyError } from "@/lib/utils/error-messages"
import type { TrendingContext } from "@/types/app"
import type { Tab } from "./tabsConfig"

interface TrendingNowProps {
  brandId: string
  onNavigate: (tab: Tab, options?: { presetReelScript?: boolean }) => void
}

export function TrendingNow({ brandId, onNavigate }: TrendingNowProps) {
  const { setPendingTopic, setContentFormat, setContentAdditionalContext } = useGenerationStore()
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState("")
  const [trend, setTrend] = useState<TrendingContext | null>(null)
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setApiError("")
      try {
        const res = await fetch(`/api/v1/brands/${brandId}/trends`)
        const json = await res.json() as { data?: TrendingContext; error?: { message?: string } }
        if (!res.ok || !json.data) throw new Error(json.error?.message ?? "Failed to load trends.")
        if (!cancelled) setTrend(json.data)
      } catch (e) {
        if (!cancelled) setApiError(getFriendlyError(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [brandId])

  function pickFormat(format: "post" | "carousel" | "blog" | "reel_script") {
    if (!selectedTopic) return
    if (format === "post") {
      setPendingTopic(selectedTopic)
      onNavigate("full_post")
    } else if (format === "carousel") {
      setPendingTopic(selectedTopic)
      onNavigate("carousel")
    } else if (format === "blog") {
      setContentFormat("blog_post")
      setContentAdditionalContext(selectedTopic)
      onNavigate("content")
    } else {
      setContentFormat("reel_script")
      setContentAdditionalContext(selectedTopic)
      onNavigate("content")
    }
  }

  const topics = trend?.topics ?? []
  const hasTopics = trend?.success && topics.length > 0

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Trending Now</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">Real discussions from your niche&apos;s community, right now</p>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border bg-card py-10">
          <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
          <p className="text-sm text-muted-foreground">Fetching what&apos;s trending…</p>
        </div>
      )}

      {!loading && apiError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-900">{apiError}</p>
        </div>
      )}

      {!loading && !apiError && !hasTopics && (
        <div className="rounded-lg border bg-muted/30 p-4 text-center">
          <p className="text-sm text-muted-foreground">
            No trending discussions found for your niche right now — try again later.
          </p>
        </div>
      )}

      {!loading && !apiError && hasTopics && !selectedTopic && (
        <div className="flex flex-col gap-2">
          {topics.map((topic) => (
            <button
              key={topic}
              type="button"
              onClick={() => setSelectedTopic(topic)}
              className="rounded-lg border p-3 text-left text-sm transition-colors hover:border-violet-400 hover:bg-violet-50/50"
            >
              {topic}
            </button>
          ))}
        </div>
      )}

      {!loading && selectedTopic && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setSelectedTopic(null)}
            className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" /> Back to topics
          </button>

          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs font-semibold text-muted-foreground">Selected topic</p>
            <p className="mt-0.5 text-sm">{selectedTopic}</p>
          </div>

          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Turn it into…</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <button
              type="button"
              onClick={() => pickFormat("post")}
              className="flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-colors hover:border-violet-400 hover:bg-violet-50/50"
            >
              <FileText className="h-4 w-4 text-violet-600" />
              <span className="text-xs font-medium">Post</span>
            </button>
            <button
              type="button"
              onClick={() => pickFormat("blog")}
              className="flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-colors hover:border-violet-400 hover:bg-violet-50/50"
            >
              <BookOpen className="h-4 w-4 text-violet-600" />
              <span className="text-xs font-medium">Blog</span>
            </button>
            <button
              type="button"
              onClick={() => pickFormat("reel_script")}
              className="flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-colors hover:border-violet-400 hover:bg-violet-50/50"
            >
              <Film className="h-4 w-4 text-violet-600" />
              <span className="text-xs font-medium">Reel script</span>
            </button>
            <button
              type="button"
              onClick={() => pickFormat("carousel")}
              className="flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-colors hover:border-violet-400 hover:bg-violet-50/50"
            >
              <LayoutGrid className="h-4 w-4 text-violet-600" />
              <span className="text-xs font-medium">Carousel</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
