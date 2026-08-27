import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getZernioPinterestBoards } from "@/lib/social/zernio-client"
import { PLAN_LIMITS, type UserPlan } from "@/types/app"
import { isInternalUnlimited } from "@/lib/usage/is-internal-unlimited"
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
  console.log("[social/pinterest/callback] GET called")

  const { searchParams, origin } = new URL(request.url)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? origin
  const brandId = searchParams.get("brandId")
  const connected = searchParams.get("connected")
  const profileIdParam = searchParams.get("profileId")
  const accountId = searchParams.get("accountId")
  const username = searchParams.get("username")

  if (!brandId) {
    console.error("[social/pinterest/callback] missing brandId")
    return NextResponse.redirect(`${appUrl}/dashboard?pinterest_error=server_error`)
  }

  if (connected !== "pinterest" || !accountId) {
    console.error("[social/pinterest/callback] connection did not complete:", { connected, accountId })
    return redirectToBrand(appUrl, brandId, { pinterest_error: "oauth_denied" })
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
    console.error("[social/pinterest/callback] brand not found or not owned by user:", brandId)
    return NextResponse.redirect(`${appUrl}/dashboard?pinterest_error=server_error`)
  }

  // Same plan gate as the connect route — a trialing/Starter user could
  // still hit this callback directly (a stale OAuth flow started before
  // downgrading, or a replayed/guessed URL), so don't let it silently write
  // a connection row for a plan that shouldn't have one.
  const { data: userData } = await supabase
    .from("users")
    .select("plan")
    .eq("id", user.id)
    .single<{ plan: UserPlan }>()

  const plan: UserPlan = userData?.plan ?? "starter"
  if (!PLAN_LIMITS[plan].zernioSocialPlatforms && !isInternalUnlimited(user.id)) {
    console.error(`[social/pinterest/callback] brand ${brandId}'s plan (${plan}) does not include Zernio social platforms`)
    return redirectToBrand(appUrl, brandId, { pinterest_error: "plan_restricted" })
  }

  const cookieProfileId = request.headers.get("cookie")?.match(/zernio_profile_id=([^;]+)/)?.[1]
  const profileId = profileIdParam ?? cookieProfileId

  if (!profileId) {
    console.error("[social/pinterest/callback] no profileId available from redirect or cookie")
    return redirectToBrand(appUrl, brandId, { pinterest_error: "server_error" })
  }

  // Board selection isn't part of Zernio's OAuth connect step (boardId is
  // only needed at publish time), so auto-pick the first board here — same
  // "no board picker UI" behavior the old direct-OAuth flow had.
  let boardId: string | null = null
  let boardName: string | null = null
  try {
    const boards = await getZernioPinterestBoards(accountId)
    if (boards.length === 0) {
      console.error(`[social/pinterest/callback] account ${accountId} has no Pinterest boards`)
      return redirectToBrand(appUrl, brandId, { pinterest_error: "no_boards" })
    }
    boardId = boards[0]!.id
    boardName = boards[0]!.name
  } catch (err) {
    console.error("[social/pinterest/callback] failed to fetch Pinterest boards:", err instanceof Error ? err.message : err)
    return redirectToBrand(appUrl, brandId, { pinterest_error: "server_error" })
  }

  const connectionData: SocialConnectionInsert = {
    brand_id: brandId,
    platform: "pinterest",
    zernio_profile_id: profileId,
    zernio_account_id: accountId,
    pinterest_username: username,
    pinterest_board_id: boardId,
    pinterest_board_name: boardName,
    access_token: null,
    token_expires_at: null,
    last_refreshed_at: new Date().toISOString(),
    is_active: true,
  }

  const { error: upsertError } = await socialConnectionsTable(supabase)
    .upsert(connectionData, { onConflict: "brand_id,platform" })

  if (upsertError) {
    console.error("[social/pinterest/callback] failed to save connection:", upsertError)
    return redirectToBrand(appUrl, brandId, { pinterest_error: "server_error" })
  }

  const response = redirectToBrand(appUrl, brandId, { pinterest_success: "1" })
  response.cookies.delete("zernio_profile_id")
  return response
}
