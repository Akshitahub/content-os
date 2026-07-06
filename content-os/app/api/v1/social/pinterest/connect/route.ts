import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"

const PINTEREST_SCOPES = ["pins:write", "boards:read", "user_accounts:read"].join(",")

export async function GET(request: Request) {
  console.log("[social/pinterest/connect] GET called")

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

  const pinterestAppId = process.env.PINTEREST_APP_ID
  if (!pinterestAppId) {
    console.error("[social/pinterest/connect] PINTEREST_APP_ID is not configured")
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Pinterest connect is not configured."), { status: 500 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? origin
  const redirectUri = `${appUrl}/api/v1/social/pinterest/callback`

  const dialogUrl = new URL("https://www.pinterest.com/oauth/")
  dialogUrl.searchParams.set("client_id", pinterestAppId)
  dialogUrl.searchParams.set("redirect_uri", redirectUri)
  dialogUrl.searchParams.set("scope", PINTEREST_SCOPES)
  dialogUrl.searchParams.set("state", brandId)
  dialogUrl.searchParams.set("response_type", "code")

  return NextResponse.redirect(dialogUrl.toString())
}
