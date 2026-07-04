import { interpretGraphError, type GraphErrorBody } from "./graph-api-errors"

const GRAPH_VERSION = "v21.0"
const MIN_CAROUSEL_IMAGES = 2
const MAX_CAROUSEL_IMAGES = 10

export type PublishCarouselToInstagramResult =
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
 * Publishes a multi-image carousel post to an Instagram Business Account.
 * Each image becomes its own "carousel item" child container; a parent
 * container (media_type: CAROUSEL) then references all child container
 * IDs, and only the parent gets published. Instagram-only — Facebook
 * carousel posting is a separate, more complex flow and out of scope here.
 *
 * Never throws — all failure modes are returned as { success: false, ... }.
 * Never partially publishes: child containers are just unpublished drafts
 * (Meta expires them automatically), so if any child fails, we return
 * immediately without ever creating or publishing the parent container.
 */
export async function publishCarouselToInstagram(
  igBusinessAccountId: string,
  accessToken: string,
  media: { imageUrls: string[]; caption: string }
): Promise<PublishCarouselToInstagramResult> {
  const { imageUrls, caption } = media

  if (imageUrls.length < MIN_CAROUSEL_IMAGES || imageUrls.length > MAX_CAROUSEL_IMAGES) {
    return {
      success: false,
      error: `Instagram carousels need between ${MIN_CAROUSEL_IMAGES} and ${MAX_CAROUSEL_IMAGES} images (got ${imageUrls.length}).`,
      retryable: false,
    }
  }

  try {
    // Step 1: create a child "carousel item" container for every image
    const childCreationIds: string[] = []
    for (const imageUrl of imageUrls) {
      const childRes = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${igBusinessAccountId}/media`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            image_url: imageUrl,
            is_carousel_item: "true",
            access_token: accessToken,
          }),
        }
      )
      const childJson = await childRes.json()

      if (!childRes.ok || !childJson.id) {
        const { message, retryable } = toPublishError(childJson)
        console.error("[instagram-carousel-publish] child container creation failed:", message)
        return { success: false, error: message, retryable }
      }

      childCreationIds.push(childJson.id)
    }

    // Step 2: create the parent carousel container referencing all children
    const parentRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${igBusinessAccountId}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          media_type: "CAROUSEL",
          children: childCreationIds.join(","),
          caption,
          access_token: accessToken,
        }),
      }
    )
    const parentJson = await parentRes.json()

    if (!parentRes.ok || !parentJson.id) {
      const { message, retryable } = toPublishError(parentJson)
      console.error("[instagram-carousel-publish] parent container creation failed:", message)
      return { success: false, error: message, retryable }
    }

    const parentCreationId: string = parentJson.id

    // Step 3: publish the parent container
    const publishRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${igBusinessAccountId}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          creation_id: parentCreationId,
          access_token: accessToken,
        }),
      }
    )
    const publishJson = await publishRes.json()

    if (!publishRes.ok || !publishJson.id) {
      const { message, retryable } = toPublishError(publishJson)
      console.error("[instagram-carousel-publish] carousel publish failed:", message)
      return { success: false, error: message, retryable }
    }

    return { success: true, instagramMediaId: publishJson.id }
  } catch (err) {
    console.error("[instagram-carousel-publish] unexpected error:", err instanceof Error ? err.message : err)
    return { success: false, error: "Unexpected error publishing carousel to Instagram.", retryable: true }
  }
}
