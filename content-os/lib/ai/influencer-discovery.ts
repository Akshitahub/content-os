import { MODELS, getGroqClient } from "./models"
import { scrapeInfluencerProfile } from "./scraper"
import {
  buildInfluencerFitScoringSystemPrompt,
  buildInfluencerFitScoringUserPrompt,
  buildProspectFitScoringSystemPrompt,
  buildProspectFitScoringUserPrompt,
} from "./prompts"
import type { BrandRow, InfluencerRow } from "@/types/database"
import type { SupabaseClient } from "@supabase/supabase-js"

export type DiscoveryType = "influencer_partner" | "prospect_customer"

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

// Parallel to buildDiscoveryPrompt below, but asks for actual small D2C
// brand/business accounts (SocioPosts customer prospects) instead of
// content creators — a founder posting for their own brand from a business
// handle, not someone with an influencer persona.
function buildProspectDiscoveryPrompt(niche: string, platform: "instagram" | "tiktok" | "youtube" | "linkedin", count: number): string {
  return `For the niche "${niche}" on ${platform}, suggest ${count} real handles of SMALL D2C BRAND ACCOUNTS — not influencers or content creators — who are:
- Based in India
- Founder-run or small-team-run brand/business accounts selling products in the ${niche} space
- Actual brand accounts (shop, studio, label, or brand name), NOT a personal/lifestyle influencer or content-creator account built around one person's persona
- A small, early-stage business — roughly 2,000 to 20,000 followers
- Likely posting fairly manually and inconsistently, not backed by a large marketing team or agency
- Handles that are realistic and likely to actually exist

Return ONLY a JSON array of handle strings (without @): ["handle1", "handle2", ...]
Make the handles realistic and specific, not generic.`
}

// LinkedIn creators don't fit the same "10K-200K follower micro-influencer"
// framing as Instagram/TikTok/YouTube — a LinkedIn creator with even a few
// thousand followers can be a legitimate, high-intent thought leader for a
// B2B-adjacent D2C brand, and the celebrity-exclusion rules for the other
// platforms don't really apply either. This gets its own prompt rather than
// being forced through the generic one.
function buildDiscoveryPrompt(
  niche: string,
  platform: "instagram" | "tiktok" | "youtube" | "linkedin",
  count: number,
  discoveryType: DiscoveryType = "influencer_partner",
): string {
  if (discoveryType === "prospect_customer") {
    return buildProspectDiscoveryPrompt(niche, platform, count)
  }

  if (platform === "linkedin") {
    return `For the niche "${niche}", suggest ${count} LinkedIn handles of professional creators/thought leaders who are:
- Based in India
- Actively posting professional, thought-leadership content related to ${niche}
- Real working professionals, founders, or industry voices — not celebrities
- Likely to have an engaged, higher-intent (not just large) audience — follower count on LinkedIn varies widely and a smaller, senior audience can matter more than raw reach
- Handles that are realistic and likely to actually exist

Return ONLY a JSON array of handle strings (without @): ["handle1", "handle2", ...]
Make the handles realistic and specific, not generic.`
  }

  return `For the niche "${niche}" on ${platform}, suggest ${count} handles of MICRO-INFLUENCERS (10,000 to 200,000 followers) who are:
- Based in India
- Actively posting about ${niche}
- NOT celebrities (no Bollywood actors, no cricket players, no major TV personalities)
- Real content creators who work with small D2C brands
- Handles that are realistic and likely to actually exist

Focus on niches like: food bloggers, lifestyle creators, regional language creators, small business owners who post content, niche hobby creators.

Return ONLY a JSON array of handle strings (without @): ["handle1", "handle2", ...]
Make the handles realistic and specific, not generic.`
}

