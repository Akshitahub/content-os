/**
 * Kling AI video generation client.
 *
 * PROVIDER NOTE: Kling can be reached either via Kuaishou's own direct API
 * (what this file targets — https://klingapi.com/docs) or via an aggregator
 * that resells Kling access, e.g. PiAPI (https://piapi.ai/docs/kling-api),
 * fal.ai (https://fal.ai/models/fal-ai/kling-video), or WaveSpeedAI. Several
 * of those are commonly used in production instead of the direct API since
 * they smooth over Kuaishou's account/region setup. No provider has been
 * chosen yet, so this defaults to the direct API's request/response shape.
 * If a different provider is bought instead, only `submitKlingJob` and
 * `pollKlingJob` below need to change (different base URL, auth header,
 * and response field names) — `generateKlingVideo`'s public signature, and
 * every call site elsewhere in the app, stays the same.
 *
 * COST: Kling's budget/"std" tier without native audio runs roughly
 * $0.07-0.08 per second of generated video (a 5s clip ≈ $0.35-0.40, a 10s
 * clip ≈ $0.70-0.80). Every reel scene generated through this client has a
 * real, non-trivial cost — keep that in mind before loosening reel limits,
 * retry counts, or poll timeouts.
 */

const KLING_API_BASE = "https://api.klingapi.com/v1"

// Kling generation is genuinely slow (roughly 30s-several minutes per clip
// depending on provider/load) — this is not a near-instant call like
// Pollinations was. 5s interval, up to 48 attempts = ~4 minutes of polling
// per scene before giving up.
const POLL_INTERVAL_MS = 5000
const MAX_POLL_ATTEMPTS = 48

// Matches the exponential backoff already used in
// lib/video/reel-scene-assets.ts and lib/storage/upload-media.ts for
// rate-limited (429) calls: 1s, 2s, 4s, 8s.
const SUBMIT_BACKOFF_DELAYS_MS = [1000, 2000, 4000, 8000]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface KlingSubmitResponse {
  task_id?: string
  code?: number
  message?: string
}

interface KlingPollResponse {
  task_status?: "submitted" | "processing" | "succeed" | "failed"
  task_status_msg?: string
  task_result?: {
    videos?: { url: string }[]
  }
}

type KlingSubmitResult =
  | { taskId: string }
  | { error: string; retryable: boolean }

type KlingPollResult =
  | { videoUrl: string }
  | { error: string; retryable: boolean }

async function submitKlingJob(
  apiKey: string,
  prompt: string,
  options: { durationSeconds: number; aspectRatio: "9:16" | "16:9" | "1:1" }
): Promise<KlingSubmitResult> {
  // Kling only supports fixed 5s/10s clip lengths as of writing — round to
  // the nearest supported duration rather than failing outright.
  const duration = options.durationSeconds > 7 ? "10" : "5"

  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(`${KLING_API_BASE}/videos/text2video`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "kling-v1",
          prompt: prompt.slice(0, 2500),
          duration,
          aspect_ratio: options.aspectRatio,
          // "std" is the budget tier and excludes Kling's native audio —
          // we generate our own voiceover via Groq TTS and layer it in
          // separately, so paying for Kling's audio would be redundant.
          mode: "std",
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

    if (!res.ok || !json?.task_id) {
      const message = json?.message ?? `Kling submit failed (${res.status})`
      console.error("[kling-client] submit failed:", message)
      return { error: message, retryable: res.status === 429 || res.status >= 500 }
    }

    return { taskId: json.task_id }
  }
}

async function pollKlingJob(apiKey: string, taskId: string): Promise<KlingPollResult> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS)

    let res: Response
    try {
      res = await fetch(`${KLING_API_BASE}/videos/text2video/${taskId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
    } catch (err) {
      // Transient network hiccup — keep polling rather than failing the
      // whole scene on one dropped request.
      console.error(`[kling-client] poll network error (task ${taskId}):`, err instanceof Error ? err.message : err)
      continue
    }

    if (!res.ok) {
      console.error(`[kling-client] poll failed for task ${taskId}: HTTP ${res.status}`)
      continue
    }

    const json = await res.json().catch(() => null) as KlingPollResponse | null

    if (json?.task_status === "succeed") {
      const videoUrl = json.task_result?.videos?.[0]?.url
      if (!videoUrl) {
        return { error: "Kling reported success but returned no video.", retryable: false }
      }
      return { videoUrl }
    }

    if (json?.task_status === "failed") {
      return { error: json.task_status_msg ?? "Kling video generation failed.", retryable: false }
    }

    // "submitted" / "processing" (or an unrecognized transient shape) —
    // keep polling until MAX_POLL_ATTEMPTS is exhausted.
  }

  return { error: "Timed out waiting for video generation to finish.", retryable: true }
}

export async function generateKlingVideo(
  prompt: string,
  options: { durationSeconds: number; aspectRatio: "9:16" | "16:9" | "1:1" }
): Promise<{ success: true; videoUrl: string } | { success: false; error: string; retryable: boolean }> {
  const apiKey = process.env.KLING_API_KEY
  if (!apiKey) {
    console.error("[kling-client] KLING_API_KEY is not configured")
    return { success: false, error: "Video generation isn't configured yet.", retryable: false }
  }

  if (!prompt.trim()) {
    return { success: false, error: "No prompt provided for video generation.", retryable: false }
  }

  try {
    const submitResult = await submitKlingJob(apiKey, prompt, options)
    if ("error" in submitResult) {
      return { success: false, error: submitResult.error, retryable: submitResult.retryable }
    }

    const pollResult = await pollKlingJob(apiKey, submitResult.taskId)
    if ("error" in pollResult) {
      return { success: false, error: pollResult.error, retryable: pollResult.retryable }
    }

    return { success: true, videoUrl: pollResult.videoUrl }
  } catch (err) {
    console.error("[kling-client] unexpected error:", err instanceof Error ? err.message : err)
    return { success: false, error: "Unexpected error generating video.", retryable: true }
  }
}
