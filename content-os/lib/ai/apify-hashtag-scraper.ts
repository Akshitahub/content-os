// Actor id in Apify's REST API path format -- their store URL uses a slash
// (apify.com/apidojo/instagram-hashtag-scraper) but the API path requires
// the owner/name separated by "~" instead.
const ACTOR_ID = "apidojo~instagram-hashtag-scraper"
const BASE_URL = "https://api.apify.com/v2"

// This actor's own run can take anywhere from seconds to a couple minutes
// depending on hashtag activity -- capped here so a slow/stuck run can't
// eat the whole route's maxDuration budget on its own, leaving nothing for
// the per-candidate scraping+scoring loop that runs afterward (see
// autoDiscoverAndScoreInfluencers in influencer-discovery.ts). Never
// confirmed against a live run yet (see the Phase 1 evaluation) -- this is
// a conservative starting point, not a measured number, and may need
// tuning once real usage shows actual durations.
const REQUEST_TIMEOUT_MS = 90_000

export interface HashtagPostOwner {
  username: string
  fullName: string | null
  profilePicUrl: string | null
  isVerified: boolean
}

/**
 * apidojo/instagram-hashtag-scraper's exact response shape hasn't been
 * confirmed against a live token yet (evaluated during Phase 1 via docs
 * only, no account created without the user's go-ahead) -- parses
 * defensively across the plausible shapes documented for this actor
 * (a nested `owner` object is what the docs show, but a flatter shape is
 * tried too), and logs clearly rather than silently returning nothing
 * useful if none match, so a real mismatch is visible in logs the first
 * time this actually runs instead of quietly looking like "no posts
 * found."
 */
function extractOwner(item: unknown): HashtagPostOwner | null {
  if (!item || typeof item !== "object") return null
  const obj = item as Record<string, unknown>

  const ownerObj = (obj.owner && typeof obj.owner === "object" ? obj.owner : obj) as Record<string, unknown>

  const username = ownerObj.username ?? ownerObj.ownerUsername ?? obj.ownerUsername
  if (typeof username !== "string" || !username.trim()) return null

  const fullName = ownerObj.fullName ?? ownerObj.full_name ?? obj.ownerFullName ?? null
  const profilePicUrl = ownerObj.profilePicUrl ?? ownerObj.profile_pic_url ?? obj.ownerProfilePicUrl ?? null
  const isVerified = ownerObj.isVerified ?? ownerObj.is_verified ?? false

  return {
    username: username.trim(),
    fullName: typeof fullName === "string" ? fullName : null,
    profilePicUrl: typeof profilePicUrl === "string" ? profilePicUrl : null,
    isVerified: isVerified === true,
  }
}

/**
 * Real, currently-active Instagram accounts posting under the given
 * hashtags right now -- replaces lib/ai/influencer-discovery.ts's old
 * approach of asking an LLM to invent plausible handles from training
 * memory. Never throws (matches the convention already established for
 * lib/occasions/tathaastu-client.ts): a missing token, network failure,
 * non-200, or unrecognized response shape all log clearly and return [],
 * so a failed discovery call degrades to "no candidates this run" rather
 * than crashing the route or silently falling back to fabricated handles.
 *
 * Draws from *recent* posts under each hashtag, which is a real, moving
 * data source (unlike an LLM's fixed memory) -- running this again later
 * naturally surfaces newer posts/accounts, on top of the existingHandles
 * exclusion already applied by the caller.
 */
export async function fetchHashtagPostOwners(hashtags: string[], maxItems: number): Promise<HashtagPostOwner[]> {
  const token = process.env.APIFY_API_TOKEN
  if (!token) {
    console.error("[apify-hashtag-scraper] APIFY_API_TOKEN is not configured")
    return []
  }
  if (hashtags.length === 0) return []

  const startUrls = hashtags.map((h) => `https://www.instagram.com/explore/tags/${encodeURIComponent(h)}/`)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(
      `${BASE_URL}/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startUrls,
          getPosts: true,
          getReels: true,
          maxItems,
        }),
        signal: controller.signal,
      }
    )
  } catch (err) {
    console.error("[apify-hashtag-scraper] request failed:", err instanceof Error ? err.message : err)
    return []
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    console.error(`[apify-hashtag-scraper] responded ${res.status}: ${await res.text().catch(() => "(no body)")}`)
    return []
  }

  let payload: unknown
  try {
    payload = await res.json()
  } catch (err) {
    console.error("[apify-hashtag-scraper] returned non-JSON:", err instanceof Error ? err.message : err)
    return []
  }

  if (!Array.isArray(payload)) {
    console.error("[apify-hashtag-scraper] response shape not recognized -- expected a dataset array, check the real Apify response and update this client:", JSON.stringify(payload).slice(0, 500))
    return []
  }

  const owners: HashtagPostOwner[] = []
  for (const item of payload) {
    const owner = extractOwner(item)
    if (owner) owners.push(owner)
  }
  return owners
}
