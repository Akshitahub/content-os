import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { scrapeInfluencerProfile } from "@/lib/ai/scraper"
import { cacheRemoteImage } from "@/lib/storage/upload-media"
import {
  buildInfluencerFitScoringSystemPrompt,
  buildInfluencerFitScoringUserPrompt,
  buildProspectFitScoringSystemPrompt,
  buildProspectFitScoringUserPrompt,
} from "@/lib/ai/prompts"
import { MODELS, getGroqClient, withGroqRateLimitRetry } from "@/lib/ai/models"
import { discoverInfluencerSchema } from "@/lib/validations/influencer"
import { buildError, ErrorCodes } from "@/types/api"
import { PLAN_LIMITS, type UserPlan } from "@/types/app"
import { isInternalUnlimited } from "@/lib/usage/is-internal-unlimited"
import type { BrandRow, InfluencerRow } from "@/types/database"

type RouteParams = { params: Promise<{ brandId: string }> }

async function getAuthorizedBrand(brandId: string) {
  let supabase
  try { supabase = await createClient() } catch (err) {
    console.error("[influencers/discover] createClient failed:", err)
    return { error: "server_error" as const, supabase: null, user: null, brand: null }
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: "unauthenticated" as const, supabase, user: null, brand: null }
  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return { error: "not_found" as const, supabase, user, brand: null }
  return { error: null, supabase, user, brand }
}

export async function POST(request: Request, { params }: RouteParams) {
  const { brandId } = await params
  console.log("[influencers/discover] POST called")

  const result = await getAuthorizedBrand(brandId)
  if (result.error === "server_error") return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  if (result.error === "unauthenticated") return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  if (result.error === "not_found") return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  const { data: userData } = await result.supabase!.from("users").select("plan").eq("id", result.user!.id).single<{ plan: UserPlan }>()
  const userPlan: UserPlan = userData?.plan ?? "free"
  if (!PLAN_LIMITS[userPlan].influencerOutreach && !isInternalUnlimited(result.user!.id)) {
    return NextResponse.json(
      buildError(ErrorCodes.USAGE_LIMIT_EXCEEDED, "Influencer outreach tools are available on Pro and Agency plans. Upgrade to use this feature."),
      { status: 403 }
    )
  }

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = discoverInfluencerSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })

  const { handle, platform, discoveryType } = parsed.data
  const brand = result.brand!

  // Step 1: Scrape influencer profile
  let scraped = await scrapeInfluencerProfile(platform, handle)

  // Instagram/TikTok's scraped avatar URLs are often signed/short-lived and
  // can hotlink-block direct browser loads even when valid moments earlier
  // server-side — re-host in our own storage now, while we still have a
  // working fetch to it, instead of storing the raw CDN URL. Kicked off
  // immediately and awaited later (right before the insert) so this
  // independent I/O overlaps with the AI scoring/niche steps below instead
  // of adding to the route's total latency.
  const avatarCachePromise = cacheRemoteImage(scraped.avatar_url, `${brandId}/influencer-avatars`)

  // Step 2 + 2b: score fit and extract niche from bio — two independent
  // Groq calls that both only depend on `scraped`, run concurrently instead
  // of back to back (previously ~2 sequential round-trips; niche extraction
  // is a cheap ~30-token call so running it alongside scoring adds
  // negligible token pressure).
  const [{ fit_score, fit_reasoning }, niche] = await Promise.all([
    (async (): Promise<{ fit_score: number | null; fit_reasoning: string | null }> => {
      try {
        const groq = getGroqClient()
        const systemPrompt = discoveryType === "prospect_customer"
          ? buildProspectFitScoringSystemPrompt()
          : buildInfluencerFitScoringSystemPrompt()
        const userPrompt = (discoveryType === "prospect_customer" ? buildProspectFitScoringUserPrompt : buildInfluencerFitScoringUserPrompt)(brand, {
          handle: scraped.handle,
          platform: scraped.platform,
          full_name: scraped.full_name,
          bio: scraped.bio,
          follower_count: scraped.follower_count,
          post_count: scraped.post_count,
          niche: null,
        })

        // Wrapped in a single retry-on-429 — this model's account-level
        // tokens-per-minute cap is regularly hit under real load (measured
        // live via lib/ai/influencer-discovery.ts's bulk path: ~40% of
        // scoring calls 429'd in a 20-handle burst), and until now that
        // failure was swallowed into a permanently unscored insert below
        // rather than recovered.
        const res = await withGroqRateLimitRetry(() => groq.chat.completions.create({
          model: MODELS.scoring,
          temperature: 0.3,
          // GPT-OSS reasoning tokens count against max_tokens — 800 was tight
          // enough that the model could burn the whole budget on hidden
          // reasoning and return empty/truncated content, silently failing
          // JSON parsing below. Fit-scoring is a judgment call that benefits
          // from more reasoning than list-brainstorming — matches the identical
          // scoring call in lib/ai/influencer-discovery.ts rather than relying
          // on Groq's undocumented default.
          reasoning_effort: "medium",
          max_tokens: 1200,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }))

        const aiContent = res.choices[0]?.message?.content ?? "{}"
        const aiCleaned = aiContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").replace(/[\x00-\x1F\x7F]/g, " ").trim()
        const aiParsed = JSON.parse(aiCleaned) as {
          score?: number
          reasoning?: string
          fit_score?: number
          fit_reasoning?: string
          why_it_works?: string
        }

        // Support both response shapes from the prompt
        return {
          fit_score: aiParsed.score ?? aiParsed.fit_score ?? null,
          fit_reasoning: aiParsed.why_it_works ?? aiParsed.reasoning ?? aiParsed.fit_reasoning ?? null,
        }
      } catch (err) {
        console.error("[influencers/discover] AI scoring failed:", err)
        // Non-fatal: we still insert the influencer without a score
        return { fit_score: null, fit_reasoning: null }
      }
    })(),
    (async (): Promise<string | null> => {
      if (!scraped.bio) return null
      try {
        const groqNiche = getGroqClient()
        const nicheRes = await groqNiche.chat.completions.create({
          model: MODELS.extraction,
          temperature: 0.1,
          // A trivial one-word classification — no chain-of-thought needed,
          // so skip reasoning entirely rather than leaving it unset (which
          // silently defaults to "medium" on GPT-OSS and was burning the
          // whole 10-token budget on hidden reasoning before ever writing
          // the actual word).
          reasoning_effort: "none",
          max_tokens: 30,
          messages: [
            {
              role: "user",
              content: `Based on this bio: "${scraped.bio.slice(0, 200)}", what single niche word best describes this creator? Return only one lowercase word.`,
            },
          ],
        })
        return nicheRes.choices[0]?.message?.content?.trim().split(/\s+/)[0]?.toLowerCase() ?? null
      } catch {
        // non-fatal
        return null
      }
    })(),
  ])

  // Step 3: Build raw_scraped_data
  const raw_scraped_data: Record<string, unknown> = {
    ...scraped.raw,
    scrape_success: scraped.scrape_success,
    ...(scraped.scrape_error ? { scrape_error: scraped.scrape_error } : {}),
  }

  // Step 4: Insert into influencers table
  const cachedAvatarUrl = await avatarCachePromise

  let influencer: InfluencerRow | null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (result.supabase!.from("influencers") as any)
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

    if (error) return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to save influencer.", error.message), { status: 500 })
    influencer = data
  } catch (err) {
    console.error("[influencers/discover] insert failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to save influencer."), { status: 500 })
  }

  return NextResponse.json({ data: influencer }, { status: 201 })
}
