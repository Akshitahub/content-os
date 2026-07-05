import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import type { MemeRow } from "@/types/database"

type Params = { params: Promise<{ brandId: string }> }

export async function GET(request: Request, { params }: Params) {
  console.log("[brands/memes] GET called")

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[brands/memes] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  const { brandId } = await params
  const { searchParams } = new URL(request.url)
  const savedOnly = searchParams.get("saved") !== "false"
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 100)

  const { data: brand } = await supabase.from("brands").select("id").eq("id", brandId).eq("user_id", user.id).single()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase.from("memes") as any).select("*").eq("brand_id", brandId).order("created_at", { ascending: false }).limit(limit)
    if (savedOnly) query = query.eq("is_saved", true)
    const { data, error } = await query as { data: MemeRow[] | null; error: { message: string } | null }
    if (error) {
      console.error("[brands/memes] query error:", error)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch memes."), { status: 500 })
    }
    return NextResponse.json({ data: data ?? [] })
  } catch (err) {
    console.error("[brands/memes] error:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch memes."), { status: 500 })
  }
}
