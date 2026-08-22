import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { checkAndIncrementUsage } from "@/lib/usage/check-and-increment-usage"
import { AD_MAKER } from "@/lib/usage/credit-costs"

type RouteParams = { params: Promise<{ brandId: string }> }

/**
 * Ad Maker's actual generation (Pollinations background fetch + canvas
 * compositing) happens entirely client-side — there's no server round-trip
 * at generation time to hang a credit charge on the way every other
 * feature's own generate route does. This route exists purely to check
 * and charge credits before the client starts that local work, so a user
 * out of credits is stopped before spending time on a generation they
 * can't afford. On a client-side generation failure afterward, the client
 * calls the paired .../ad-maker/refund route to undo this charge.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { brandId } = await params
  console.log(`[ai/ad-maker/generate] POST called for brand ${brandId}`)

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[ai/ad-maker/generate] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  const { data: brand } = await supabase.from("brands").select("id").eq("id", brandId).eq("user_id", user.id).single()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  const usageCheck = await checkAndIncrementUsage(user.id, AD_MAKER)
  if (!usageCheck.ok) {
    const code = usageCheck.status === 429 ? ErrorCodes.USAGE_LIMIT_EXCEEDED : ErrorCodes.INTERNAL_ERROR
    return NextResponse.json(buildError(code, usageCheck.message), { status: usageCheck.status })
  }

  return NextResponse.json({ data: { ok: true } }, { status: 200 })
}
