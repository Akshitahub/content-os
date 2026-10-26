import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import type { AutopilotRunStatusRow } from "@/types/database"
import { buildAutopilotRunResult } from "@/lib/ai/autopilot-worker"

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

  // Background Autopilot (lib/ai/autopilot-worker.ts) finishes a run from
  // the database side (finish_autopilot_run_if_done), so no request ever
  // holds the whole result. The first poll that sees it done builds the
  // same FastlaneResult the page already renders from the slot jobs, and
  // caches it on the row. Best-effort: on failure the page just shows the
  // run as done without the review list, and the next poll retries.
  if (run.status === "done" && !run.result && run.params) {
    try {
      const result = await buildAutopilotRunResult(supabase, run)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from("autopilot_run_status") as any).update({ result }).eq("id", run.id)
      return NextResponse.json({ data: { ...run, result } })
    } catch (err) {
      console.error(`[fastlane/status] building result for run ${run.id} failed:`, err instanceof Error ? err.message : err)
    }
  }

  return NextResponse.json({ data: run })
}
