import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { createZernioProfile, getZernioConnectUrl } from "@/lib/social/zernio-client"
import { PLAN_LIMITS, type UserPlan } from "@/types/app"
import { isInternalUnlimited } from "@/lib/usage/is-internal-unlimited"
import { ENABLED_SOCIAL_PLATFORMS } from "@/lib/constants"
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

  // Business-stage cost control, independent of plan tier — see
  // lib/constants.ts's ENABLED_SOCIAL_PLATFORMS. Checked before the plan
  // gate below: a platform nobody can access yet shouldn't be presented as
  // an "upgrade to unlock" case. Enforced here (not just hidden/disabled in
  // the UI) since this is the step that actually starts incurring Zernio's
  // per-account cost.
  if (!ENABLED_SOCIAL_PLATFORMS.includes("linkedin")) {
    return NextResponse.json(
      buildError(ErrorCodes.FEATURE_UNAVAILABLE, "LinkedIn isn't available yet — Instagram is the only platform we support right now. More are coming as we grow."),
      { status: 403 }
    )
  }

  // LinkedIn/YouTube route through Zernio, a third-party unified API billed
  // per connected account across our whole Zernio account — gate it to
  // paid plans so a trialing/Starter connection doesn't become pure cost
  // with no matching revenue.
  const { data: userData } = await supabase
    .from("users")
    .select("plan")
    .eq("id", user.id)
    .single<{ plan: UserPlan }>()

  const plan: UserPlan = userData?.plan ?? "starter"
  if (!PLAN_LIMITS[plan].zernioSocialPlatforms && !isInternalUnlimited(user.id)) {
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

    let profileId: string
    if (existing?.zernio_profile_id) {
      profileId = existing.zernio_profile_id
    } else {
      profileId = (await createZernioProfile(brand.name))._id
      // Persist immediately so a retry (e.g. if getZernioConnectUrl below
      // fails) reuses this profile instead of creating a new orphaned one at
      // Zernio on every attempt. is_active stays false — the real connection
      // (zernio_account_id) is only written once OAuth actually completes.
      const { error: profileUpsertError } = await socialConnectionsTable(supabase)
        .upsert(
          { brand_id: brandId, platform: "linkedin", zernio_profile_id: profileId, access_token: null, token_expires_at: null, is_active: false },
          { onConflict: "brand_id,platform" }
        )
      if (profileUpsertError) {
        console.error("[social/linkedin/connect] failed to persist zernio_profile_id:", profileUpsertError)
      }
    }

    const { authUrl } = await getZernioConnectUrl("linkedin", profileId, redirectUri)

    const response = NextResponse.redirect(authUrl)
    response.cookies.set("zernio_profile_id", profileId, { maxAge: 600, httpOnly: true, secure: true, sameSite: "lax" })
    return response
  } catch (err) {
    console.error("[social/linkedin/connect] failed to start connect flow:", err instanceof Error ? err.message : err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't start the LinkedIn connect flow. Please try again."), { status: 500 })
  }
}