export async function discoverInfluencersByNiche(
  niche: string,
  platform: "instagram" | "tiktok" | "youtube" | "linkedin",
  count: number = 25,
  discoveryType: DiscoveryType = "influencer_partner",
): Promise<string[]> {
  const groq = getGroqClient()
  const res = await groq.chat.completions.create({
    model: MODELS.extraction,
    temperature: 0.7,
    max_tokens: 1500,
    // Handle brainstorming doesn't need deep reasoning — low effort is
    // faster/cheaper on GPT-OSS models.
    reasoning_effort: "low",
    messages: [
      {
        role: "system",
        content: discoveryType === "prospect_customer"
          ? "You are an expert at identifying small D2C brand accounts on social media. Respond with valid JSON only. No markdown."
          : "You are an influencer marketing expert specializing in Indian D2C brands. Respond with valid JSON only. No markdown.",
      },
      {
        role: "user",
        content: buildDiscoveryPrompt(niche, platform, count, discoveryType),
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
  platform: "instagram" | "tiktok" | "youtube" | "linkedin",
  count: number = 25,
  discoveryType: DiscoveryType = "influencer_partner",
): Promise<InfluencerRow[]> {
  const groq = getGroqClient()

  let discovered: string[]
  try {
    discovered = await discoverInfluencersByNiche(brand.niche ?? "general", platform, count, discoveryType)
  } catch (err) {
    console.error("[influencer-discovery] handle generation failed:", err)
    throw err
  }
  if (discovered.length === 0) return []

  // Skip handles already discovered for this brand+platform+discoveryType —
  // no point re-scraping and re-scoring someone already in the influencers
  // table, and influencer-partner vs. prospect-customer runs shouldn't
  // suppress each other since they're scoring completely different things.
  const { data: existingRows } = await supabase
    .from("influencers")
    .select("handle")
    .eq("brand_id", brandId)
    .eq("platform", platform)
    .eq("discovery_type", discoveryType)
    .returns<{ handle: string }[]>()
  const existingHandles = new Set((existingRows ?? []).map((r: { handle: string }) => r.handle.toLowerCase()))

  const handles = discovered.filter((h) => !existingHandles.has(h.toLowerCase()))
  if (handles.length === 0) return []

  const batchSize = 3
  const inserted: InfluencerRow[] = []

  for (let i = 0; i < handles.length; i += batchSize) {
    if (i > 0) await sleep(500)
    const batch = handles.slice(i, i + batchSize)

    const results = await Promise.allSettled(
      batch.map(async (handle): Promise<InfluencerRow | null> => {
        const scraped = await scrapeInfluencerProfile(platform, handle)

        // Skip handles that don't actually exist / couldn't be scraped —
        // no point spending a scoring call on a profile we have no real
        // data for.
        if (!scraped.scrape_success) {
          console.log(`[influencer-discovery] Skipping @${handle}: scrape failed (${scraped.scrape_error ?? "unknown error"})`)
          return null
        }

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

        // Scoring and niche extraction are fully independent Groq calls —
        // run them concurrently instead of back to back. Each keeps its own
        // non-fatal try/catch exactly as before, just wrapped so Promise.all
        // can run them side by side.
        const [{ fit_score, fit_reasoning }, niche] = await Promise.all([
          (async (): Promise<{ fit_score: number | null; fit_reasoning: string | null }> => {
            try {
              const scoreRes = await groq.chat.completions.create({
                model: MODELS.scoring,
                temperature: 0.3,
                max_tokens: 400,
                // Fit-scoring is a judgment call that benefits from more
                // reasoning than the handle-brainstorming step above.
                reasoning_effort: "medium",
                response_format: { type: "json_object" },
                messages: [
                  {
                    role: "system",
                    content: discoveryType === "prospect_customer"
                      ? buildProspectFitScoringSystemPrompt()
                      : buildInfluencerFitScoringSystemPrompt(),
                  },
                  {
                    role: "user",
                    content: (discoveryType === "prospect_customer" ? buildProspectFitScoringUserPrompt : buildInfluencerFitScoringUserPrompt)(brand, {
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
              return {
                fit_score: scoreParsed.score ?? scoreParsed.fit_score ?? null,
                fit_reasoning: scoreParsed.why_it_works ?? scoreParsed.reasoning ?? scoreParsed.fit_reasoning ?? null,
              }
            } catch {
              // non-fatal: insert without score
              return { fit_score: null, fit_reasoning: null }
            }
          })(),
          (async (): Promise<string | null> => {
            if (!scraped.bio) return null
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
              return word ?? null
            } catch {
              // non-fatal
              return null
            }
          })(),
        ])

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
            discovery_type: discoveryType,
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
