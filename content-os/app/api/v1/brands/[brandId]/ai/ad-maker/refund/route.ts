import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { refundGenerationUsage } from "@/lib/usage/check-and-increment-usage"
import { AD_MAKER } from "@/lib/usage/credit-costs"

type RouteParams = { params: Promise<{ brandId: string }> }

/**
 * Undoes the charge from .../ad-maker/generate when the client-side
 * generation (Pollinations fetch + canvas compositing) fails after
 * credits were already charged — there's no way for the server to know
 * that failure happened on its own, since the actual generation work
 * never touches the server. Best-effort: never blocks the client's own
 * error handling, so a failed refund never compounds a failed generation
 * into a worse user-facing error.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { brandId } = await params
  console.log(`[ai/ad-maker/refund] POST called for brand ${brandId}`)

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[ai/ad-maker/refund] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  const { data: brand } = await supabase.from("brands").select("id").eq("id", brandId).eq("user_id", user.id).single()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  await refundGenerationUsage(supabase, user.id, AD_MAKER)
  return NextResponse.json({ data: { ok: true } }, { status: 200 })
}
