export interface ScrapedInfluencerProfile {
  handle: string
  platform: "instagram" | "tiktok" | "youtube" | "linkedin"
  full_name: string | null
  bio: string | null
  follower_count: number | null
  post_count: number | null
  avatar_url: string | null
  profile_url: string
  raw: Record<string, unknown>
  scrape_success: boolean
  scrape_error: string | null
}

const DEFAULT_UA = "Mozilla/5.0 (compatible; bot)"

function makePartial(
  platform: "instagram" | "tiktok" | "youtube" | "linkedin",
  handle: string,
  profileUrl: string,
  partial: Partial<ScrapedInfluencerProfile>,
  error: string,
): ScrapedInfluencerProfile {
  return {
    handle,
    platform,
    full_name: null,
    bio: null,
    follower_count: null,
    post_count: null,
    avatar_url: null,
    profile_url: profileUrl,
    raw: {},
    ...partial,
    scrape_success: false,
    scrape_error: error,
  }
}

function parseFollowerCount(text: string): number | null {
  // Match patterns like "1.2M", "234K", "1,234,567", "1234567"
  const match = text.match(/(\d[\d,]*(?:\.\d+)?)\s*([KkMmBb])?(?:\s*(?:followers?|subscribers?))/i)
  if (!match) return null
  const raw = parseFloat(match[1].replace(/,/g, ""))
  const suffix = (match[2] ?? "").toUpperCase()
  if (suffix === "K") return Math.round(raw * 1_000)
  if (suffix === "M") return Math.round(raw * 1_000_000)
  if (suffix === "B") return Math.round(raw * 1_000_000_000)
  return Math.round(raw)
}

function extractMetaContent(html: string, property: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    "i",
  )
  const alt = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    "i",
  )
  return (html.match(re) ?? html.match(alt))?.[1] ?? null
}

// ─── Instagram ────────────────────────────────────────────────────────────────

