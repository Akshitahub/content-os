// Deployment check: 2026-07-03
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"

const META_OAUTH_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
  "pages_manage_posts",
].join(",")

export async function GET(request: Request) {
  console.log("[social/instagram/connect] GET called")

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
    .select("id, user_id")
    .eq("id", brandId)
    .single<{ id: string; user_id: string }>()

  if (!brand) {
    return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  }
  if (brand.user_id !== user.id) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "You do not have access to this brand."), { status: 403 })
  }

  const appId = process.env.META_APP_ID
  if (!appId) {
    console.error("[social/instagram/connect] META_APP_ID is not configured")
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Instagram connect is not configured."), { status: 500 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? origin
  const redirectUri = `${appUrl}/api/v1/social/instagram/callback`

  const dialogUrl = new URL("https://www.facebook.com/v21.0/dialog/oauth")
  dialogUrl.searchParams.set("client_id", appId)
  dialogUrl.searchParams.set("redirect_uri", redirectUri)
  dialogUrl.searchParams.set("scope", META_OAUTH_SCOPES)
  dialogUrl.searchParams.set("state", brandId)
  dialogUrl.searchParams.set("response_type", "code")

  return NextResponse.redirect(dialogUrl.toString())
}
