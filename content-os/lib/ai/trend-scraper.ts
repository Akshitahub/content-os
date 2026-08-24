import type { BrandRow } from "@/types/database"
import type { TrendingContext } from "@/types/app"

// Niche → subreddit mapping
const NICHE_SUBREDDITS: Record<string, string[]> = {
  skincare: ["SkincareAddiction", "IndianSkincareAddicts"],
  beauty: ["MakeupAddiction", "IndianMakeupAddicts"],
  fashion: ["femalefashionadvice", "IndianFashionAddicts"],
  fitness: ["xxfitness", "IndiaFitness"],
  food: ["IndianFood", "EatCheapAndHealthy"],
  jewellery: ["jewelrymaking", "jewelry"],
  jewelry: ["jewelrymaking", "jewelry"],
  wellness: ["wellness", "Ayurveda"],
  yoga: ["yoga", "meditation"],
  pet: ["dogs", "cats", "IndianPets"],
  home: ["HomeImprovement", "IndianHomes"],
  baby: ["beyondthebump", "IndianParents"],
  gifts: ["gifts", "GiftIdeas"],
  candles: ["candlemaking", "candles"],
  crafts: ["crafts", "somethingimade"],
  handmade: ["handmade", "crafts"],
  sustainable: ["ZeroWaste", "sustainability"],
  eco: ["ZeroWaste", "sustainability"],
  cafe: ["Coffee", "cafe"],
  default: ["india", "IndianDietitian"],
}

function getNicheSubreddits(niche: string): string[] {
  const lower = niche.toLowerCase()
  for (const [key, subs] of Object.entries(NICHE_SUBREDDITS)) {
    if (lower.includes(key)) return subs
  }
  console.warn(`[trend-scraper] No subreddit mapping for niche "${niche}", falling back to default.`)
  return NICHE_SUBREDDITS.default
}

// www.reddit.com/r/{sub}/top.json (unauthenticated) returns 403 as of
// Reddit's 2023 API policy changes -- confirmed directly against the live
// endpoint, not a hypothetical. Reddit's real OAuth API (oauth.reddit.com)
// still works via a free "script" app's client_credentials grant, which
// doesn't need a logged-in Reddit user, just REDDIT_CLIENT_ID/
// REDDIT_CLIENT_SECRET. Token cached in-memory (module-level, resets on
// cold start) until shortly before its ~1hr expiry, so a normal request
// volume doesn't fetch a fresh token every call.
let cachedToken: { accessToken: string; expiresAt: number } | null = null

async function getRedditAccessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken
  }

  const clientId = process.env.REDDIT_CLIENT_ID
  const clientSecret = process.env.REDDIT_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    console.error("[trend-scraper] REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET not configured.")
    return null
  }

  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64")
    const response = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "SocioPosts/1.0 (brand content tool)",
      },
      body: "grant_type=client_credentials",
    })

    if (!response.ok) {
      console.error(`[trend-scraper] Reddit access_token request failed with status ${response.status}.`)
      return null
    }

    const json = await response.json() as { access_token?: string; expires_in?: number }
    if (!json.access_token) {
      console.error("[trend-scraper] Reddit access_token response missing access_token.")
      return null
    }

    // Refresh 5 minutes early rather than exactly at expiry, so a token
    // that's about to lapse mid-request never gets reused.
    const expiresInMs = (json.expires_in ?? 3600) * 1000
    cachedToken = { accessToken: json.access_token, expiresAt: Date.now() + expiresInMs - 5 * 60 * 1000 }
    return cachedToken.accessToken
  } catch (err) {
    console.error("[trend-scraper] Reddit access_token request threw:", err instanceof Error ? err.message : err)
    return null
  }
}

async function getRedditInsights(niche: string): Promise<{
  top_topics: string[]
  top_questions: string[]
  scraped_at: string
  success: boolean
}> {
  const scraped_at = new Date().toISOString()
  try {
    const subreddits = getNicheSubreddits(niche)
    const subreddit = subreddits[0]

    const token = await getRedditAccessToken()
    if (!token) {
      return { top_topics: [], top_questions: [], scraped_at, success: false }
    }

    const response = await fetch(
      `https://oauth.reddit.com/r/${subreddit}/top?t=week&limit=10`,
      {
        headers: {
          "Authorization": `Bearer ${token}`,
          "User-Agent": "SocioPosts/1.0 (brand content tool)",
        },
      }
    )

    if (!response.ok) {
      console.error(`[trend-scraper] Reddit fetch for r/${subreddit} failed with status ${response.status}.`)
      return { top_topics: [], top_questions: [], scraped_at, success: false }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await response.json()) as any

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const titles: string[] = (json?.data?.children ?? []).map((child: any) => {
      return child?.data?.title ?? ""
    }).filter(Boolean)

    const top_topics = titles
    const top_questions = titles.filter((title) => {
      const lower = title.toLowerCase()
      return (
        title.includes("?") ||
        lower.startsWith("how") ||
        lower.startsWith("what") ||
        lower.startsWith("why") ||
        lower.startsWith("which")
      )
    })

    if (top_topics.length === 0) {
      console.warn(`[trend-scraper] r/${subreddit} returned zero posts for niche "${niche}".`)
    }

    return {
      top_topics,
      top_questions,
      scraped_at,
      success: top_topics.length > 0,
    }
  } catch (err) {
    console.error(`[trend-scraper] Reddit fetch threw for niche "${niche}":`, err instanceof Error ? err.message : err)
    return { top_topics: [], top_questions: [], scraped_at, success: false }
  }
}

export async function getTrendingContext(brand: BrandRow): Promise<TrendingContext> {
  const niche = brand.niche ?? brand.target_audience ?? "general"

  const reddit = await getRedditInsights(niche)

  // top_questions first — most actionable — then remaining top_topics, deduplicated, capped at 8.
  const combined = [...reddit.top_questions, ...reddit.top_topics]
  const topics = Array.from(new Set(combined)).slice(0, 8)

  return {
    topics,
    scraped_at: reddit.scraped_at,
    success: reddit.success,
  }
}
