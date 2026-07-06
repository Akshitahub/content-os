const ZERNIO_API_BASE = "https://zernio.com/api/v1"

function zernioHeaders(): HeadersInit {
  const apiKey = process.env.ZERNIO_API_KEY
  if (!apiKey) throw new Error("ZERNIO_API_KEY is not configured")
  return {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  }
}

export interface ZernioProfile {
  _id: string
  name: string
}

export async function createZernioProfile(name: string): Promise<ZernioProfile> {
  const res = await fetch(`${ZERNIO_API_BASE}/profiles`, {
    method: "POST",
    headers: zernioHeaders(),
    body: JSON.stringify({ name, description: `ContentOS brand: ${name}` }),
  })
  const json = await res.json()
  if (!res.ok || !json._id) {
    throw new Error(json?.message ?? `Failed to create Zernio profile (${res.status})`)
  }
  return json
}

export interface ZernioConnectUrlResult {
  authUrl: string
  state: string
}

export async function getZernioConnectUrl(
  platform: string,
  profileId: string,
  redirectUrl: string
): Promise<ZernioConnectUrlResult> {
  const url = new URL(`${ZERNIO_API_BASE}/connect/${platform}`)
  url.searchParams.set("profileId", profileId)
  url.searchParams.set("redirect_url", redirectUrl)

  const res = await fetch(url.toString(), { headers: zernioHeaders() })
  const json = await res.json()
  if (!res.ok || !json.authUrl) {
    throw new Error(json?.message ?? `Failed to start Zernio connect flow (${res.status})`)
  }
  return json
}

export type ZernioPublishResult =
  | { success: true; postId: string }
  | { success: false; error: string; retryable: boolean }

export async function publishViaZernio(
  platform: string,
  accountId: string,
  content: { text: string; mediaUrls?: string[]; scheduledFor?: string; timezone?: string }
): Promise<ZernioPublishResult> {
  try {
    const body: Record<string, unknown> = {
      content: content.text,
      platforms: [{ platform, accountId }],
    }
    if (content.mediaUrls?.length) body.mediaUrls = content.mediaUrls
    if (content.scheduledFor) {
      body.scheduledFor = content.scheduledFor
      body.timezone = content.timezone ?? "Asia/Kolkata"
    } else {
      body.publishNow = true
    }

    const res = await fetch(`${ZERNIO_API_BASE}/posts`, {
      method: "POST",
      headers: zernioHeaders(),
      body: JSON.stringify(body),
    })
    const json = await res.json()
    const postId: string | undefined = json?.post?._id ?? json?._id

    if (!res.ok || !postId) {
      const message = json?.message ?? `Zernio publish failed (${res.status})`
      const retryable = res.status === 429 || res.status >= 500
      console.error(`[zernio-client] publish to ${platform} failed:`, message)
      return { success: false, error: message, retryable }
    }

    return { success: true, postId }
  } catch (err) {
    console.error("[zernio-client] unexpected publish error:", err instanceof Error ? err.message : err)
    return { success: false, error: "Unexpected error publishing via Zernio.", retryable: true }
  }
}
