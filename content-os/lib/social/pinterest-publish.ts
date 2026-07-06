const PINTEREST_API_BASE = "https://api.pinterest.com/v5"

export type PublishToPinterestResult =
  | { success: true; pinId: string }
  | { success: false; error: string; retryable: boolean }

interface PinterestErrorBody {
  code?: number
  message?: string
}

function toPublishError(body: PinterestErrorBody): { message: string; retryable: boolean } {
  const message = body.message ?? "Unknown error publishing to Pinterest."
  if (body.code === 429 || /rate limit/i.test(message)) {
    return { message: "Pinterest rate limit reached — will retry later.", retryable: true }
  }
  if (body.code === 401 || /token|unauthorized/i.test(message)) {
    return {
      message: "This connection needs to be refreshed to enable Pinterest posting. Disconnect and reconnect to grant access.",
      retryable: false,
    }
  }
  return { message, retryable: false }
}

export async function publishToPinterest(
  boardId: string,
  accessToken: string,
  media: { imageUrl: string; title: string; description: string; link?: string }
): Promise<PublishToPinterestResult> {
  try {
    const res = await fetch(`${PINTEREST_API_BASE}/pins`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        board_id: boardId,
        title: media.title.slice(0, 100),
        description: media.description.slice(0, 800),
        link: media.link,
        media_source: {
          source_type: "image_url",
          url: media.imageUrl,
        },
      }),
    })
    const json = await res.json()
    const pinId: string | undefined = json.id

    if (!res.ok || !pinId) {
      const { message, retryable } = toPublishError(json)
      console.error("[pinterest-publish] pin creation failed:", message)
      return { success: false, error: message, retryable }
    }

    return { success: true, pinId }
  } catch (err) {
    console.error("[pinterest-publish] unexpected error:", err instanceof Error ? err.message : err)
    return { success: false, error: "Unexpected error publishing to Pinterest.", retryable: true }
  }
}
