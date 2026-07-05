import { MODELS, getGroqClient } from "./models"
import { scrapeInfluencerProfile } from "./scraper"
import {
  buildInfluencerFitScoringSystemPrompt,
  buildInfluencerFitScoringUserPrompt,
} from "./prompts"
import type { BrandRow, InfluencerRow } from "@/types/database"
import type { SupabaseClient } from "@supabase/supabase-js"

function sanitizeJsonString(raw: string): string {
  return raw
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function discoverInfluencersByNiche(
  niche: string,
  platform: "instagram" | "tiktok" | "youtube",
  count: number = 25,
): Promise<string[]> {
  const groq = getGroqClient()
  const res = await groq.chat.completions.create({
    model: MODELS.extraction,
    temperature: 0.7,
    max_tokens: 1500,
    messages: [
      {
        role: "system",
        content: "You are an influencer marketing expert specializing in Indian D2C brands. Respond with valid JSON only. No markdown.",
      },
      {
        role: "user",
        content: `For the niche "${niche}" on ${platform}, suggest ${count} handles of MICRO-INFLUENCERS (10,000 to 200,000 followers) who are:
- Based in India
- Actively posting about ${niche}
- NOT celebrities (no Bollywood actors, no cricket players, no major TV personalities)
- Real content creators who work with small D2C brands
- Handles that are realistic and likely to actually exist

Focus on niches like: food bloggers, lifestyle creators, regional language creators, small business owners who post content, niche hobby creators.

Return ONLY a JSON array of handle strings (without @): ["handle1", "handle2", ...]
Make the handles realistic and specific, not generic.`,
      },
    ],
  })

  const raw = res.choices[0]?.message?.content ?? "[]"
  let cleaned = sanitizeJsonString(raw)
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/)
  if (arrayMatch) cleaned = arrayMatch[0]
  try {
    const parsed = JSON.parse(cleaned) as unknown
    if (Array.isArray(parsed)) {
      return parsed.filter((h): h is string => typeof h === "string").slice(0, count)
    }
  } catch {
    console.error("[influencer-discovery] handle list parse failed:", cleaned.slice(0, 300))
  }
  return []
}

export async function autoDiscoverAndScoreInfluencers(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  brand: BrandRow,
  brandId: string,
  platform: "instagram" | "tiktok" | "youtube",
  count: number = 25,
): Promise<InfluencerRow[]> {
  const groq = getGroqClient()
  const handles = await discoverInfluencersByNiche(brand.niche ?? "general", platform, count)
  if (handles.length === 0) return []

  const batchSize = 3
  const inserted: InfluencerRow[] = []

  for (let i = 0; i < handles.length; i += batchSize) {
    if (i > 0) await sleep(500)
    const batch = handles.slice(i, i + batchSize)

    const results = await Promise.allSettled(
      batch.map(async (handle): Promise<InfluencerRow | null> => {
        const scraped = await scrapeInfluencerProfile(platform, handle)

        // Skip accounts that are too big (celebrity) or too small (spam/unused)
        if (scraped.follower_count !== null) {
          if (scraped.follower_count > 1_000_000) {
            console.log(`[influencer-discovery] Skipping @${handle}: ${scraped.follower_count} followers (too large — likely celebrity)`)
            return null
          }
          if (scraped.follower_count < 1_000) {
            console.log(`[influencer-discovery] Skipping @${handle}: ${scraped.follower_count} followers (too small)`)
            return null
          }
        }

        let fit_score: number | null = null
        let fit_reasoning: string | null = null
        let niche: string | null = null

        try {
          const scoreRes = await groq.chat.completions.create({
            model: MODELS.scoring,
            temperature: 0.3,
            max_tokens: 400,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: buildInfluencerFitScoringSystemPrompt() },
              {
                role: "user",
                content: buildInfluencerFitScoringUserPrompt(brand, {
                  handle: scraped.handle,
                  platform: scraped.platform,
                  full_name: scraped.full_name,
                  bio: scraped.bio,
                  follower_count: scraped.follower_count,
                  post_count: scraped.post_count,
                  niche: null,
                }),
              },
            ],
          })
          let scoreCleaned = sanitizeJsonString(scoreRes.choices[0]?.message?.content ?? "{}")
          const scoreJsonMatch = scoreCleaned.match(/\{[\s\S]*\}/)
          if (scoreJsonMatch) scoreCleaned = scoreJsonMatch[0]
          const scoreParsed = JSON.parse(scoreCleaned) as {
            score?: number
            fit_score?: number
            reasoning?: string
            fit_reasoning?: string
            why_it_works?: string
          }
          fit_score = scoreParsed.score ?? scoreParsed.fit_score ?? null
          fit_reasoning = scoreParsed.why_it_works ?? scoreParsed.reasoning ?? scoreParsed.fit_reasoning ?? null
        } catch {
          // non-fatal: insert without score
        }

        if (scraped.bio) {
          try {
            const nicheRes = await groq.chat.completions.create({
              model: MODELS.extraction,
              temperature: 0.1,
              max_tokens: 10,
              messages: [
                {
                  role: "user",
                  content: `Based on this bio: "${scraped.bio.slice(0, 200)}", what single niche word best describes this creator? Return only one lowercase word.`,
                },
              ],
            })
            const word = nicheRes.choices[0]?.message?.content?.trim().split(/\s+/)[0]?.toLowerCase()
            niche = word ?? null
          } catch {
            // non-fatal
          }
        }

        const raw_scraped_data: Record<string, unknown> = {
          ...scraped.raw,
          scrape_success: scraped.scrape_success,
          ...(scraped.scrape_error ? { scrape_error: scraped.scrape_error } : {}),
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase.from("influencers") as any)
          .insert({
            brand_id: brandId,
            platform: scraped.platform,
            handle: scraped.handle,
            full_name: scraped.full_name,
            bio: scraped.bio,
            follower_count: scraped.follower_count,
            post_count: scraped.post_count,
            avatar_url: scraped.avatar_url,
            profile_url: scraped.profile_url,
            fit_score,
            fit_reasoning,
            niche,
            raw_scraped_data,
            status: "discovered",
          })
          .select()
          .single() as { data: InfluencerRow | null; error: { message: string } | null }

        if (error) throw new Error(`Insert failed for @${handle}: ${error.message}`)
        return data
      }),
    )

    for (const result of results) {
      if (result.status === "fulfilled" && result.value !== null) {
        inserted.push(result.value)
      } else if (result.status === "rejected") {
        console.error("[influencer-discovery] slot error:", result.reason)
      }
    }
  }

  return inserted.sort((a, b) => (b.fit_score ?? 0) - (a.fit_score ?? 0))
}
