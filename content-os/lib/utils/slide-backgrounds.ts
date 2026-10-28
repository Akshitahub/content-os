// Shared by CarouselBuilder.tsx and StorySequence.tsx: runs a set's AI
// slide-background requests with a concurrency limit, retries each
// failure once, and stops starting new ones once credits run out.
//
// Each request is its own server call, charged up front and refunded by
// the server when it fails (see the carousel / stories slide-image routes),
// so a slide that ends up in `failed` or `outOfCredits` cost nothing.

import type { TextStyle } from "@/lib/design/text-style"

/** What one slide-background request came back with. "restricted" is a
 * plan gate (e.g. the CTA slide's AI background), not a failure -- it is
 * neither retried nor reported as failed. */
export type SlideBackgroundOutcome =
  | { url: string; provider?: "openai"; text_style?: TextStyle | null }
  | { error: "insufficient_credits" | "failed" | "restricted" }

export type SlideBackgroundJob<K> = { key: K; run: () => Promise<SlideBackgroundOutcome> }

export type SlideBackgroundRunResult<K> = {
  succeeded: Map<K, { url: string; provider?: "openai"; text_style?: TextStyle | null }>
  /** Failed twice (first attempt + the automatic retry). */
  failed: K[]
  /** Got a 429, or never started because an earlier one did. */
  outOfCredits: K[]
}

export const SLIDE_BACKGROUND_CONCURRENCY = 3

export async function runSlideBackgroundJobs<K>(
  jobs: SlideBackgroundJob<K>[],
  options: {
    concurrency?: number
    /** Called after each slide settles (success, failure or skip). */
    onProgress?: (settled: number, total: number) => void
    /** Checked before starting each request -- true stops the run (e.g. the
     * user started a new generation). Unstarted jobs are then dropped. */
    isCancelled?: () => boolean
  } = {}
): Promise<SlideBackgroundRunResult<K>> {
  const result: SlideBackgroundRunResult<K> = { succeeded: new Map(), failed: [], outOfCredits: [] }
  const concurrency = Math.max(1, options.concurrency ?? SLIDE_BACKGROUND_CONCURRENCY)
  let next = 0
  let settled = 0
  let creditsExhausted = false

  const settle = () => {
    settled++
    options.onProgress?.(settled, jobs.length)
  }

  async function worker() {
    while (next < jobs.length) {
      if (options.isCancelled?.()) return
      const job = jobs[next++]!
      if (creditsExhausted) {
        result.outOfCredits.push(job.key)
        settle()
        continue
      }
      let outcome = await job.run()
      // One automatic retry for a plain failure. Not for a 429 (it would
      // just be refused again) or a plan restriction.
      if ("error" in outcome && outcome.error === "failed" && !creditsExhausted && !options.isCancelled?.()) {
        outcome = await job.run()
      }
      if ("url" in outcome) {
        result.succeeded.set(job.key, { url: outcome.url, provider: outcome.provider, text_style: outcome.text_style ?? null })
      } else if (outcome.error === "insufficient_credits") {
        creditsExhausted = true
        result.outOfCredits.push(job.key)
      } else if (outcome.error === "failed") {
        result.failed.push(job.key)
      }
      settle()
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()))
  return result
}

/** Maps a slide-image route response status to an outcome error. */
export function slideBackgroundErrorForStatus(status: number): "insufficient_credits" | "restricted" | "failed" {
  if (status === 429) return "insufficient_credits"
  if (status === 403) return "restricted"
  return "failed"
}
