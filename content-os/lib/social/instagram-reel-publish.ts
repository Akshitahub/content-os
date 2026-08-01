import { interpretGraphError, type GraphErrorBody } from "./graph-api-errors"
import type { PublishToInstagramResult } from "./instagram-publish"

const GRAPH_VERSION = "v21.0"

// Instagram needs to process the uploaded video before the container can be
// published — unlike an image container, which is ready immediately. 3s
// interval, up to 20 attempts = ~1 minute of polling before giving up.
const POLL_INTERVAL_MS = 3000
const MAX_POLL_ATTEMPTS = 20

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toPublishError(body: GraphErrorBody): { message: string; retryable: boolean } {
  const interpreted = interpretGraphError(body)

  if (interpreted.kind === "rate_limit") {
    return { message: "Instagram rate limit reached — will retry later.", retryable: true }
  }
  if (interpreted.kind === "invalid_token" || interpreted.kind === "permission_error") {
    return { message: "Instagram access token is invalid or expired. Reconnect the account.", retryable: false }
  }
  return { message: interpreted.message, retryable: interpreted.retryable }
}

/**
 * Publishes a Reel video to an Instagram Business Account using the Graph
 * API's container flow. Unlike an image container (ready immediately), a
 * REELS container needs to finish processing the video before it can be
 * published, so this polls the container's status_code before calling
 * media_publish. Never throws — all failure modes are returned as
 * { success: false, ... } so callers can handle retries safely.
 */
export async function publishReelToInstagram(
  igBusinessAccountId: string,
  accessToken: string,
  media: { videoUrl: string; caption: string }
): Promise<PublishToInstagramResult> {
  try {
    // Step 1: create the REELS media container
    const containerRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${igBusinessAccountId}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          media_type: "REELS",
          video_url: media.videoUrl,
          caption: media.caption,
          access_token: accessToken,
        }),
      }
    )
    const containerJson = await containerRes.json()

    if (!containerRes.ok || !containerJson.id) {
      const { message, retryable } = toPublishError(containerJson)
      console.error("[instagram-reel-publish] media container creation failed:", message)
      return { success: false, error: message, retryable }
    }

    const creationId: string = containerJson.id

    // Step 2: poll until Instagram has finished processing the video
    let ready = false
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS)

      const statusRes = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${creationId}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`
      )
      const statusJson = await statusRes.json()

      if (!statusRes.ok) {
        console.error(`[instagram-reel-publish] status poll failed for container ${creationId}: HTTP ${statusRes.status}`)
        continue
      }

      if (statusJson.status_code === "FINISHED") {
        ready = true
        break
      }

      if (statusJson.status_code === "ERROR") {
        if (statusJson.error) {
          const { message, retryable } = toPublishError(statusJson)
          console.error("[instagram-reel-publish] video processing failed:", message)
          return { success: false, error: message, retryable }
        }
        console.error(`[instagram-reel-publish] video processing failed with no error detail (container ${creationId})`)
        return { success: false, error: "Instagram failed to process the video.", retryable: false }
      }

      // "IN_PROGRESS" / "PUBLISHED" (or an unrecognized transient shape) —
      // keep polling until MAX_POLL_ATTEMPTS is exhausted.
    }

    if (!ready) {
      return { success: false, error: "Timed out waiting for Instagram to process the video.", retryable: true }
    }

    // Step 3: publish the container
    const publishRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${igBusinessAccountId}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          creation_id: creationId,
          access_token: accessToken,
        }),
      }
    )
    const publishJson = await publishRes.json()

    if (!publishRes.ok || !publishJson.id) {
      const { message, retryable } = toPublishError(publishJson)
      console.error("[instagram-reel-publish] media publish failed:", message)
      return { success: false, error: message, retryable }
    }

    return { success: true, instagramMediaId: publishJson.id }
  } catch (err) {
    console.error("[instagram-reel-publish] unexpected error:", err instanceof Error ? err.message : err)
    return { success: false, error: "Unexpected error publishing to Instagram.", retryable: true }
  }
}
