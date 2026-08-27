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
    body: JSON.stringify({ name, description: `SocioPosts brand: ${name}` }),
  })
  const json = await res.json()

  // Zernio enforces unique profile names per account. This fires when an
  // earlier attempt created the profile at Zernio but failed at a later
  // step before it got persisted to social_connections (e.g. a request
  // that failed on getZernioConnectUrl right after) — our DB never learns
  // that profile exists, so every retry keeps trying to create a duplicate
  // and keeps colliding with it. Zernio's own conflict response hands back
  // the existing profile's id, so recover by reusing it instead of
  // treating this as fatal — the caller's normal "existing profile" path
  // then persists it, self-healing the gap for next time.
  if (res.status === 409 && json?.code === "profile_name_conflict" && json?.details?.existingProfileId) {
    console.error(`[zernio-client] createZernioProfile: name conflict for "${name}", reusing existingProfileId ${json.details.existingProfileId}`)
    return { _id: json.details.existingProfileId, name }
  }

  if (!res.ok || !json._id) {
    console.error(`[zernio-client] createZernioProfile failed (status ${res.status}):`, JSON.stringify(json))
    throw new Error(json?.message ?? json?.error ?? `Failed to create Zernio profile (${res.status})`)
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
    // Log the full body — a bare .message string has been misleading here
    // before (e.g. a profile-creation confirmation message surfacing on a
    // connect-URL failure), so the raw shape is needed to tell a genuine
    // Zernio-side rejection apart from us reading the wrong field name.
    console.error(`[zernio-client] getZernioConnectUrl(${platform}) failed (status ${res.status}):`, JSON.stringify(json))
    throw new Error(json?.message ?? json?.error ?? `Failed to start Zernio connect flow (${res.status})`)
  }
  return json
}

export type ZernioPublishResult =
  | { success: true; postId: string }
  | { success: false; error: string; retryable: boolean }

export interface ZernioMediaItem {
  type: "image" | "video"
  url: string
}

export async function publishViaZernio(
  platform: string,
  accountId: string,
  content: {
    text: string
    mediaUrls?: string[]
    // Explicit typed media, required by Zernio for anything beyond a single
    // plain attachment — Instagram carousels/Reels/Stories and Pinterest pins
    // all need { type, url } items (and Stories/Pinterest also need
    // platformSpecificData below); see docs.zernio.com/platforms/instagram
    // and /pinterest. Plain mediaUrls keeps working for the simpler
    // Twitter/LinkedIn/YouTube posts already using it.
    mediaItems?: ZernioMediaItem[]
    platformSpecificData?: Record<string, unknown>
    scheduledFor?: string
    timezone?: string
  }
): Promise<ZernioPublishResult> {
  try {
    const platformEntry: Record<string, unknown> = { platform, accountId }
    if (content.platformSpecificData) platformEntry.platformSpecificData = content.platformSpecificData

    const body: Record<string, unknown> = {
      content: content.text,
      platforms: [platformEntry],
    }
    if (content.mediaItems?.length) body.mediaItems = content.mediaItems
    else if (content.mediaUrls?.length) body.mediaUrls = content.mediaUrls
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
      const message = json?.message ?? json?.error ?? `Zernio publish failed (${res.status})`
      const retryable = res.status === 429 || res.status >= 500
      console.error(`[zernio-client] publish to ${platform} failed (status ${res.status}):`, JSON.stringify(json))
      return { success: false, error: message, retryable }
    }

    return { success: true, postId }
  } catch (err) {
    console.error("[zernio-client] unexpected publish error:", err instanceof Error ? err.message : err)
    return { success: false, error: "Unexpected error publishing via Zernio.", retryable: true }
  }
}

export interface ZernioPinterestBoard {
  id: string
  name: string
}

// Pinterest's boardId is "effectively required" on every pin per Zernio's
// docs, but board selection isn't part of the OAuth connect step — this is
// called right after connecting to auto-pick a default board, the same way
// the old direct-OAuth flow auto-picked the first board.
export async function getZernioPinterestBoards(accountId: string): Promise<ZernioPinterestBoard[]> {
  const res = await fetch(`${ZERNIO_API_BASE}/accounts/${accountId}/pinterest-boards`, {
    headers: zernioHeaders(),
  })
  const json = await res.json()
  const boards = Array.isArray(json) ? json : Array.isArray(json?.boards) ? json.boards : null
  if (!res.ok || !boards) {
    console.error(`[zernio-client] getZernioPinterestBoards failed (status ${res.status}):`, JSON.stringify(json))
    throw new Error(json?.message ?? json?.error ?? `Failed to fetch Pinterest boards (${res.status})`)
  }
  return boards
}
