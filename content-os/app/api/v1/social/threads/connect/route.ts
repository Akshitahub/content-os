import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"

const THREADS_SCOPES = ["threads_basic", "threads_content_publish"].join(",")

export async function GET(request: Request) {
  console.log("[social/threads/connect] GET called")

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

  const threadsAppId = process.env.THREADS_APP_ID
  if (!threadsAppId) {
    console.error("[social/threads/connect] THREADS_APP_ID is not configured")
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Threads connect is not configured."), { status: 500 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? origin
  const redirectUri = `${appUrl}/api/v1/social/threads/callback`

  const dialogUrl = new URL("https://threads.net/oauth/authorize")
  dialogUrl.searchParams.set("client_id", threadsAppId)
  dialogUrl.searchParams.set("redirect_uri", redirectUri)
  dialogUrl.searchParams.set("scope", THREADS_SCOPES)
  dialogUrl.searchParams.set("state", brandId)
  dialogUrl.searchParams.set("response_type", "code")

  return NextResponse.redirect(dialogUrl.toString())
}
