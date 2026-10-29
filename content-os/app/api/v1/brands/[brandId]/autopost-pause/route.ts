import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { scheduledEntryDueAt } from "@/lib/utils/ist"

type Params = { params: Promise<{ brandId: string }> }

// Brand-level "pause autoposting" kill switch (062_brand_autopost_pause.sql).
// Pausing only stops publishing -- the publish cron leaves this brand's due
// entries alone (app/api/v1/cron/publish-scheduled/route.ts); generation and
// approval keep working.

const MISSED_WHILE_PAUSED = "Skipped while autoposting was paused"

const bodySchema = z.object({ paused: z.boolean() })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function authorize(supabase: any, brandId: string) {
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 }) }
  const { data: brand, error } = await supabase
    .from("brands")
    .select("id, autopost_paused_at")
    .eq("id", brandId)
    .eq("user_id", user.id)
    .maybeSingle() as { data: { id: string; autopost_paused_at: string | null } | null; error: { message: string } | null }
  if (error) {
    console.error(`[brands/autopost-pause] brand ${brandId}: lookup failed:`, error.message)
    return { error: NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't load autoposting state."), { status: 500 }) }
  }
  if (!brand) return { error: NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 }) }
  return { brand }
}

async function scheduledCount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  brandId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("calendar_entries")
    .select("id", { count: "exact", head: true })
    .eq("brand_id", brandId)
    .eq("status", "scheduled")
  if (error) console.error(`[brands/autopost-pause] brand ${brandId}: scheduled count failed:`, error.message)
  return count ?? 0
}

/** { paused, paused_at, scheduled_count } -- scheduled_count is what a pause would hold. */
export async function GET(_request: Request, { params }: Params) {
  const { brandId } = await params
  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[brands/autopost-pause] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }
  const auth = await authorize(supabase, brandId)
  if ("error" in auth) return auth.error

  return NextResponse.json({
    data: {
      paused: !!auth.brand.autopost_paused_at,
      paused_at: auth.brand.autopost_paused_at,
      scheduled_count: await scheduledCount(supabase, brandId),
    },
  })
}

/**
 * { paused: true } sets autopost_paused_at. { paused: false } first marks
 * this brand's scheduled entries that came due while paused as "missed"
 * (so nothing publishes late, all at once), then clears the pause. Returns
 * how many were marked missed.
 */
export async function POST(request: Request, { params }: Params) {
  const { brandId } = await params
  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[brands/autopost-pause] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }
  const auth = await authorize(supabase, brandId)
  if ("error" in auth) return auth.error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.issues[0]?.message), { status: 400 })

  if (parsed.data.paused) {
    // Already paused keeps its original timestamp.
    const pausedAt = auth.brand.autopost_paused_at ?? new Date().toISOString()
    if (!auth.brand.autopost_paused_at) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from("brands") as any).update({ autopost_paused_at: pausedAt }).eq("id", brandId)
      if (error) {
        console.error(`[brands/autopost-pause] brand ${brandId}: pause failed:`, error.message)
        return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't pause autoposting. Please try again."), { status: 500 })
      }
      console.log(`[brands/autopost-pause] brand ${brandId}: autoposting paused`)
    }
    return NextResponse.json({ data: { paused: true, paused_at: pausedAt, missed_count: 0 } })
  }

  // Resume. Not paused -> nothing to do (the cron publishes due entries as usual).
  if (!auth.brand.autopost_paused_at) {
    return NextResponse.json({ data: { paused: false, paused_at: null, missed_count: 0 } })
  }

  const { data: scheduled, error: listError } = await supabase
    .from("calendar_entries")
    .select("id, scheduled_date, scheduled_time")
    .eq("brand_id", brandId)
    .eq("status", "scheduled") as { data: { id: string; scheduled_date: string; scheduled_time: string | null }[] | null; error: { message: string } | null }
  if (listError) {
    console.error(`[brands/autopost-pause] brand ${brandId}: listing scheduled entries failed:`, listError.message)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't resume autoposting. Please try again."), { status: 500 })
  }

  // Same IST due-time parsing the publish cron uses.
  const now = Date.now()
  const overdueIds = (scheduled ?? []).filter((e) => scheduledEntryDueAt(e.scheduled_date, e.scheduled_time).getTime() < now).map((e) => e.id)

  let missedCount = 0
  if (overdueIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: missed, error: missError } = await (supabase.from("calendar_entries") as any)
      .update({ status: "missed", error_message: MISSED_WHILE_PAUSED, updated_at: new Date().toISOString() })
      .in("id", overdueIds)
      // Only entries still scheduled -- never overwrite one that changed meanwhile.
      .eq("status", "scheduled")
      .select("id") as { data: { id: string }[] | null; error: { message: string } | null }
    if (missError) {
      // Still paused: clearing the pause now would publish them all late.
      console.error(`[brands/autopost-pause] brand ${brandId}: marking ${overdueIds.length} overdue entries missed failed:`, missError.message)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't resume autoposting. Please try again."), { status: 500 })
    }
    missedCount = missed?.length ?? 0
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: resumeError } = await (supabase.from("brands") as any).update({ autopost_paused_at: null }).eq("id", brandId)
  if (resumeError) {
    console.error(`[brands/autopost-pause] brand ${brandId}: resume failed after marking ${missedCount} missed:`, resumeError.message)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't resume autoposting. Please try again."), { status: 500 })
  }

  console.log(`[brands/autopost-pause] brand ${brandId}: autoposting resumed, ${missedCount} overdue entr${missedCount === 1 ? "y" : "ies"} marked missed`)
  return NextResponse.json({ data: { paused: false, paused_at: null, missed_count: missedCount } })
}
