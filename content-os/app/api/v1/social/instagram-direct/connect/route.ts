import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { buildAuthorizeUrl } from "@/lib/social/meta-instagram-client"
import { createConnectState, instagramDirectRedirectUri, isInstagramDirectEnabled, STATE_COOKIE, STATE_TTL_SECONDS } from "@/lib/social/instagram-direct"
import { PLAN_LIMITS, type UserPlan } from "@/types/app"
import { isInternalUnlimited } from "@/lib/usage/is-internal-unlimited"

// Instagram without Zernio (Business Login for Instagram): allowlisted
// users only (INSTAGRAM_DIRECT_USER_IDS) while it's being proven out.
export async function GET(request: Request) {
  console.log("[social/instagram-direct/connect] GET called")

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

  if (!isInstagramDirectEnabled(user.id)) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "Direct Instagram connection is not enabled for this account."), { status: 403 })
  }

  const { data: brand } = await supabase
    .from("brands")
    .select("id, user_id")
    .eq("id", brandId)
    .single<{ id: string; user_id: string }>()

  if (!brand) {
    return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  }
  if (brand.user_id !== user.id) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "You do not have access to this brand."), { status: 403 })
  }

  // Same plan gate as the Zernio Instagram connect.
  const { data: userData } = await supabase
    .from("users")
    .select("plan")
    .eq("id", user.id)
    .single<{ plan: UserPlan }>()

  const plan: UserPlan = userData?.plan ?? "starter"
  if (!PLAN_LIMITS[plan].zernioSocialPlatforms && !isInternalUnlimited(user.id)) {
    return NextResponse.json(
      buildError(ErrorCodes.USAGE_LIMIT_EXCEEDED, "Instagram publishing is available on Pro and Agency plans. Upgrade to connect this platform."),
      { status: 403 }
    )
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? origin
  const { state, nonce } = createConnectState(brandId, user.id)
  const authorize = buildAuthorizeUrl(state, instagramDirectRedirectUri(appUrl))
  if (!authorize.ok) {
    console.error("[social/instagram-direct/connect] not configured:", authorize.error)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Instagram connect is not configured."), { status: 500 })
  }

  const response = NextResponse.redirect(authorize.url)
  response.cookies.set(STATE_COOKIE, nonce, { maxAge: STATE_TTL_SECONDS, httpOnly: true, secure: true, sameSite: "lax", path: "/api/v1/social/instagram-direct" })
  return response
}