async function scrapeInstagram(handle: string): Promise<ScrapedInfluencerProfile> {
  const profileUrl = `https://www.instagram.com/${handle}/`
  const partial: Partial<ScrapedInfluencerProfile> = { profile_url: profileUrl }

  // Approach 1: JSON API endpoint
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    let res: Response
    try {
      res = await fetch(`https://www.instagram.com/${handle}/?__a=1&__d=dis`, {
        headers: { Accept: "application/json", "User-Agent": DEFAULT_UA },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }

    if (res.ok) {
      const json = (await res.json()) as Record<string, unknown>
      const user =
        (json?.graphql as Record<string, unknown> | undefined)?.user ??
        (json?.data as Record<string, unknown> | undefined)?.user

      if (user && typeof user === "object") {
        const u = user as Record<string, unknown>
        const followedBy = u?.edge_followed_by as Record<string, unknown> | undefined
        const timeline = u?.edge_owner_to_timeline_media as Record<string, unknown> | undefined

        return {
          handle,
          platform: "instagram",
          full_name: typeof u.full_name === "string" ? u.full_name : null,
          bio: typeof u.biography === "string" ? u.biography : null,
          follower_count: typeof followedBy?.count === "number" ? followedBy.count : null,
          post_count: typeof timeline?.count === "number" ? timeline.count : null,
          avatar_url: typeof u.profile_pic_url === "string" ? u.profile_pic_url : null,
          profile_url: profileUrl,
          raw: json,
          scrape_success: true,
          scrape_error: null,
        }
      }
    }
  } catch {
    // fall through to approach 2
  }

  // Approach 2: HTML meta tags
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    let res: Response
    try {
      res = await fetch(profileUrl, {
        headers: { "User-Agent": DEFAULT_UA },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }

    if (res.ok) {
      const html = await res.text()
      const ogTitle = extractMetaContent(html, "og:title")
      const ogDesc = extractMetaContent(html, "og:description")
      const ogImage = extractMetaContent(html, "og:image")
      const follower_count = ogDesc ? parseFollowerCount(ogDesc) : null

      const result: ScrapedInfluencerProfile = {
        handle,
        platform: "instagram",
        full_name: ogTitle ?? null,
        bio: ogDesc ?? null,
        follower_count,
        post_count: null,
        avatar_url: ogImage ?? null,
        profile_url: profileUrl,
        raw: { og_title: ogTitle, og_description: ogDesc, og_image: ogImage },
        scrape_success: true,
        scrape_error: null,
      }
      return result
    }
  } catch (err) {
    return makePartial(
      "instagram",
      handle,
      profileUrl,
      partial,
      err instanceof Error ? err.message : "HTML fetch failed",
    )
  }

  return makePartial("instagram", handle, profileUrl, partial, "All Instagram scraping approaches failed")
}

// ─── TikTok ───────────────────────────────────────────────────────────────────

async function scrapeTikTok(handle: string): Promise<ScrapedInfluencerProfile> {
  const profileUrl = `https://www.tiktok.com/@${handle}`
  const partial: Partial<ScrapedInfluencerProfile> = { profile_url: profileUrl }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    let res: Response
    try {
      res = await fetch(profileUrl, {
        headers: { "User-Agent": DEFAULT_UA },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }

    if (!res.ok) {
      return makePartial("tiktok", handle, profileUrl, partial, `HTTP ${res.status}`)
    }

    const html = await res.text()

    // Extract __UNIVERSAL_DATA__ JSON blob
    const scriptMatch = html.match(/<script[^>]+id="__UNIVERSAL_DATA__"[^>]*>([\s\S]*?)<\/script>/i)
    if (scriptMatch?.[1]) {
      const json = JSON.parse(scriptMatch[1]) as Record<string, unknown>
      const defaultScope = json?.["__DEFAULT_SCOPE__"] as Record<string, unknown> | undefined
      const userDetail = defaultScope?.["webapp.user-detail"] as Record<string, unknown> | undefined
      const userInfo = userDetail?.userInfo as Record<string, unknown> | undefined
      const user = userInfo?.user as Record<string, unknown> | undefined
      const stats = userInfo?.stats as Record<string, unknown> | undefined

      if (user) {
        return {
          handle,
          platform: "tiktok",
          full_name: typeof user.nickname === "string" ? user.nickname : null,
          bio: typeof user.signature === "string" ? user.signature : null,
          follower_count: typeof stats?.followerCount === "number" ? stats.followerCount : null,
          post_count: typeof stats?.videoCount === "number" ? stats.videoCount : null,
          avatar_url: typeof user.avatarThumb === "string" ? user.avatarThumb : null,
          profile_url: profileUrl,
          raw: json,
          scrape_success: true,
          scrape_error: null,
        }
      }
    }

    return makePartial("tiktok", handle, profileUrl, partial, "Could not parse __UNIVERSAL_DATA__ JSON")
  } catch (err) {
    return makePartial(
      "tiktok",
      handle,
      profileUrl,
      partial,
      err instanceof Error ? err.message : "TikTok fetch failed",
    )
  }
}

// ─── YouTube ──────────────────────────────────────────────────────────────────

async function scrapeYouTube(handle: string): Promise<ScrapedInfluencerProfile> {
  const profileUrl = `https://www.youtube.com/@${handle}`
  const partial: Partial<ScrapedInfluencerProfile> = { profile_url: profileUrl }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    let res: Response
    try {
      res = await fetch(profileUrl, {
        headers: { "User-Agent": DEFAULT_UA },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }

    if (!res.ok) {
      return makePartial("youtube", handle, profileUrl, partial, `HTTP ${res.status}`)
    }

    const html = await res.text()

    const ogTitle = extractMetaContent(html, "og:title")
    const ogDesc = extractMetaContent(html, "og:description")
    const ogImage = extractMetaContent(html, "og:image")
    const follower_count = parseFollowerCount(html)

    return {
      handle,
      platform: "youtube",
      full_name: ogTitle ?? null,
      bio: ogDesc ?? null,
      follower_count,
      post_count: null,
      avatar_url: ogImage ?? null,
      profile_url: profileUrl,
      raw: { og_title: ogTitle, og_description: ogDesc, og_image: ogImage },
      scrape_success: true,
      scrape_error: null,
    }
  } catch (err) {
    return makePartial(
      "youtube",
      handle,
      profileUrl,
      partial,
      err instanceof Error ? err.message : "YouTube fetch failed",
    )
  }
}

// ─── LinkedIn ─────────────────────────────────────────────────────────────────

// LinkedIn profile pages require a logged-in session to render real content,
// so this can only ever read the public og:meta tags served to logged-out
// requests (same technique as the Instagram/YouTube fallback above) — it
// will fail more often than the other platforms' scrapers, and that's
// reported honestly via scrape_success/scrape_error rather than guessed at.
// This is read-only profile info, never an automated connection/message.
async function scrapeLinkedIn(handle: string): Promise<ScrapedInfluencerProfile> {
  const profileUrl = `https://www.linkedin.com/in/${handle}/`
  const partial: Partial<ScrapedInfluencerProfile> = { profile_url: profileUrl }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    let res: Response
    try {
      res = await fetch(profileUrl, {
        headers: { "User-Agent": DEFAULT_UA },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }

    if (!res.ok) {
      return makePartial("linkedin", handle, profileUrl, partial, `HTTP ${res.status}`)
    }

    const html = await res.text()
    const ogTitle = extractMetaContent(html, "og:title")
    const ogDesc = extractMetaContent(html, "og:description")
    const ogImage = extractMetaContent(html, "og:image")

    if (!ogTitle && !ogDesc) {
      return makePartial("linkedin", handle, profileUrl, partial, "LinkedIn requires a login to view this profile's details")
    }

    return {
      handle,
      platform: "linkedin",
      full_name: ogTitle ?? null,
      bio: ogDesc ?? null,
      follower_count: null,
      post_count: null,
      avatar_url: ogImage ?? null,
      profile_url: profileUrl,
      raw: { og_title: ogTitle, og_description: ogDesc, og_image: ogImage },
      scrape_success: true,
      scrape_error: null,
    }
  } catch (err) {
    return makePartial(
      "linkedin",
      handle,
      profileUrl,
      partial,
      err instanceof Error ? err.message : "LinkedIn fetch failed",
    )
  }
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function scrapeInfluencerProfile(
  platform: "instagram" | "tiktok" | "youtube" | "linkedin",
  handle: string,
): Promise<ScrapedInfluencerProfile> {
  switch (platform) {
    case "instagram":
      return scrapeInstagram(handle)
    case "tiktok":
      return scrapeTikTok(handle)
    case "youtube":
      return scrapeYouTube(handle)
    case "linkedin":
      return scrapeLinkedIn(handle)
  }
}
