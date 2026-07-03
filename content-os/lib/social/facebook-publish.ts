import { interpretGraphError, type GraphErrorBody } from "./graph-api-errors"

const GRAPH_VERSION = "v21.0"

export type PublishToFacebookResult =
  | { success: true; facebookPostId: string }
  | { success: false; error: string; retryable: boolean }

function toPublishError(body: GraphErrorBody): { message: string; retryable: boolean } {
  const interpreted = interpretGraphError(body)

  if (interpreted.kind === "rate_limit") {
    return { message: "Facebook rate limit reached — will retry later.", retryable: true }
  }
  if (interpreted.kind === "invalid_token" || interpreted.kind === "permission_error") {
    return {
      message: "This connection needs to be refreshed to enable Facebook posting. Disconnect and reconnect to grant access.",
      retryable: false,
    }
  }
  return { message: interpreted.message, retryable: interpreted.retryable }
}

/**
 * Posts a photo with a caption directly to a Facebook Page's feed. Unlike
 * Instagram, this is a single call — no media-container step. Never throws —
 * all failure modes are returned as { success: false, ... } so callers can
 * handle retries safely.
 */
export async function publishToFacebook(
  facebookPageId: string,
  accessToken: string,
  media: { imageUrl: string; message: string }
): Promise<PublishToFacebookResult> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${facebookPageId}/photos`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          url: media.imageUrl,
          caption: media.message,
          access_token: accessToken,
        }),
      }
    )
    const json = await res.json()
    const facebookPostId: string | undefined = json.post_id ?? json.id

    if (!res.ok || !facebookPostId) {
      const { message, retryable } = toPublishError(json)
      console.error("[facebook-publish] photo post failed:", message)
      return { success: false, error: message, retryable }
    }

    return { success: true, facebookPostId }
  } catch (err) {
    console.error("[facebook-publish] unexpected error:", err instanceof Error ? err.message : err)
    return { success: false, error: "Unexpected error publishing to Facebook.", retryable: true }
  }
}
