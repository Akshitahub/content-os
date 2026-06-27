import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  buildCollaborationBriefSystemPrompt,
  buildCollaborationBriefUserPrompt,
} from "@/lib/ai/prompts"
import { MODELS, getGroqClient } from "@/lib/ai/models"
import { generateBriefSchema } from "@/lib/validations/influencer"
import { buildError, ErrorCodes } from "@/types/api"
import type { BrandRow, InfluencerRow, InfluencerPartnershipRow, ProductRow } from "@/types/database"

type RouteParams = { params: Promise<{ brandId: string; influencerId: string }> }

async function getAuthorizedBrand(brandId: string) {
  let supabase
  try { supabase = await createClient() } catch (err) {
    console.error("[influencers/brief] createClient failed:", err)
    return { error: "server_error" as const, supabase: null, user: null, brand: null }
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: "unauthenticated" as const, supabase, user: null, brand: null }
  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return { error: "not_found" as const, supabase, user, brand: null }
  return { error: null, supabase, user, brand }
}

export async function POST(request: Request, { params }: RouteParams) {
  const { brandId, influencerId } = await params
  console.log("[influencers/brief] POST called")

  const result = await getAuthorizedBrand(brandId)
  if (result.error === "server_error") return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  if (result.error === "unauthenticated") return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  if (result.error === "not_found") return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = generateBriefSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })

  const { campaignName, productId } = parsed.data
  const brand = result.brand!

  // Fetch influencer and verify it belongs to this brand
  let influencer: InfluencerRow | null
  try {
    const { data, error } = await result.supabase!
      .from("influencers")
      .select("*")
      .eq("id", influencerId)
      .eq("brand_id", brandId)
      .single<InfluencerRow>()

    if (error || !data) return NextResponse.json(buildError(ErrorCodes.NOT_FOUND, "Influencer not found."), { status: 404 })
    influencer = data
  } catch (err) {
    console.error("[influencers/brief] influencer fetch failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch influencer."), { status: 500 })
  }

  // Optionally fetch product
  let product: ProductRow | null = null
  if (productId) {
    try {
      const { data } = await result.supabase!
        .from("products")
        .select("*")
        .eq("id", productId)
        .eq("brand_id", brandId)
        .single<ProductRow>()

      product = data ?? null
    } catch (err) {
      console.error("[influencers/brief] product fetch failed:", err)
      // Non-fatal: continue without product
    }
  }

  // Generate collaboration brief with NVIDIA API
  let campaign_brief: string
  let deliverables: string[] = []
  let talking_points: string[] = []
  let dos: string[] = []
  let donts: string[] = []
  let key_hashtags: string[] = []

  try {
    const groq = getGroqClient()
    const systemPrompt = buildCollaborationBriefSystemPrompt()
    const userPrompt = buildCollaborationBriefUserPrompt(
      brand,
      {
        handle: influencer.handle,
        platform: influencer.platform,
        bio: influencer.bio,
        follower_count: influencer.follower_count,
      },
      campaignName,
      product,
    )

    const res = await groq.chat.completions.create({
      model: MODELS.generation,
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
      campaign_name?: string
      overview?: string
      campaign_brief?: string
      deliverables?: string[]
      talking_points?: string[]
      dos?: string[]
      donts?: string[]
      key_hashtags?: string[]
    }

    // Support both "overview" and "campaign_brief" keys from the prompt
    campaign_brief = aiParsed.campaign_brief ?? aiParsed.overview ?? ""
    deliverables = aiParsed.deliverables ?? []
    talking_points = aiParsed.talking_points ?? []
    dos = aiParsed.dos ?? []
    donts = aiParsed.donts ?? []
    key_hashtags = aiParsed.key_hashtags ?? []

    if (!campaign_brief) {
      return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "AI did not return a valid brief."), { status: 500 })
    }
  } catch (err) {
    console.error("[influencers/brief] AI generation failed:", err)
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Failed to generate collaboration brief."), { status: 500 })
  }

  // Insert into influencer_partnerships
  let partnership: InfluencerPartnershipRow | null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (result.supabase!.from("influencer_partnerships") as any)
      .insert({
        influencer_id: influencerId,
        brand_id: brandId,
        campaign_name: campaignName,
        campaign_brief,
        deliverables,
        talking_points,
        dos,
        donts,
        key_hashtags,
        status: "draft",
      })
      .select()
      .single() as { data: InfluencerPartnershipRow | null; error: { message: string } | null }

    if (error) return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to save partnership.", error.message), { status: 500 })
    partnership = data
  } catch (err) {
    console.error("[influencers/brief] insert failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to save partnership."), { status: 500 })
  }

  return NextResponse.json({ data: partnership }, { status: 201 })
}

export async function GET(_req: Request, { params }: RouteParams) {
  const { brandId, influencerId } = await params
  console.log("[influencers/brief] GET called")

  const result = await getAuthorizedBrand(brandId)
  if (result.error === "server_error") return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  if (result.error === "unauthenticated") return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  if (result.error === "not_found") return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  // Verify influencer belongs to this brand
  try {
    const { data: existing } = await result.supabase!
      .from("influencers")
      .select("id")
      .eq("id", influencerId)
      .eq("brand_id", brandId)
      .single<{ id: string }>()

    if (!existing) return NextResponse.json(buildError(ErrorCodes.NOT_FOUND, "Influencer not found."), { status: 404 })
  } catch (err) {
    console.error("[influencers/brief] influencer verify failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to verify influencer."), { status: 500 })
  }

  let partnerships: InfluencerPartnershipRow[]
  try {
    const { data, error } = await result.supabase!
      .from("influencer_partnerships")
      .select("*")
      .eq("influencer_id", influencerId)
      .eq("brand_id", brandId)
      .order("created_at", { ascending: false })
      .returns<InfluencerPartnershipRow[]>()

    if (error) return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch partnerships.", error.message), { status: 500 })
    partnerships = data ?? []
  } catch (err) {
    console.error("[influencers/brief] GET DB query failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch partnerships."), { status: 500 })
  }

  return NextResponse.json({ data: partnerships })
}
