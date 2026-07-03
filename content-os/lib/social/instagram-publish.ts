import { interpretGraphError, type GraphErrorBody } from "./graph-api-errors"

const GRAPH_VERSION = "v21.0"

export type PublishToInstagramResult =
  | { success: true; instagramMediaId: string }
  | { success: false; error: string; retryable: boolean }

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
 * Publishes a single image post to an Instagram Business Account using the
 * Graph API's two-step container flow. Never throws — all failure modes are
 * returned as { success: false, ... } so callers can handle retries safely.
 */
export async function publishToInstagram(
  igBusinessAccountId: string,
  accessToken: string,
  media: { imageUrl: string; caption: string }
): Promise<PublishToInstagramResult> {
  try {
    // Step 1: create the media container
    const containerRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${igBusinessAccountId}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          image_url: media.imageUrl,
          caption: media.caption,
          access_token: accessToken,
        }),
      }
    )
    const containerJson = await containerRes.json()

    if (!containerRes.ok || !containerJson.id) {
      const { message, retryable } = toPublishError(containerJson)
      console.error("[instagram-publish] media container creation failed:", message)
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
      console.error("[instagram-publish] media publish failed:", message)
      return { success: false, error: message, retryable }
    }

    return { success: true, instagramMediaId: publishJson.id }
  } catch (err) {
    console.error("[instagram-publish] unexpected error:", err instanceof Error ? err.message : err)
    return { success: false, error: "Unexpected error publishing to Instagram.", retryable: true }
  }
}
