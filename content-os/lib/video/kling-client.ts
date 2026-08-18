/**
 * Kling AI video generation client — submit-and-webhook, not submit-and-poll.
 *
 * PROVIDER: PiAPI (https://piapi.ai/docs/kling-api), an aggregator reselling
 * Kuaishou's Kling model. `KLING_API_BASE` below is PiAPI's own base URL.
 *
 * ARCHITECTURE NOTE (2026-08-18): this used to submit a task and then poll
 * it in a loop inside the same request/function invocation — that's what
 * made reel video generation dependent on Vercel's maxDuration ceiling.
 * PiAPI supports a real webhook mechanism (confirmed via their docs, not
 * assumed) via a `webhook_config: { endpoint, secret }` field on task
 * creation — NOT a field literally called `callBackUrl`. This client now
 * only submits; the webhook receiver at app/api/v1/webhooks/kling/route.ts
 * is where a task's result actually gets handled, in its own separate
 * function invocation with its own fresh execution budget.
 *
 * Webhook payload PiAPI POSTs to `endpoint`: `{ timestamp, data }`, where
 * `data` mirrors this same file's KlingTaskData shape (task_id, status,
 * output.video_url, error.message) — i.e. the same shape the old poll
 * endpoint returned. Auth is a plain shared secret, not HMAC: if a secret
 * is configured, PiAPI sends it back verbatim in an `x-webhook-secret`
 * header for the receiver to compare — see the webhook route for that
 * check. Fires on both task-created and terminal (completed/failed)
 * states, and retries up to 3x on a non-2xx response.
 *
 * COST: Kling's budget/"std" tier without native audio runs roughly
 * $0.07-0.08 per second of generated video (a 5s clip ≈ $0.35-0.40, a 10s
 * clip ≈ $0.70-0.80). Every reel scene generated through this client has a
 * real, non-trivial cost — keep that in mind before loosening reel limits
 * or retry counts.
 */

const KLING_API_BASE = "https://api.piapi.ai/api/v1"

// Matches the exponential backoff already used elsewhere in this codebase
// (lib/video/reel-scene-assets.ts, lib/storage/upload-media.ts) for
// rate-limited (429) calls: 1s, 2s, 4s, 8s.
const SUBMIT_BACKOFF_DELAYS_MS = [1000, 2000, 4000, 8000]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface KlingSubmitResponse {
  code?: number
  data?: {
    task_id?: string
    status?: "pending" | "processing" | "failed" | "completed"
    error?: { message?: string }
  }
}

/** The shape of PiAPI's webhook `data` field, and of a GET /task/{id} response's `data` — identical either way. */
export interface KlingTaskData {
  task_id?: string
  status?: "pending" | "processing" | "failed" | "completed"
  output?: { video_url?: string }
  error?: { message?: string }
}

export interface KlingWebhookPayload {
  timestamp?: number
  data?: KlingTaskData
}

export interface KlingWebhookConfig {
  endpoint: string
  secret: string
}

export type KlingSubmitResult =
  | { taskId: string }
  | { error: string; retryable: boolean }

/**
 * Submits a Kling video generation task and returns immediately with its
 * task_id — does NOT wait for the video to finish. The result arrives
 * later via the webhook configured in `webhook`.
 */
export async function submitKlingVideoJob(
  prompt: string,
  options: { durationSeconds: number; aspectRatio: "9:16" | "16:9" | "1:1" },
  webhook: KlingWebhookConfig
): Promise<KlingSubmitResult> {
  const apiKey = process.env.KLING_API_KEY
  if (!apiKey) {
    console.error("[kling-client] KLING_API_KEY is not configured")
    return { error: "Video generation isn't configured yet.", retryable: false }
  }
  if (!prompt.trim()) {
    return { error: "No prompt provided for video generation.", retryable: false }
  }

  // Kling only supports fixed 5s/10s clip lengths as of writing — round to
  // the nearest supported duration rather than failing outright.
  const duration = options.durationSeconds > 7 ? 10 : 5

  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(`${KLING_API_BASE}/task`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "kling",
          task_type: "video_generation",
          input: {
            prompt: prompt.slice(0, 2500),
            duration,
            aspect_ratio: options.aspectRatio,
            // "std" is the budget tier and excludes Kling's native audio —
            // we generate our own voiceover via Groq TTS and layer it in
            // separately, so paying for Kling's audio would be redundant.
            mode: "std",
          },
          webhook_config: { endpoint: webhook.endpoint, secret: webhook.secret },
        }),
      })
    } catch (err) {
      console.error("[kling-client] submit network error:", err instanceof Error ? err.message : err)
      return { error: "Couldn't reach the video generation service.", retryable: true }
    }

    if (res.status === 429 && attempt < SUBMIT_BACKOFF_DELAYS_MS.length) {
      const delay = SUBMIT_BACKOFF_DELAYS_MS[attempt]!
      console.log(`[kling-client] Rate limited on submit, retrying in ${delay}ms (attempt ${attempt + 1})...`)
      await sleep(delay)
      continue
    }

    const json = await res.json().catch(() => null) as KlingSubmitResponse | null
    const taskId = json?.data?.task_id
    const submitError = json?.data?.error?.message

    if (!res.ok || json?.code !== 200 || submitError || !taskId) {
      const message = submitError ?? `Kling submit failed (${res.status})`
      console.error("[kling-client] submit failed:", message)
      return { error: message, retryable: res.status === 429 || res.status >= 500 }
    }

    return { taskId }
  }
}
