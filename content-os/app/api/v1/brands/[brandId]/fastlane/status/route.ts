import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import type { AutopilotRunStatusRow } from "@/types/database"

type RouteParams = { params: Promise<{ brandId: string }> }

// What the frontend checks on mount (and polls while a run is 'running')
// to recover visibility into an Autopilot run after a navigation away —
// see app/(dashboard)/brands/[brandId]/fastlane/page.tsx. Rows older than
// this are treated the same as "no recent run" (returns null): the point
// is resuming a run that's still going or just finished, not surfacing
// history — that's what the Calendar itself is for.
const RECENT_WINDOW_MS = 4 * 60 * 60 * 1000

export async function GET(request: Request, { params }: RouteParams) {
  const { brandId } = await params

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  }

  const { data: brand } = await supabase
    .from("brands")
    .select("id")
    .eq("id", brandId)
    .eq("user_id", user.id)
    .single<{ id: string }>()

  if (!brand) {
    return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  }

  const { data: run } = await supabase
    .from("autopilot_run_status")
    .select("*")
    .eq("brand_id", brandId)
    .eq("user_id", user.id)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle<AutopilotRunStatusRow>()

  if (!run || Date.now() - new Date(run.started_at).getTime() > RECENT_WINDOW_MS) {
    return NextResponse.json({ data: null })
  }

  return NextResponse.json({ data: run })
}
