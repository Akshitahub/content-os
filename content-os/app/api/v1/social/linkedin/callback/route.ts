import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { PLAN_LIMITS, type UserPlan } from "@/types/app"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database, SocialConnectionInsert } from "@/types/database"

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
  return NextResponse.redirect(url.toString())
}

export async function GET(request: Request) {
  console.log("[social/linkedin/callback] GET called")

  const { searchParams, origin } = new URL(request.url)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? origin
  const brandId = searchParams.get("brandId")
  const connected = searchParams.get("connected")
  const profileIdParam = searchParams.get("profileId")
  const accountId = searchParams.get("accountId")
  const username = searchParams.get("username")

  if (!brandId) {
    console.error("[social/linkedin/callback] missing brandId")
    return NextResponse.redirect(`${appUrl}/dashboard?linkedin_error=server_error`)
  }

  if (connected !== "linkedin" || !accountId) {
    console.error("[social/linkedin/callback] connection did not complete:", { connected, accountId })
    return redirectToBrand(appUrl, brandId, { linkedin_error: "oauth_denied" })
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.redirect(`${appUrl}/login?redirectTo=/brands/${brandId}`)
  }

  const { data: brand } = await supabase
    .from("brands")
    .select("id, user_id")
    .eq("id", brandId)
    .single<{ id: string; user_id: string }>()

  if (!brand || brand.user_id !== user.id) {
    console.error("[social/linkedin/callback] brand not found or not owned by user:", brandId)
    return NextResponse.redirect(`${appUrl}/dashboard?linkedin_error=server_error`)
  }

  // Same plan gate as the connect route — a free/starter user could still
  // hit this callback directly (a stale OAuth flow started before
  // downgrading, or a replayed/guessed URL), so don't let it silently write
  // a connection row for a plan that shouldn't have one.
  const { data: userData } = await supabase
    .from("users")
    .select("plan")
    .eq("id", user.id)
    .single<{ plan: UserPlan }>()

  const plan: UserPlan = userData?.plan ?? "free"
  if (!PLAN_LIMITS[plan].zernioSocialPlatforms) {
    console.error(`[social/linkedin/callback] brand ${brandId}'s plan (${plan}) does not include Zernio social platforms`)
    return redirectToBrand(appUrl, brandId, { linkedin_error: "plan_restricted" })
  }

  const cookieProfileId = request.headers.get("cookie")?.match(/zernio_profile_id=([^;]+)/)?.[1]
  const profileId = profileIdParam ?? cookieProfileId

  if (!profileId) {
    console.error("[social/linkedin/callback] no profileId available from redirect or cookie")
    return redirectToBrand(appUrl, brandId, { linkedin_error: "server_error" })
  }

  const connectionData: SocialConnectionInsert = {
    brand_id: brandId,
    platform: "linkedin",
    zernio_profile_id: profileId,
    zernio_account_id: accountId,
    linkedin_username: username,
    access_token: null,
    token_expires_at: null,
    last_refreshed_at: new Date().toISOString(),
    is_active: true,
  }

  const { error: upsertError } = await socialConnectionsTable(supabase)
    .upsert(connectionData, { onConflict: "brand_id,platform" })

  if (upsertError) {
    console.error("[social/linkedin/callback] failed to save connection:", upsertError)
    return redirectToBrand(appUrl, brandId, { linkedin_error: "server_error" })
  }

  const response = redirectToBrand(appUrl, brandId, { linkedin_success: "1" })
  response.cookies.delete("zernio_profile_id")
  return response
}
