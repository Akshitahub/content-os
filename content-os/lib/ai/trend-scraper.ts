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
  default: ["india", "IndianDietitian"],
}

function getNicheSubreddits(niche: string): string[] {
  const lower = niche.toLowerCase()
  for (const [key, subs] of Object.entries(NICHE_SUBREDDITS)) {
    if (lower.includes(key)) return subs
  }
  return NICHE_SUBREDDITS.default
}

async function scrapeTrendingHashtags(
  niche: string,
  platform: "instagram" | "tiktok"
): Promise<{
  hashtags: string[]
  estimated_reach: string[]
  scraped_at: string
  success: boolean
}> {
  const scraped_at = new Date().toISOString()
  try {
    const tag = encodeURIComponent(niche.replace(/\s+/g, ""))
    const url =
      platform === "instagram"
        ? `https://www.instagram.com/explore/tags/${tag}/`
        : `https://www.tiktok.com/tag/${tag}`

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
    })

    if (!response.ok) {
      return { hashtags: [], estimated_reach: [], scraped_at, success: false }
    }

    const html = await response.text()

    // Extract og:title meta content for hashtag info
    const hashtags: string[] = []
    const estimated_reach: string[] = []

    const ogTitleMatch = html.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
    )
    if (!ogTitleMatch) {
      // Try alternate attribute order
      const altMatch = html.match(
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i
      )
      if (altMatch && altMatch[1]) {
        hashtags.push(`#${niche.replace(/\s+/g, "")}`)
        estimated_reach.push(altMatch[1])
      }
    } else if (ogTitleMatch[1]) {
      hashtags.push(`#${niche.replace(/\s+/g, "")}`)
      estimated_reach.push(ogTitleMatch[1])
    }

    return { hashtags, estimated_reach, scraped_at, success: hashtags.length > 0 }
  } catch {
    return { hashtags: [], estimated_reach: [], scraped_at, success: false }
  }
}

async function scrapeGoogleTrends(
  niche: string,
  geo?: string
): Promise<{
  trending_topics: string[]
  scraped_at: string
  success: boolean
}> {
  const scraped_at = new Date().toISOString()
  try {
    const response = await fetch(
      `https://trends.google.com/trends/trendingsearches/daily/rss?geo=${geo ?? "IN"}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "application/rss+xml, application/xml, text/xml",
        },
      }
    )

    if (!response.ok) {
      return { trending_topics: [], scraped_at, success: false }
    }

    const xml = await response.text()

    // Extract <title> tags inside <item> elements via string matching
    const itemsSection = xml.split("<item>").slice(1) // skip feed header block
    const trending_topics: string[] = []

    for (const item of itemsSection) {
      if (trending_topics.length >= 10) break
      const titleMatch = item.match(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/)
      if (titleMatch && titleMatch[1]) {
        trending_topics.push(titleMatch[1].trim())
      } else {
        const plainMatch = item.match(/<title>([^<]+)<\/title>/)
        if (plainMatch && plainMatch[1]) {
          trending_topics.push(plainMatch[1].trim())
        }
      }
    }

    // niche is accepted for potential future filtering; currently unused but kept for API consistency
    void niche

    return {
      trending_topics: trending_topics.slice(0, 10),
      scraped_at,
      success: trending_topics.length > 0,
    }
  } catch {
    return { trending_topics: [], scraped_at, success: false }
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

    const response = await fetch(
      `https://www.reddit.com/r/${subreddit}/top.json?t=week&limit=10`,
      {
        headers: {
          "User-Agent": "ContentOS/1.0 (brand content tool)",
        },
      }
    )

    if (!response.ok) {
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

    return {
      top_topics,
      top_questions,
      scraped_at,
      success: top_topics.length > 0,
    }
  } catch {
    return { top_topics: [], top_questions: [], scraped_at, success: false }
  }
}

export async function getTrendingContext(brand: BrandRow): Promise<TrendingContext> {
  const niche = brand.niche ?? brand.target_audience ?? "general"

  const [instagramResult, googleResult, redditResult] = await Promise.allSettled([
    scrapeTrendingHashtags(niche, "instagram"),
    scrapeGoogleTrends(niche),
    getRedditInsights(niche),
  ])

  const instagram =
    instagramResult.status === "fulfilled"
      ? instagramResult.value
      : { hashtags: [], estimated_reach: [], scraped_at: new Date().toISOString(), success: false }

  const google =
    googleResult.status === "fulfilled"
      ? googleResult.value
      : { trending_topics: [], scraped_at: new Date().toISOString(), success: false }

  const reddit =
    redditResult.status === "fulfilled"
      ? redditResult.value
      : { top_topics: [], top_questions: [], scraped_at: new Date().toISOString(), success: false }

  const sources_successful = [instagram.success, google.success, reddit.success].filter(
    Boolean
  ).length

  return {
    trending_hashtags: instagram.hashtags,
    trending_topics: google.trending_topics,
    audience_questions: reddit.top_questions,
    scraped_at: new Date().toISOString(),
    sources_successful,
  }
}
