import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { redactTokenFields } from "@/lib/social/oauth-log-safe"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database, SocialConnectionInsert } from "@/types/database"

const GRAPH_VERSION = "v21.0"
const LONG_LIVED_TOKEN_TTL_SECONDS = 60 * 24 * 60 * 60 // 60 days

type FacebookPage = {
  id: string
  name?: string
  access_token: string
}

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
  console.log("[social/instagram/callback] GET called")

  const { searchParams, origin } = new URL(request.url)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? origin
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const oauthError = searchParams.get("error")

  // The user cancelled the Facebook dialog or Facebook rejected the request.
  if (oauthError || !code || !state) {
    console.error("[social/instagram/callback] missing code/state or OAuth error:", oauthError)
    if (state) return redirectToBrand(appUrl, state, { ig_error: "oauth_denied" })
    return NextResponse.redirect(`${appUrl}/dashboard?ig_error=oauth_denied`)
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
    console.error("[social/instagram/callback] brand not found or not owned by user:", brandId)
    return NextResponse.redirect(`${appUrl}/dashboard?ig_error=server_error`)
  }

  const appId = process.env.META_APP_ID
  const appSecret = process.env.META_APP_SECRET
  if (!appId || !appSecret) {
    console.error("[social/instagram/callback] META_APP_ID/META_APP_SECRET not configured")
    return redirectToBrand(appUrl, brandId, { ig_error: "server_error" })
  }

  const redirectUri = `${appUrl}/api/v1/social/instagram/callback`

  try {
    // Step 1: exchange the auth code for a short-lived user access token
    const shortTokenUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`)
    shortTokenUrl.searchParams.set("client_id", appId)
    shortTokenUrl.searchParams.set("client_secret", appSecret)
    shortTokenUrl.searchParams.set("redirect_uri", redirectUri)
    shortTokenUrl.searchParams.set("code", code)

    const shortTokenRes = await fetch(shortTokenUrl.toString(), { method: "POST" })
    const shortTokenJson = await shortTokenRes.json()
    if (!shortTokenRes.ok || !shortTokenJson.access_token) {
      console.error("[social/instagram/callback] short-lived token exchange failed:", redactTokenFields(shortTokenJson))
      return redirectToBrand(appUrl, brandId, { ig_error: "token_exchange_failed" })
    }
    const shortLivedToken: string = shortTokenJson.access_token

    // Step 2: exchange the short-lived token for a long-lived (60 day) user token
    const longTokenUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`)
    longTokenUrl.searchParams.set("grant_type", "fb_exchange_token")
    longTokenUrl.searchParams.set("client_id", appId)
    longTokenUrl.searchParams.set("client_secret", appSecret)
    longTokenUrl.searchParams.set("fb_exchange_token", shortLivedToken)

    const longTokenRes = await fetch(longTokenUrl.toString())
    const longTokenJson = await longTokenRes.json()
    if (!longTokenRes.ok || !longTokenJson.access_token) {
      console.error("[social/instagram/callback] long-lived token exchange failed:", redactTokenFields(longTokenJson))
      return redirectToBrand(appUrl, brandId, { ig_error: "token_exchange_failed" })
    }
    const longLivedUserToken: string = longTokenJson.access_token

    // Step 3: list the user's Facebook Pages (each entry includes its own Page access token)
    const pagesUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`)
    pagesUrl.searchParams.set("access_token", longLivedUserToken)

    const pagesRes = await fetch(pagesUrl.toString())
    const pagesJson = await pagesRes.json()
    if (!pagesRes.ok || !Array.isArray(pagesJson.data)) {
      console.error("[social/instagram/callback] failed to list Facebook Pages:", redactTokenFields(pagesJson))
      return redirectToBrand(appUrl, brandId, { ig_error: "token_exchange_failed" })
    }
    const pages = pagesJson.data as FacebookPage[]
    if (pages.length === 0) {
      return redirectToBrand(appUrl, brandId, { ig_error: "no_pages" })
    }

    // Step 4: find the first Page that has a linked Instagram Business Account
    let igBusinessAccountId: string | null = null
    let igUsername: string | null = null
    let matchedPage: FacebookPage | null = null

    for (const page of pages) {
      const igLookupUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${page.id}`)
      igLookupUrl.searchParams.set("fields", "instagram_business_account{id,username}")
      igLookupUrl.searchParams.set("access_token", page.access_token)

      const igLookupRes = await fetch(igLookupUrl.toString())
      const igLookupJson = await igLookupRes.json()

      const igAccount = igLookupJson?.instagram_business_account
      if (igLookupRes.ok && igAccount?.id) {
        igBusinessAccountId = igAccount.id
        igUsername = igAccount.username ?? null
        matchedPage = page
        break
      }
    }

    // No Page had a linked Instagram Business Account — that's fine, fall
    // back to a Facebook-only connection using the first Page. A Facebook
    // Page and its linked Instagram account share the same Page access
    // token, so Facebook posting doesn't require an Instagram account at all.
    if (!matchedPage) {
      matchedPage = pages[0]
    }

    // Step 5: upsert the connection. Store the Page access token — it's what
    // the Graph API requires for subsequent publishing calls, for both
    // Facebook Page posts and (if linked) the Instagram Business Account.
    const tokenExpiresAt = new Date(Date.now() + LONG_LIVED_TOKEN_TTL_SECONDS * 1000).toISOString()

    const connectionData: SocialConnectionInsert = {
      brand_id: brandId,
      platform: "instagram",
      ig_business_account_id: igBusinessAccountId,
      ig_username: igUsername,
      facebook_page_id: matchedPage.id,
      access_token: matchedPage.access_token,
      token_expires_at: tokenExpiresAt,
      last_refreshed_at: new Date().toISOString(),
      is_active: true,
    }

    const { error: upsertError } = await socialConnectionsTable(supabase)
      .upsert(connectionData, { onConflict: "brand_id,platform" })

    if (upsertError) {
      console.error("[social/instagram/callback] failed to save connection:", upsertError)
      return redirectToBrand(appUrl, brandId, { ig_error: "server_error" })
    }

    return redirectToBrand(appUrl, brandId, { ig_success: igBusinessAccountId ? "1" : "partial" })
  } catch (err) {
    console.error("[social/instagram/callback] unexpected error:", err)
    return redirectToBrand(appUrl, brandId, { ig_error: "server_error" })
  }
}
