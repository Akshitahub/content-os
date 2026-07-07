import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { sendOutreachEmail } from "@/lib/email/resend"
import { sendOutreachEmailSchema } from "@/lib/validations/influencer"
import { buildError, ErrorCodes } from "@/types/api"
import type { BrandRow, InfluencerRow, OutreachMessageRow } from "@/types/database"

type RouteParams = { params: Promise<{ brandId: string; influencerId: string }> }

async function getAuthorizedBrand(brandId: string) {
  let supabase
  try { supabase = await createClient() } catch (err) {
    console.error("[influencers/outreach/send-email] createClient failed:", err)
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
  console.log("[influencers/outreach/send-email] POST called")

  const result = await getAuthorizedBrand(brandId)
  if (result.error === "server_error") return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  if (result.error === "unauthenticated") return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  if (result.error === "not_found") return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = sendOutreachEmailSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })

  const { messageId, email } = parsed.data
  const brand = result.brand!

  // Fetch and verify the influencer belongs to this brand
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
    console.error("[influencers/outreach/send-email] influencer fetch failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch influencer."), { status: 500 })
  }

  // Fetch and verify the outreach message belongs to this influencer/brand,
  // and that it's actually an email-channel message.
  let message: OutreachMessageRow | null
  try {
    const { data, error } = await result.supabase!
      .from("outreach_messages")
      .select("*")
      .eq("id", messageId)
      .eq("influencer_id", influencerId)
      .eq("brand_id", brandId)
      .single<OutreachMessageRow>()

    if (error || !data) return NextResponse.json(buildError(ErrorCodes.NOT_FOUND, "Outreach message not found."), { status: 404 })
    message = data
  } catch (err) {
    console.error("[influencers/outreach/send-email] message fetch failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch outreach message."), { status: 500 })
  }

  if (message.channel !== "email") {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Only email-channel messages can be sent directly."), { status: 400 })
  }

  // The influencer's own stored email takes priority; a freshly-entered one
  // is persisted for next time. Never guess or auto-generate an address.
  const targetEmail = influencer.email ?? email
  if (!targetEmail) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "This influencer has no email on file yet — enter one to send."), { status: 400 })
  }

  if (email && email !== influencer.email) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: emailUpdateError } = await (result.supabase!.from("influencers") as any)
      .update({ email })
      .eq("id", influencerId)
      .eq("brand_id", brandId)

    if (emailUpdateError) {
      console.error("[influencers/outreach/send-email] failed to persist influencer email:", emailUpdateError)
    }
  }

  // Replies from the influencer should land in the brand owner's inbox, not
  // ContentOS's shared sending address. Supabase Auth users can in theory
  // lack an email, so fall back to no replyTo rather than an empty string.
  const replyToEmail = result.user!.email
  if (!replyToEmail) {
    console.warn(`[influencers/outreach/send-email] user ${result.user!.id} has no email on their auth account — sending without replyTo`)
  }

  const sendResult = await sendOutreachEmail(targetEmail, message.subject ?? "", message.message_text, brand.name, replyToEmail ?? "")
  if (!sendResult.success) {
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, sendResult.error ?? "Failed to send email."), { status: 500 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: sentUpdateError } = await (result.supabase!.from("outreach_messages") as any)
    .update({ sent_at: new Date().toISOString() })
    .eq("id", messageId)
    .eq("influencer_id", influencerId)
    .eq("brand_id", brandId)

  if (sentUpdateError) {
    console.error("[influencers/outreach/send-email] sent, but failed to record sent_at:", sentUpdateError)
  }

  return NextResponse.json({ data: { sent: true } })
}
