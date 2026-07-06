import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
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
  console.log("[social/youtube/callback] GET called")

  const { searchParams, origin } = new URL(request.url)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? origin
  const brandId = searchParams.get("brandId")
  const connected = searchParams.get("connected")
  const profileIdParam = searchParams.get("profileId")
  const accountId = searchParams.get("accountId")
  const username = searchParams.get("username")

  if (!brandId) {
    console.error("[social/youtube/callback] missing brandId")
    return NextResponse.redirect(`${appUrl}/dashboard?youtube_error=server_error`)
  }

  if (connected !== "youtube" || !accountId) {
    console.error("[social/youtube/callback] connection did not complete:", { connected, accountId })
    return redirectToBrand(appUrl, brandId, { youtube_error: "oauth_denied" })
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
    console.error("[social/youtube/callback] brand not found or not owned by user:", brandId)
    return NextResponse.redirect(`${appUrl}/dashboard?youtube_error=server_error`)
  }

  const cookieProfileId = request.headers.get("cookie")?.match(/zernio_profile_id=([^;]+)/)?.[1]
  const profileId = profileIdParam ?? cookieProfileId

  if (!profileId) {
    console.error("[social/youtube/callback] no profileId available from redirect or cookie")
    return redirectToBrand(appUrl, brandId, { youtube_error: "server_error" })
  }

  const connectionData: SocialConnectionInsert = {
    brand_id: brandId,
    platform: "youtube",
    zernio_profile_id: profileId,
    zernio_account_id: accountId,
    youtube_channel_name: username,
    access_token: null,
    token_expires_at: null,
    last_refreshed_at: new Date().toISOString(),
    is_active: true,
  }

  const { error: upsertError } = await socialConnectionsTable(supabase)
    .upsert(connectionData, { onConflict: "brand_id,platform" })

  if (upsertError) {
    console.error("[social/youtube/callback] failed to save connection:", upsertError)
    return redirectToBrand(appUrl, brandId, { youtube_error: "server_error" })
  }

  const response = redirectToBrand(appUrl, brandId, { youtube_success: "1" })
  response.cookies.delete("zernio_profile_id")
  return response
}
