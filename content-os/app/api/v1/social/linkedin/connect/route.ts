import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { createZernioProfile, getZernioConnectUrl } from "@/lib/social/zernio-client"
import { PLAN_LIMITS, type UserPlan } from "@/types/app"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function socialConnectionsTable(supabase: SupabaseClient<Database>): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).from("social_connections")
}

export async function GET(request: Request) {
  console.log("[social/linkedin/connect] GET called")

  const { searchParams, origin } = new URL(request.url)
  const brandId = searchParams.get("brandId")

  if (!brandId) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "brandId is required."), { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  }

  const { data: brand } = await supabase
    .from("brands")
    .select("id, user_id, name")
    .eq("id", brandId)
    .single<{ id: string; user_id: string; name: string }>()

  if (!brand) {
    return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  }
  if (brand.user_id !== user.id) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "You do not have access to this brand."), { status: 403 })
  }

  // LinkedIn/YouTube route through Zernio, a third-party unified API billed
  // per connected account across our whole Zernio account — gate it to
  // paid plans so free/starter connections don't become pure cost with no
  // matching revenue.
  const { data: userData } = await supabase
    .from("users")
    .select("plan")
    .eq("id", user.id)
    .single<{ plan: UserPlan }>()

  const plan: UserPlan = userData?.plan ?? "free"
  if (!PLAN_LIMITS[plan].zernioSocialPlatforms) {
    return NextResponse.json(
      buildError(ErrorCodes.USAGE_LIMIT_EXCEEDED, "LinkedIn and YouTube publishing are available on Pro and Agency plans. Upgrade to connect this platform."),
      { status: 403 }
    )
  }

  if (!process.env.ZERNIO_API_KEY) {
    console.error("[social/linkedin/connect] ZERNIO_API_KEY is not configured")
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "LinkedIn connect is not configured."), { status: 500 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? origin
  const redirectUri = `${appUrl}/api/v1/social/linkedin/callback?brandId=${brandId}`

  try {
    const { data: existing } = await socialConnectionsTable(supabase)
      .select("zernio_profile_id")
      .eq("brand_id", brandId)
      .not("zernio_profile_id", "is", null)
      .limit(1)
      .maybeSingle()

    const profileId: string = existing?.zernio_profile_id ?? (await createZernioProfile(brand.name))._id

    const { authUrl } = await getZernioConnectUrl("linkedin", profileId, redirectUri)

    const response = NextResponse.redirect(authUrl)
    response.cookies.set("zernio_profile_id", profileId, { maxAge: 600, httpOnly: true, secure: true, sameSite: "lax" })
    return response
  } catch (err) {
    console.error("[social/linkedin/connect] failed to start connect flow:", err instanceof Error ? err.message : err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't start the LinkedIn connect flow. Please try again."), { status: 500 })
  }
}
