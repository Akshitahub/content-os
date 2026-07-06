const THREADS_API_VERSION = "v1.0"

export type PublishToThreadsResult =
  | { success: true; threadsPostId: string }
  | { success: false; error: string; retryable: boolean }

interface ThreadsErrorBody {
  error_type?: string
  code?: number
  error_message?: string
}

function toPublishError(body: ThreadsErrorBody): { message: string; retryable: boolean } {
  const message = body.error_message ?? "Unknown error publishing to Threads."
  if (body.code === 429 || /rate limit/i.test(message)) {
    return { message: "Threads rate limit reached — will retry later.", retryable: true }
  }
  if (body.code === 190 || /OAuthException/i.test(body.error_type ?? "") || /token/i.test(message)) {
    return {
      message: "This connection needs to be refreshed to enable Threads posting. Disconnect and reconnect to grant access.",
      retryable: false,
    }
  }
  return { message, retryable: false }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function publishToThreads(
  threadsUserId: string,
  accessToken: string,
  media: { imageUrl: string; text: string }
): Promise<PublishToThreadsResult> {
  try {
    const createRes = await fetch(
      `https://graph.threads.net/${THREADS_API_VERSION}/${threadsUserId}/threads`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          media_type: "IMAGE",
          image_url: media.imageUrl,
          text: media.text,
          access_token: accessToken,
        }),
      }
    )
    const createJson = await createRes.json()
    const containerId: string | undefined = createJson.id

    if (!createRes.ok || !containerId) {
      const { message, retryable } = toPublishError(createJson)
      console.error("[threads-publish] container creation failed:", message)
      return { success: false, error: message, retryable }
    }

    await sleep(30_000)

    const publishRes = await fetch(
      `https://graph.threads.net/${THREADS_API_VERSION}/${threadsUserId}/threads_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          creation_id: containerId,
          access_token: accessToken,
        }),
      }
    )
    const publishJson = await publishRes.json()
    const threadsPostId: string | undefined = publishJson.id

    if (!publishRes.ok || !threadsPostId) {
      const { message, retryable } = toPublishError(publishJson)
      console.error("[threads-publish] publish failed:", message)
      return { success: false, error: message, retryable }
    }

    return { success: true, threadsPostId }
  } catch (err) {
    console.error("[threads-publish] unexpected error:", err instanceof Error ? err.message : err)
    return { success: false, error: "Unexpected error publishing to Threads.", retryable: true }
  }
}
