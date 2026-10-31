"use client"

import { useEffect, useState } from "react"
import { Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { isApiError } from "@/types/api"
import { readJsonResponse } from "@/lib/utils/read-json-response"
import { CRITIC_PASS } from "@/lib/design/critic-scores"

interface CriticVerdict { overall: number; passed: boolean; top_fix: string; reasons: string[] }

/**
 * The critic's score on a finished post / carousel / story (lib/ai/critic.ts
 * via /api/v1/ai/critic): scored once per result (`resultKey`), with the one
 * fix that would lift it most and a "Make it better" button that regenerates
 * with that fix. Hidden entirely when scoring isn't available.
 */
export function CriticPanel({ brandId, resultKey, imageUrl, caption, hook, format, contentType, contentId, onImprove, improving }: {
  brandId: string
  /** Changes when there's a new result to score (a new generation). */
  resultKey: string | null
  /** The image as it will be posted; scoring waits until it's ready. */
  imageUrl: string | null
  caption: string
  hook: string
  format: "post" | "carousel" | "story"
  contentType?: "caption" | "carousel" | "story"
  contentId?: string | null
  onImprove: (fix: string) => void
  improving?: boolean
}) {
  const [verdicts, setVerdicts] = useState<Record<string, CriticVerdict | "unavailable">>({})
  const verdict = resultKey ? verdicts[resultKey] : undefined
  const ready = !!resultKey && !!imageUrl && verdict === undefined

  useEffect(() => {
    if (!ready || !resultKey || !imageUrl) return
    const controller = new AbortController()
    // A beat after the image settles, so a render that's still updating isn't scored.
    const timer = setTimeout(() => {
      fetch("/api/v1/ai/critic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, imageUrl, caption, hook, format, contentType, contentId: contentId ?? undefined }),
        signal: controller.signal,
      })
        .then(async (res) => {
          const json: unknown = await readJsonResponse(res)
          const next = !res.ok || isApiError(json) ? "unavailable" as const : (json as { data: CriticVerdict }).data
          setVerdicts((prev) => ({ ...prev, [resultKey]: next }))
        })
        .catch(() => {
          if (!controller.signal.aborted) setVerdicts((prev) => ({ ...prev, [resultKey]: "unavailable" }))
        })
    }, 1500)
    return () => { controller.abort(); clearTimeout(timer) }
  // Scored once per result -- later edits to the caption don't re-score.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, resultKey, imageUrl])

  if (!resultKey || verdict === "unavailable") return null
  if (!verdict) {
    return imageUrl ? (
      <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Scoring this {format}…
      </div>
    ) : null
  }

  const good = verdict.overall >= CRITIC_PASS
  return (
    <div className={`rounded-lg border px-3 py-2.5 space-y-2 ${good ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30" : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className={`text-sm font-semibold ${good ? "text-green-800 dark:text-green-300" : "text-amber-900 dark:text-amber-200"}`}>
            Score {verdict.overall}/10{good ? " — ready to post" : ""}
          </p>
          <p className="text-xs text-foreground/80">{good ? verdict.top_fix && `One idea: ${verdict.top_fix}` : `Top fix: ${verdict.top_fix}`}</p>
        </div>
        <Button size="sm" variant={good ? "outline" : "default"} disabled={improving} onClick={() => onImprove(verdict.top_fix)} className="shrink-0">
          {improving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          <span className="ml-1.5">Make it better</span>
        </Button>
      </div>
      {!good && verdict.reasons.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-muted-foreground">
          {verdict.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}
      <p className="text-[10px] text-muted-foreground">Make it better regenerates with this fix (uses credits like a new generation).</p>
    </div>
  )
}
