const GRAPH_VERSION = "v21.0"

export type PublishToInstagramResult =
  | { success: true; instagramMediaId: string }
  | { success: false; error: string; retryable: boolean }

type GraphErrorBody = {
  error?: {
    message?: string
    code?: number
    error_subcode?: number
  }
}

// Meta rate-limit / throttling error codes — these should be retried on a
// later cron run, not treated as a permanent failure.
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613])
// Invalid/expired OAuth token.
const INVALID_TOKEN_CODE = 190

function interpretGraphError(body: GraphErrorBody): { message: string; retryable: boolean } {
  const err = body?.error
  const code = err?.code

  if (code !== undefined && RATE_LIMIT_CODES.has(code)) {
    return { message: "Instagram rate limit reached — will retry later.", retryable: true }
  }
  if (code === INVALID_TOKEN_CODE) {
    return { message: "Instagram access token is invalid or expired. Reconnect the account.", retryable: false }
  }
  return { message: err?.message ?? "Instagram API error.", retryable: false }
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
      const { message, retryable } = interpretGraphError(containerJson)
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
      const { message, retryable } = interpretGraphError(publishJson)
      console.error("[instagram-publish] media publish failed:", message)
      return { success: false, error: message, retryable }
    }

    return { success: true, instagramMediaId: publishJson.id }
  } catch (err) {
    console.error("[instagram-publish] unexpected error:", err instanceof Error ? err.message : err)
    return { success: false, error: "Unexpected error publishing to Instagram.", retryable: true }
  }
}
