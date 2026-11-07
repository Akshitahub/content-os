import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { exchangeCode } from "@/lib/social/meta-instagram-client"
import { encryptToken } from "@/lib/social/token-crypto"
import { instagramDirectRedirectUri, isInstagramDirectEnabled, STATE_COOKIE, verifyConnectState } from "@/lib/social/instagram-direct"
import { PLAN_LIMITS, type UserPlan } from "@/types/app"
import { isInternalUnlimited } from "@/lib/usage/is-internal-unlimited"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database, SocialConnectionInsert } from "@/types/database"
import { logAudit, requestIp } from "@/lib/security/audit"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function socialConnectionsTable(supabase: SupabaseClient<Database>): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).from("social_connections")
}

function redirectToBrand(origin: string, brandId: string, params: Record<string, string>) {
  const url = new URL(`${origin}/brands/${brandId}`)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  const response = NextResponse.redirect(url.toString())
  response.cookies.set(STATE_COOKIE, "", { maxAge: 0, path: "/api/v1/social/instagram-direct" })
  return response
}

export async function GET(request: Request) {
  console.log("[social/instagram-direct/callback] GET called")

  const { searchParams, origin } = new URL(request.url)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? origin
  const code = searchParams.get("code")
  const stateParam = searchParams.get("state")
  const cookieNonce = request.headers.get("cookie")?.match(new RegExp(`${STATE_COOKIE}=([^;]+)`))?.[1]

  // The state names the brand -- and is only trusted when its signature,
  // expiry and this browser's nonce cookie all check out (CSRF).
  const state = stateParam ? verifyConnectState(stateParam, cookieNonce) : null
  if (!state) {
    console.error("[social/instagram-direct/callback] missing or invalid state")
    return NextResponse.redirect(`${appUrl}/dashboard?ig_error=session_expired`)
  }
  const { brandId } = state

  if (searchParams.get("error") || !code) {
    console.error("[social/instagram-direct/callback] authorization did not complete:", { error: searchParams.get("error"), reason: searchParams.get("error_reason") })
    return redirectToBrand(appUrl, brandId, { ig_error: "oauth_denied" })
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.redirect(`${appUrl}/login?redirectTo=/brands/${brandId}`)
  }
  if (user.id !== state.userId) {
    console.error("[social/instagram-direct/callback] state was issued to a different user")
    return redirectToBrand(appUrl, brandId, { ig_error: "session_expired" })
  }

  if (!isInstagramDirectEnabled(user.id)) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "Direct Instagram connection is not enabled for this account."), { status: 403 })
  }

  const { data: brand } = await supabase
    .from("brands")
    .select("id, user_id")
    .eq("id", brandId)
    .single<{ id: string; user_id: string }>()

  if (!brand || brand.user_id !== user.id) {
    console.error("[social/instagram-direct/callback] brand not found or not owned by user:", brandId)
    return NextResponse.redirect(`${appUrl}/dashboard?ig_error=server_error`)
  }

  // Same plan gate as the connect route (a stale flow, or a replayed URL).
  const { data: userData } = await supabase
    .from("users")
    .select("plan")
    .eq("id", user.id)
    .single<{ plan: UserPlan }>()

  const plan: UserPlan = userData?.plan ?? "starter"
  if (!PLAN_LIMITS[plan].zernioSocialPlatforms && !isInternalUnlimited(user.id)) {
    console.error(`[social/instagram-direct/callback] brand ${brandId}'s plan (${plan}) does not include social platforms`)
    return redirectToBrand(appUrl, brandId, { ig_error: "plan_restricted" })
  }

  const exchanged = await exchangeCode(code, instagramDirectRedirectUri(appUrl))
  if (!exchanged.ok) {
    console.error("[social/instagram-direct/callback] code exchange failed:", exchanged.error)
    return redirectToBrand(appUrl, brandId, { ig_error: "token_exchange_failed" })
  }

  const encrypted = encryptToken(exchanged.token)
  if (!encrypted.ok) {
    console.error("[social/instagram-direct/callback] could not encrypt token:", encrypted.error)
    return redirectToBrand(appUrl, brandId, { ig_error: "server_error" })
  }

  // A Zernio connection this replaces stays billed at Zernio until removed there.
  const { data: previous } = await socialConnectionsTable(supabase)
    .select("zernio_account_id")
    .eq("brand_id", brandId)
    .eq("platform", "instagram")
    .maybeSingle() as { data: { zernio_account_id: string | null } | null }

  const now = new Date().toISOString()
  const connectionData: SocialConnectionInsert = {
    brand_id: brandId,
    platform: "instagram",
    provider: "meta",
    ig_business_account_id: exchanged.igUserId,
    ig_username: exchanged.username,
    access_token: encrypted.value,
    token_expires_at: exchanged.expiresAt,
    last_refreshed_at: now,
    is_active: true,
    zernio_account_id: null,
    zernio_profile_id: null,
  }

  const { error: upsertError } = await socialConnectionsTable(supabase)
    .upsert(connectionData, { onConflict: "brand_id,platform" })

  if (upsertError) {
    console.error("[social/instagram-direct/callback] failed to save connection:", upsertError.message)
    return redirectToBrand(appUrl, brandId, { ig_error: "server_error" })
  }

  if (previous?.zernio_account_id) {
    console.log(`[instagram-direct] remove this account in the Zernio dashboard: zernio_account_id ${previous.zernio_account_id} (brand ${brandId} now connects Instagram directly)`)
  }

  await logAudit({
    actorType: "user",
    actorId: user.id,
    action: "social.connect",
    targetType: "brand",
    targetId: brandId,
    meta: { platform: "instagram", provider: "meta", ig_user_id: exchanged.igUserId, replaced_zernio_account_id: previous?.zernio_account_id ?? null },
    ip: requestIp(request),
  })
  return redirectToBrand(appUrl, brandId, { ig_success: "1" })
}
