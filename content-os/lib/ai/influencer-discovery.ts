import { MODELS, getGroqClient, withGroqRateLimitRetry } from "./models"
import { scrapeInfluencerProfile } from "./scraper"
import { fetchHashtagPostOwners } from "./apify-hashtag-scraper"
import { cacheRemoteImage } from "@/lib/storage/upload-media"
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

function slugifyForHashtag(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

/**
 * Deterministic hashtag selection, not LLM-guessed — unlike the old
 * handle-invention step this replaces, a bad/dead hashtag here just comes
 * back with zero or few real posts (visible, self-correcting via the
 * empty-results path below), not a fabricated account, so there's no need
 * for an LLM's judgment on which hashtags to try.
 *
 * The two discovery modes want genuinely different accounts under the
 * same niche — prospect_customer wants small D2C BRAND accounts (shop/
 * studio/label), influencer_partner wants content creators/influencers —
 * so they get different hashtag framings from the same niche string
 * rather than sharing one set and relying on downstream scoring alone to
 * tell them apart.
 */
function buildHashtags(niche: string, discoveryType: DiscoveryType): string[] {
  const slug = slugifyForHashtag(niche)
  if (!slug) {
    return discoveryType === "prospect_customer"
      ? ["shopsmall", "smallbusinessindia", "indianbrand"]
      : ["indiancreator", "contentcreatorindia"]
  }

  if (discoveryType === "prospect_customer") {
    return [slug, `${slug}india`, `${slug}brand`, "shopsmall"]
  }

  return [slug, `${slug}creator`, `${slug}influencer`, "indiancreator"]
}

/**
 * Real, currently-active Instagram accounts posting under real hashtags
 * for this niche — replaces the old approach of asking an LLM to "suggest
 * real handles" from training memory, which had no live directory to draw
 * from and confidently invented handles that either didn't exist or
 * belonged to someone unrelated. See lib/ai/apify-hashtag-scraper.ts.
 *
 * Instagram-only for now: the chosen scraping service (Apify's
 * apidojo/instagram-hashtag-scraper actor, evaluated and confirmed with
 * the user) only covers Instagram. Every real influencers row in this
 * app's own data is already Instagram (confirmed live, 358/358 rows) —
 * rather than leaving tiktok/youtube/linkedin on the same broken
 * LLM-invention mechanism this task exists to fix, those platforms
 * return no candidates until a real discovery source exists for them.
 */
export async function discoverInfluencersByNiche(
  niche: string,
  platform: "instagram" | "tiktok" | "youtube" | "linkedin",
  count: number = 25,
  discoveryType: DiscoveryType = "influencer_partner",
): Promise<string[]> {
  if (platform !== "instagram") {
    console.error(`[influencer-discovery] real discovery isn't available for ${platform} yet (Instagram-only) -- returning no candidates rather than falling back to LLM-invented handles`)
    return []
  }

  const hashtags = buildHashtags(niche || "", discoveryType)
  // Overfetch relative to `count`: many posts under a hashtag come from
  // the same handful of prolific/repeat posters, so the raw post volume
  // needed to surface `count` UNIQUE accounts is meaningfully higher than
  // count itself. 5x is a starting multiplier, not a measured ratio (see
  // the Phase 1 evaluation note on unconfirmed live behavior) — capped so
  // a large `count` request doesn't runaway the underlying actor's cost
  // or runtime.
  const maxItems = Math.min(count * 5, 400)

  const owners = await fetchHashtagPostOwners(hashtags, maxItems)

  const seen = new Set<string>()
  const handles: string[] = []
  for (const owner of owners) {
    const handle = owner.username.toLowerCase()
    if (seen.has(handle)) continue
    seen.add(handle)
    handles.push(owner.username)
    if (handles.length >= count) break
  }
  return handles
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

        // Scoring, niche extraction, and avatar re-hosting are fully
        // independent I/O — run them concurrently instead of back to back.
        // Avatar caching downloads the scraped avatar_url (Instagram/TikTok
        // CDN URLs are often signed/short-lived and can hotlink-block a
        // later direct browser load even when valid right now,
        // server-side) and re-hosts it in our own storage; each keeps its
        // own non-fatal failure handling, just wrapped so Promise.all can
        // run them side by side.
        const [{ fit_score, fit_reasoning }, niche, cachedAvatarUrl] = await Promise.all([
          (async (): Promise<{ fit_score: number | null; fit_reasoning: string | null }> => {
            try {
              // Wrapped in a single retry-on-429 — batches of 3+ concurrent
              // scoring calls regularly exceed the Groq account's
              // tokens-per-minute cap for this model (measured live: ~40%
              // of calls 429'd in a 20-handle run), and until now that
              // failure was swallowed into a permanently unscored insert
              // below rather than recovered.
              const scoreRes = await withGroqRateLimitRetry(() => groq.chat.completions.create({
                model: MODELS.scoring,
                temperature: 0.3,
                // GPT-OSS reasoning tokens count against max_tokens — 400
                // was tight enough that the model could burn the whole
                // budget on hidden reasoning and return empty/truncated
                // content, silently failing JSON parsing below.
                max_tokens: 1200,
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
              }))
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
                // A trivial one-word classification — no chain-of-thought
                // needed, so skip reasoning entirely rather than leaving it
                // unset (which silently defaults to "medium" on GPT-OSS and
                // was burning the whole 10-token budget on hidden reasoning
                // before ever writing the actual word).
                reasoning_effort: "none",
                max_tokens: 30,
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
          cacheRemoteImage(scraped.avatar_url, `${brandId}/influencer-avatars`),
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
            avatar_url: cachedAvatarUrl,
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
