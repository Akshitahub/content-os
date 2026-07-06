import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database, SocialConnectionInsert } from "@/types/database"

const LONG_LIVED_TOKEN_TTL_SECONDS = 60 * 24 * 60 * 60

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
  console.log("[social/threads/callback] GET called")

  const { searchParams, origin } = new URL(request.url)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? origin
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const oauthError = searchParams.get("error")

  if (oauthError || !code || !state) {
    console.error("[social/threads/callback] missing code/state or OAuth error:", oauthError)
    if (state) return redirectToBrand(appUrl, state, { threads_error: "oauth_denied" })
    return NextResponse.redirect(`${appUrl}/dashboard?threads_error=oauth_denied`)
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
    console.error("[social/threads/callback] brand not found or not owned by user:", brandId)
    return NextResponse.redirect(`${appUrl}/dashboard?threads_error=server_error`)
  }

  const threadsAppId = process.env.THREADS_APP_ID
  const threadsAppSecret = process.env.THREADS_APP_SECRET
  if (!threadsAppId || !threadsAppSecret) {
    console.error("[social/threads/callback] THREADS_APP_ID/THREADS_APP_SECRET not configured")
    return redirectToBrand(appUrl, brandId, { threads_error: "server_error" })
  }

  const redirectUri = `${appUrl}/api/v1/social/threads/callback`

  try {
    const shortTokenForm = new FormData()
    shortTokenForm.set("client_id", threadsAppId)
    shortTokenForm.set("client_secret", threadsAppSecret)
    shortTokenForm.set("grant_type", "authorization_code")
    shortTokenForm.set("redirect_uri", redirectUri)
    shortTokenForm.set("code", code)

    const shortTokenRes = await fetch("https://graph.threads.net/oauth/access_token", {
      method: "POST",
      body: shortTokenForm,
    })
    const shortTokenJson = await shortTokenRes.json()
    if (!shortTokenRes.ok || !shortTokenJson.access_token || !shortTokenJson.user_id) {
      console.error("[social/threads/callback] short-lived token exchange failed:", shortTokenJson)
      return redirectToBrand(appUrl, brandId, { threads_error: "token_exchange_failed" })
    }
    const shortLivedToken: string = shortTokenJson.access_token
    const threadsUserId: string = String(shortTokenJson.user_id)

    const longTokenUrl = new URL("https://graph.threads.net/access_token")
    longTokenUrl.searchParams.set("grant_type", "th_exchange_token")
    longTokenUrl.searchParams.set("client_secret", threadsAppSecret)
    longTokenUrl.searchParams.set("access_token", shortLivedToken)

    const longTokenRes = await fetch(longTokenUrl.toString())
    const longTokenJson = await longTokenRes.json()
    if (!longTokenRes.ok || !longTokenJson.access_token) {
      console.error("[social/threads/callback] long-lived token exchange failed:", longTokenJson)
      return redirectToBrand(appUrl, brandId, { threads_error: "token_exchange_failed" })
    }
    const longLivedToken: string = longTokenJson.access_token

    const profileUrl = new URL(`https://graph.threads.net/v1.0/${threadsUserId}`)
    profileUrl.searchParams.set("fields", "id,username")
    profileUrl.searchParams.set("access_token", longLivedToken)

    const profileRes = await fetch(profileUrl.toString())
    const profileJson = await profileRes.json()
    const threadsUsername: string | null = profileRes.ok ? (profileJson.username ?? null) : null

    const tokenExpiresAt = new Date(Date.now() + LONG_LIVED_TOKEN_TTL_SECONDS * 1000).toISOString()

    const connectionData: SocialConnectionInsert = {
      brand_id: brandId,
      platform: "threads",
      threads_user_id: threadsUserId,
      threads_username: threadsUsername,
      access_token: longLivedToken,
      token_expires_at: tokenExpiresAt,
      last_refreshed_at: new Date().toISOString(),
      is_active: true,
    }

    const { error: upsertError } = await socialConnectionsTable(supabase)
      .upsert(connectionData, { onConflict: "brand_id,platform" })

    if (upsertError) {
      console.error("[social/threads/callback] failed to save connection:", upsertError)
      return redirectToBrand(appUrl, brandId, { threads_error: "server_error" })
    }

    return redirectToBrand(appUrl, brandId, { threads_success: "1" })
  } catch (err) {
    console.error("[social/threads/callback] unexpected error:", err)
    return redirectToBrand(appUrl, brandId, { threads_error: "server_error" })
  }
}
