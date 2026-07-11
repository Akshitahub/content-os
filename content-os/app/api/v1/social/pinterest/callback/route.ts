import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { redactTokenFields } from "@/lib/social/oauth-log-safe"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database, SocialConnectionInsert } from "@/types/database"

const TOKEN_TTL_ESTIMATE_SECONDS = 30 * 24 * 60 * 60

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
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const oauthError = searchParams.get("error")

  if (oauthError || !code || !state) {
    console.error("[social/pinterest/callback] missing code/state or OAuth error:", oauthError)
    if (state) return redirectToBrand(appUrl, state, { pinterest_error: "oauth_denied" })
    return NextResponse.redirect(`${appUrl}/dashboard?pinterest_error=oauth_denied`)
  }

  const brandId = state

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

  const pinterestAppId = process.env.PINTEREST_APP_ID
  const pinterestAppSecret = process.env.PINTEREST_APP_SECRET
  if (!pinterestAppId || !pinterestAppSecret) {
    console.error("[social/pinterest/callback] PINTEREST_APP_ID/PINTEREST_APP_SECRET not configured")
    return redirectToBrand(appUrl, brandId, { pinterest_error: "server_error" })
  }

  const redirectUri = `${appUrl}/api/v1/social/pinterest/callback`
  const basicAuth = Buffer.from(`${pinterestAppId}:${pinterestAppSecret}`).toString("base64")

  try {
    const tokenRes = await fetch("https://api.pinterest.com/v5/oauth/token", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    })
    const tokenJson = await tokenRes.json()
    if (!tokenRes.ok || !tokenJson.access_token) {
      console.error("[social/pinterest/callback] token exchange failed:", redactTokenFields(tokenJson))
      return redirectToBrand(appUrl, brandId, { pinterest_error: "token_exchange_failed" })
    }
    const accessToken: string = tokenJson.access_token
    const refreshToken: string | null = tokenJson.refresh_token ?? null

    const userRes = await fetch("https://api.pinterest.com/v5/user_account", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const userJson = await userRes.json()
    const pinterestUsername: string | null = userRes.ok ? (userJson.username ?? null) : null

    const boardsRes = await fetch("https://api.pinterest.com/v5/boards", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const boardsJson = await boardsRes.json()
    const firstBoard = Array.isArray(boardsJson.items) ? boardsJson.items[0] : null

    if (!firstBoard) {
      console.error("[social/pinterest/callback] user has no boards:", boardsJson)
      return redirectToBrand(appUrl, brandId, { pinterest_error: "no_boards" })
    }

    const tokenExpiresAt = new Date(Date.now() + TOKEN_TTL_ESTIMATE_SECONDS * 1000).toISOString()

    const connectionData: SocialConnectionInsert = {
      brand_id: brandId,
      platform: "pinterest",
      pinterest_user_id: userJson.id ?? null,
      pinterest_username: pinterestUsername,
      pinterest_board_id: firstBoard.id,
      pinterest_board_name: firstBoard.name ?? null,
      access_token: accessToken,
      refresh_token: refreshToken,
      token_expires_at: tokenExpiresAt,
      last_refreshed_at: new Date().toISOString(),
      is_active: true,
    }

    const { error: upsertError } = await socialConnectionsTable(supabase)
      .upsert(connectionData, { onConflict: "brand_id,platform" })

    if (upsertError) {
      console.error("[social/pinterest/callback] failed to save connection:", upsertError)
      return redirectToBrand(appUrl, brandId, { pinterest_error: "server_error" })
    }

    return redirectToBrand(appUrl, brandId, { pinterest_success: "1" })
  } catch (err) {
    console.error("[social/pinterest/callback] unexpected error:", err)
    return redirectToBrand(appUrl, brandId, { pinterest_error: "server_error" })
  }
}
