import { interpretGraphError, type GraphErrorBody } from "./graph-api-errors"

const GRAPH_VERSION = "v21.0"
const MEDIA_LIMIT = 25

export interface BusinessDiscoveryMedia {
  caption: string | null
  like_count: number
  comments_count: number
  timestamp: string
  media_type: string
  permalink: string
}

export interface BusinessDiscoveryData {
  username: string
  followers_count: number
  media_count: number
  biography: string | null
  website: string | null
  media: BusinessDiscoveryMedia[]
}

export type CompetitorSnapshotResult =
  | { success: true; data: BusinessDiscoveryData }
  | { success: false; error: string }

type RawMedia = {
  caption?: string
  like_count?: number
  comments_count?: number
  timestamp?: string
  media_type?: string
  permalink?: string
}

/**
 * Looks up PUBLIC profile + recent media stats for any Instagram
 * Business/Creator account (competitor or your own) via the Graph API's
 * Business Discovery field — this is not scraping, requires no special
 * permission from the target account, and works using the CALLING
 * account's own access token. Never throws — all failure modes return
 * { success: false, error }.
 */
export async function getCompetitorSnapshot(
  yourIgBusinessAccountId: string,
  accessToken: string,
  competitorHandle: string
): Promise<CompetitorSnapshotResult> {
  const handle = competitorHandle.replace(/^@/, "").trim()
  if (!handle) {
    return { success: false, error: "Instagram handle is required." }
  }

  try {
    const fields =
      `business_discovery.username(${handle})` +
      `{followers_count,media_count,biography,website,username,` +
      `media.limit(${MEDIA_LIMIT}){caption,like_count,comments_count,timestamp,media_type,permalink}}`

    const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${yourIgBusinessAccountId}`)
    url.searchParams.set("fields", fields)
    url.searchParams.set("access_token", accessToken)

    const res = await fetch(url.toString())
    const json = await res.json()

    if (!res.ok || !json.business_discovery) {
      const interpreted = interpretGraphError(json as GraphErrorBody)
      console.error(`[instagram-business-discovery] lookup failed for @${handle}:`, interpreted.message)

      if (interpreted.kind === "invalid_token" || interpreted.kind === "permission_error") {
        return { success: false, error: "Your Instagram connection doesn't have permission for competitor lookups. Reconnect the account." }
      }
      if (interpreted.kind === "rate_limit") {
        return { success: false, error: "Instagram rate limit reached — try again shortly." }
      }
      // Most common real-world case: handle doesn't exist, is private, or
      // isn't a Business/Creator account (Business Discovery requires one).
      return { success: false, error: `Couldn't find @${handle} as a public Instagram Business/Creator account.` }
    }

    const bd = json.business_discovery
    const rawMedia = (bd.media?.data ?? []) as RawMedia[]

    return {
      success: true,
      data: {
        username: bd.username ?? handle,
        followers_count: typeof bd.followers_count === "number" ? bd.followers_count : 0,
        media_count: typeof bd.media_count === "number" ? bd.media_count : 0,
        biography: bd.biography ?? null,
        website: bd.website ?? null,
        media: rawMedia
          .filter((m) => typeof m.timestamp === "string")
          .map((m) => ({
            caption: m.caption ?? null,
            like_count: typeof m.like_count === "number" ? m.like_count : 0,
            comments_count: typeof m.comments_count === "number" ? m.comments_count : 0,
            timestamp: m.timestamp!,
            media_type: m.media_type ?? "UNKNOWN",
            permalink: m.permalink ?? "",
          })),
      },
    }
  } catch (err) {
    console.error("[instagram-business-discovery] unexpected error:", err instanceof Error ? err.message : err)
    return { success: false, error: "Unexpected error looking up the Instagram account." }
  }
}
