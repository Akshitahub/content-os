// NOTE: kept as `imageUrl` to match remotion/ReelComposition.tsx's existing
// prop name (both untouched here — composition/rendering is a separate,
// later task). Scene generation itself now produces a real Kling video
// clip per scene (see lib/video/reel-scene-assets.ts's SceneAsset.videoUrl)
// rather than a still image — whoever implements this render step for real
// will need to swap ReelComposition's <Img> for a <Video> and rename this
// field to match at that point.
export interface RenderReelVideoInput {
  jobId: string
  scenes: { imageUrl: string; audioUrl: string | null; text: string; durationSeconds: number }[]
  musicUrl: string
}

export type RenderReelVideoResult =
  | { success: true; videoUrl: string }
  | { success: false; error: string }

const JSON2VIDEO_BASE = "https://api.json2video.com/v2"

// JSON2Video renders are async — this is not a near-instant call. 7s
// interval, up to 40 attempts = ~4-5 minutes of polling before giving up.
const POLL_INTERVAL_MS = 7000
const MAX_POLL_ATTEMPTS = 40

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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
 * Renders the final reel video via JSON2Video's hosted API — Remotion
 * itself can't run inside a Vercel serverless function (its rendering
 * stack requires bundling headless Chromium + FFmpeg, well over Vercel's
 * 50MB function size limit), so JSON2Video handles composition/rendering
 * instead: submit the scenes, then poll until the render finishes.
 */
export async function renderReelVideo(input: RenderReelVideoInput): Promise<RenderReelVideoResult> {
  const apiKey = process.env.JSON2VIDEO_API_KEY
  if (!apiKey) {
    console.error("[render-trigger] JSON2VIDEO_API_KEY is not configured")
    return { success: false, error: "Video rendering isn't configured yet." }
  }

  let projectId: string

  try {
    const res = await fetch(`${JSON2VIDEO_BASE}/movies`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        resolution: "instagram-story",
        scenes: input.scenes.map((scene) => ({
          elements: [
            { type: "video", src: scene.imageUrl, duration: scene.durationSeconds },
            ...(scene.audioUrl ? [{ type: "audio", src: scene.audioUrl }] : []),
          ],
        })),
        elements: [
          { type: "audio", src: input.musicUrl, volume: 0.2, duration: -1 },
        ],
      }),
    })

    const json = await res.json().catch(() => null) as Json2VideoCreateResponse | null

    if (!res.ok || !json?.success || !json.project) {
      const message = `JSON2Video render creation failed (${res.status})`
      console.error("[render-trigger] create failed:", message)
      return { success: false, error: message }
    }

    projectId = json.project
  } catch (err) {
    console.error("[render-trigger] create network error:", err instanceof Error ? err.message : err)
    return { success: false, error: "Couldn't reach the video rendering service." }
  }

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS)

    let res: Response
    try {
      res = await fetch(`${JSON2VIDEO_BASE}/movies?project=${projectId}`, {
        headers: { "x-api-key": apiKey },
      })
    } catch (err) {
      // Transient network hiccup — keep polling rather than failing the
      // whole render on one dropped request.
      console.error(`[render-trigger] poll network error (project ${projectId}):`, err instanceof Error ? err.message : err)
      continue
    }

    if (!res.ok) {
      console.error(`[render-trigger] poll failed for project ${projectId}: HTTP ${res.status}`)
      continue
    }

    const json = await res.json().catch(() => null) as Json2VideoPollResponse | null
    const status = json?.movie?.status

    if (status === "done") {
      const videoUrl = json?.movie?.url
      if (!videoUrl) {
        return { success: false, error: "JSON2Video reported success but returned no video." }
      }
      return { success: true, videoUrl }
    }

    if (status === "error") {
      return { success: false, error: json?.movie?.message ?? "Video rendering failed." }
    }

    // "pending" / "running" (or an unrecognized transient shape) — keep
    // polling until MAX_POLL_ATTEMPTS is exhausted.
  }

  return { success: false, error: "Timed out waiting for video rendering to finish." }
}
