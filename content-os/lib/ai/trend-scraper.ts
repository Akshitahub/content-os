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
