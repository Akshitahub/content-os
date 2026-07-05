import { interpretGraphError, type GraphErrorBody } from "./graph-api-errors"

const GRAPH_VERSION = "v21.0"
const DELAY_BETWEEN_STORIES_MS = 2000

export type PublishStoryToInstagramResult =
  | { success: true; instagramMediaId: string }
  | { success: false; error: string; retryable: boolean }

export type PublishStorySequenceToInstagramResult =
  | { success: true; instagramMediaIds: string[] }
  | { success: false; error: string; retryable: boolean; publishedCount: number; failedAtSlide: number; instagramMediaIds: string[] }

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

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Publishes a single image as an Instagram Story via the standard two-step
 * container flow. Stories do not support a caption field on the Graph API
 * (unlike IMAGE/CAROUSEL/REELS) — the container is created with only
 * image_url and media_type: STORIES. Never throws — all failure modes are
 * returned as { success: false, ... } so callers can handle retries safely.
 */
export async function publishStoryToInstagram(
  igBusinessAccountId: string,
  accessToken: string,
  imageUrl: string
): Promise<PublishStoryToInstagramResult> {
  try {
    // Step 1: create the story media container
    const containerRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${igBusinessAccountId}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          image_url: imageUrl,
          media_type: "STORIES",
          access_token: accessToken,
        }),
      }
    )
    const containerJson = await containerRes.json()

    if (!containerRes.ok || !containerJson.id) {
      const { message, retryable } = toPublishError(containerJson)
      console.error("[instagram-story-publish] story container creation failed:", message)
      return { success: false, error: message, retryable }
    }

    const creationId: string = containerJson.id

    // Step 2: publish the container
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
      console.error("[instagram-story-publish] story publish failed:", message)
      return { success: false, error: message, retryable }
    }

    return { success: true, instagramMediaId: publishJson.id }
  } catch (err) {
    console.error("[instagram-story-publish] unexpected error:", err instanceof Error ? err.message : err)
    return { success: false, error: "Unexpected error publishing story to Instagram.", retryable: true }
  }
}

/**
 * Publishes a sequence of images as separate, independent Instagram Stories,
 * one after another (Stories have no carousel/parent-container concept —
 * each slide is its own container + publish call). Slides are published
 * sequentially with a delay between each, matching the cron's rate-limit
 * pacing. If a slide fails, publishing stops immediately: we report exactly
 * how many slides published successfully and which slide (1-indexed) failed,
 * rather than silently continuing or losing track of partial progress.
 */
export async function publishStorySequenceToInstagram(
  igBusinessAccountId: string,
  accessToken: string,
  imageUrls: string[]
): Promise<PublishStorySequenceToInstagramResult> {
  const publishedIds: string[] = []

  for (let i = 0; i < imageUrls.length; i++) {
    const result = await publishStoryToInstagram(igBusinessAccountId, accessToken, imageUrls[i]!)

    if (!result.success) {
      console.error(
        `[instagram-story-publish] sequence stopped at slide ${i + 1}/${imageUrls.length} (${publishedIds.length} published so far): ${result.error}`
      )
      return {
        success: false,
        error: result.error,
        retryable: result.retryable,
        publishedCount: publishedIds.length,
        failedAtSlide: i + 1,
        instagramMediaIds: publishedIds,
      }
    }

    publishedIds.push(result.instagramMediaId)

    if (i < imageUrls.length - 1) {
      await sleep(DELAY_BETWEEN_STORIES_MS)
    }
  }

  return { success: true, instagramMediaIds: publishedIds }
}
