// NOTE: kept as `imageUrl` to match remotion/ReelComposition.tsx's existing
// prop name (both untouched here — composition/rendering is a separate,
// later task). Scene generation itself now produces a real Kling video
// clip per scene (see lib/video/reel-scene-assets.ts's SceneAsset.videoUrl)
// rather than a still image — whoever implements this render step for real
// will need to swap ReelComposition's <Img> for a <Video> and rename this
// field to match at that point.
export interface SubmitReelRenderInput {
  jobId: string
  scenes: { imageUrl: string; audioUrl: string | null; text: string; durationSeconds: number }[]
  musicUrl: string | null
}

export interface Json2VideoWebhookConfig {
  endpoint: string
}

export type SubmitReelRenderResult =
  | { projectId: string }
  | { error: string }

const JSON2VIDEO_BASE = "https://api.json2video.com/v2"

interface Json2VideoCreateResponse {
  success?: boolean
  project?: string
}

interface Json2VideoPollResponse {
  success?: boolean
  movie?: {
    status?: "done" | "error" | "pending" | "running"
    url?: string
    message?: string
  }
}

/**
 * Submits the final reel render to JSON2Video's hosted API — Remotion
 * itself can't run inside a Vercel serverless function (its rendering
 * stack requires bundling headless Chromium + FFmpeg, well over Vercel's
 * 50MB function size limit) — with a webhook destination instead of
 * polling for the result (2026-08-18: JSON2Video renders used to be polled
 * in-request, up to ~280s; see app/api/v1/webhooks/json2video/route.ts for
 * where the result actually gets handled now). Returns immediately once
 * JSON2Video accepts the job.
 *
 * `id` is set to our own jobId — confirmed via JSON2Video's docs that this
 * top-level field is caller-settable and echoes back verbatim in the
 * webhook payload, separate from JSON2Video's own generated `project` id —
 * that's how the webhook receiver correlates a callback back to a job.
 */
export async function submitReelRender(input: SubmitReelRenderInput, webhook: Json2VideoWebhookConfig): Promise<SubmitReelRenderResult> {
  const apiKey = process.env.JSON2VIDEO_API_KEY
  if (!apiKey) {
    console.error("[render-trigger] JSON2VIDEO_API_KEY is not configured")
    return { error: "Video rendering isn't configured yet." }
  }

  try {
    const res = await fetch(`${JSON2VIDEO_BASE}/movies`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: input.jobId,
        resolution: "instagram-story",
        scenes: input.scenes.map((scene) => ({
          elements: [
            { type: "video", src: scene.imageUrl, duration: scene.durationSeconds },
            ...(scene.audioUrl ? [{ type: "audio", src: scene.audioUrl }] : []),
          ],
        })),
        elements: input.musicUrl
          ? [{ type: "audio", src: input.musicUrl, volume: 0.2, duration: -1 }]
          : [],
        exports: [{ destinations: [{ type: "webhook", endpoint: webhook.endpoint }] }],
      }),
    })

    const json = await res.json().catch(() => null) as Json2VideoCreateResponse | null

    if (!res.ok || !json?.success || !json.project) {
      const message = `JSON2Video render creation failed (${res.status})`
      console.error("[render-trigger] create failed:", message)
      return { error: message }
    }

    return { projectId: json.project }
  } catch (err) {
    console.error("[render-trigger] create network error:", err instanceof Error ? err.message : err)
    return { error: "Couldn't reach the video rendering service." }
  }
}

export interface Json2VideoStatus {
  status: "done" | "error" | "pending" | "running" | undefined
  videoUrl: string | null
  message: string | null
}

/**
 * Fetches a render's authoritative current status directly from JSON2Video
 * — used by the webhook receiver instead of trusting the webhook payload's
 * own contents, since JSON2Video's webhooks aren't signed at all ("Webhooks
 * are not currently signed by JSON2Video" — their own docs) and their own
 * guidance is to always cross-check via this same endpoint before acting
 * on a callback.
 */
export async function fetchJson2VideoStatus(projectId: string): Promise<Json2VideoStatus | { error: string }> {
  const apiKey = process.env.JSON2VIDEO_API_KEY
  if (!apiKey) {
    console.error("[render-trigger] JSON2VIDEO_API_KEY is not configured")
    return { error: "Video rendering isn't configured yet." }
  }

  try {
    const res = await fetch(`${JSON2VIDEO_BASE}/movies?project=${projectId}`, {
      headers: { "x-api-key": apiKey },
    })
    if (!res.ok) {
      return { error: `JSON2Video status check failed (${res.status}).` }
    }
    const json = await res.json().catch(() => null) as Json2VideoPollResponse | null
    return {
      status: json?.movie?.status,
      videoUrl: json?.movie?.url ?? null,
      message: json?.movie?.message ?? null,
    }
  } catch (err) {
    console.error(`[render-trigger] status check network error (project ${projectId}):`, err instanceof Error ? err.message : err)
    return { error: err instanceof Error ? err.message : "Couldn't reach the video rendering service." }
  }
}
