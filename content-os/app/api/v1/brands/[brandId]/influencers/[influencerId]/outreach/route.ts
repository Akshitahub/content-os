import { NextResponse } from "next/server"
import OpenAI from "openai"
import { createClient } from "@/lib/supabase/server"
import {
  buildOutreachSystemPrompt,
  buildOutreachUserPrompt,
} from "@/lib/ai/prompts"
import { MODELS, NVIDIA_BASE_URL, getApiKey } from "@/lib/ai/models"
import { generateOutreachSchema } from "@/lib/validations/influencer"
import { buildError, ErrorCodes } from "@/types/api"
import type { BrandRow, InfluencerRow, OutreachMessageRow } from "@/types/database"

type RouteParams = { params: Promise<{ brandId: string; influencerId: string }> }

async function getAuthorizedBrand(brandId: string) {
  let supabase
  try { supabase = await createClient() } catch (err) {
    console.error("[influencers/outreach] createClient failed:", err)
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
  console.log("[influencers/outreach] POST called")

  const result = await getAuthorizedBrand(brandId)
  if (result.error === "server_error") return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  if (result.error === "unauthenticated") return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  if (result.error === "not_found") return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = generateOutreachSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })

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
    console.error("[influencers/outreach] influencer fetch failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch influencer."), { status: 500 })
  }

  const { channel, campaignGoal } = parsed.data
  const brand = result.brand!

  // Generate outreach message with NVIDIA API
  let subject: string | null = null
  let message_text: string
  let tone: string | null = null

  try {
    const openai = new OpenAI({ apiKey: getApiKey(), baseURL: NVIDIA_BASE_URL })
    const systemPrompt = buildOutreachSystemPrompt()
    const userPrompt = buildOutreachUserPrompt(
      brand,
      {
        handle: influencer.handle,
        platform: influencer.platform,
        bio: influencer.bio,
        follower_count: influencer.follower_count,
      },
      channel,
      campaignGoal,
    )

    const res = await openai.chat.completions.create({
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
      subject?: string | null
      message?: string
      message_text?: string
      tone?: string
    }

    // Support both response shapes from the prompt
    message_text = aiParsed.message ?? aiParsed.message_text ?? ""
    subject = aiParsed.subject ?? null
    tone = aiParsed.tone ?? null

    if (!message_text) {
      return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "AI did not return a valid message."), { status: 500 })
    }
  } catch (err) {
    console.error("[influencers/outreach] AI generation failed:", err)
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Failed to generate outreach message."), { status: 500 })
  }

  // Insert outreach message record
  let outreachMessage: OutreachMessageRow | null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (result.supabase!.from("outreach_messages") as any)
      .insert({
        influencer_id: influencerId,
        brand_id: brandId,
        channel,
        subject: subject ?? null,
        message_text,
        tone: tone ?? null,
      })
      .select()
      .single() as { data: OutreachMessageRow | null; error: { message: string } | null }

    if (error) return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to save outreach message.", error.message), { status: 500 })
    outreachMessage = data
  } catch (err) {
    console.error("[influencers/outreach] insert failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to save outreach message."), { status: 500 })
  }

  return NextResponse.json({ data: outreachMessage }, { status: 201 })
}

export async function GET(_req: Request, { params }: RouteParams) {
  const { brandId, influencerId } = await params
  console.log("[influencers/outreach] GET called")

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
    console.error("[influencers/outreach] influencer verify failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to verify influencer."), { status: 500 })
  }

  let messages: OutreachMessageRow[]
  try {
    const { data, error } = await result.supabase!
      .from("outreach_messages")
      .select("*")
      .eq("influencer_id", influencerId)
      .eq("brand_id", brandId)
      .order("created_at", { ascending: false })
      .returns<OutreachMessageRow[]>()

    if (error) return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch outreach messages.", error.message), { status: 500 })
    messages = data ?? []
  } catch (err) {
    console.error("[influencers/outreach] GET DB query failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch outreach messages."), { status: 500 })
  }

  return NextResponse.json({ data: messages })
}
