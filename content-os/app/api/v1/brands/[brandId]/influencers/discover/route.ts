import { NextResponse } from "next/server"
import OpenAI from "openai"
import { createClient } from "@/lib/supabase/server"
import { scrapeInfluencerProfile } from "@/lib/ai/scraper"
import {
  buildInfluencerFitScoringSystemPrompt,
  buildInfluencerFitScoringUserPrompt,
} from "@/lib/ai/prompts"
import { MODELS, NVIDIA_BASE_URL, getApiKey } from "@/lib/ai/models"
import { discoverInfluencerSchema } from "@/lib/validations/influencer"
import { buildError, ErrorCodes } from "@/types/api"
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

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = discoverInfluencerSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })

  const { handle, platform } = parsed.data
  const brand = result.brand!

  // Step 1: Scrape influencer profile
  let scraped = await scrapeInfluencerProfile(platform, handle)

  // Step 2: Score with NVIDIA API regardless of scrape success
  let fit_score: number | null = null
  let fit_reasoning: string | null = null

  try {
    const openai = new OpenAI({ apiKey: getApiKey(), baseURL: NVIDIA_BASE_URL })
    const systemPrompt = buildInfluencerFitScoringSystemPrompt()
    const userPrompt = buildInfluencerFitScoringUserPrompt(brand, {
      handle: scraped.handle,
      platform: scraped.platform,
      full_name: scraped.full_name,
      bio: scraped.bio,
      follower_count: scraped.follower_count,
      post_count: scraped.post_count,
      niche: null,
    })

    const res = await openai.chat.completions.create({
      model: MODELS.scoring,
      temperature: 0.3,
      max_tokens: 800,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    })

    const aiContent = res.choices[0]?.message?.content ?? "{}"
    const aiCleaned = aiContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").replace(/[\x00-\x1F\x7F]/g, " ").trim()
    const aiParsed = JSON.parse(aiCleaned) as {
      score?: number
      reasoning?: string
      fit_score?: number
      fit_reasoning?: string
    }

    // Support both response shapes from the prompt
    fit_score = aiParsed.score ?? aiParsed.fit_score ?? null
    fit_reasoning = aiParsed.reasoning ?? aiParsed.fit_reasoning ?? null
  } catch (err) {
    console.error("[influencers/discover] AI scoring failed:", err)
    // Non-fatal: we still insert the influencer without a score
  }

  // Step 2b: Extract niche from bio
  let niche: string | null = null
  if (scraped.bio) {
    try {
      const openaiNiche = new OpenAI({ apiKey: getApiKey(), baseURL: NVIDIA_BASE_URL })
      const nicheRes = await openaiNiche.chat.completions.create({
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

  // Step 3: Build raw_scraped_data
  const raw_scraped_data: Record<string, unknown> = {
    ...scraped.raw,
    scrape_success: scraped.scrape_success,
    ...(scraped.scrape_error ? { scrape_error: scraped.scrape_error } : {}),
  }

  // Step 4: Insert into influencers table
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

    if (error) return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to save influencer.", error.message), { status: 500 })
    influencer = data
  } catch (err) {
    console.error("[influencers/discover] insert failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to save influencer."), { status: 500 })
  }

  return NextResponse.json({ data: influencer }, { status: 201 })
}
