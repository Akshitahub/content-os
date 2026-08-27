import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import type { BrandRow, SocialConnectionRow } from "@/types/database"

type RouteParams = { params: Promise<{ brandId: string }> }

export async function POST(_request: Request, { params }: RouteParams) {
  const { brandId } = await params
  console.log(`[brands/${brandId}/competitor-analysis] POST called`)

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[competitor-analysis] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  // Confirm real connection status (zernio_account_id — the field the
  // Zernio-based Instagram connect flow actually populates, unlike
  // ig_business_account_id, which only ever came from the old direct Meta
  // OAuth flow and is never set for a Zernio-connected brand) so the error
  // below is at least accurate about whether Instagram is connected, even
  // though the feature itself can't work either way — see the note below.
  const { data: connection } = await supabase
    .from("social_connections")
    .select("*")
    .eq("brand_id", brandId)
    .eq("platform", "instagram")
    .eq("is_active", true)
    .maybeSingle<SocialConnectionRow>()

  if (!connection || !(connection.zernio_account_id || connection.ig_business_account_id)) {
    return NextResponse.json(
      buildError(ErrorCodes.VALIDATION_ERROR, "Connect Instagram first — competitor lookups require an active Instagram Business connection."),
      { status: 400 }
    )
  }

  // Competitor analysis looked up OTHER public Instagram accounts via the
  // Graph API's Business Discovery field, using this brand's own access
  // token. Zernio (the unified API Instagram now connects through) never
  // hands this app a usable Meta access token — it manages that on its own
  // side — and confirmed against Zernio's full API reference, it has no
  // equivalent for looking up an account outside the connected profile.
  // There's no fix to apply here, just an honest answer instead of the old
  // "Connect Instagram first" message when Instagram genuinely is connected.
  return NextResponse.json(
    buildError(ErrorCodes.FEATURE_UNAVAILABLE, "Competitor analysis isn't currently available."),
    { status: 503 }
  )
}
