import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import type { CalendarEntryRow } from "@/types/database"
import { z } from "zod"

type RouteParams = { params: Promise<{ brandId: string }> }

const bulkScheduleSchema = z.object({
  entryIds: z.array(z.string().uuid()).min(1).max(100),
})

// Reasonable engagement-window defaults per platform — not scientifically
// tuned, just a sane starting point for a first version. Only applied when
// an entry doesn't already have its own scheduled_time.
const DEFAULT_POST_TIMES: Record<string, string> = {
  instagram: "11:00:00",
  facebook: "11:00:00",
  linkedin: "09:00:00",
  youtube: "14:00:00",
}
const FALLBACK_POST_TIME = "12:00:00"

function defaultScheduledTime(platform: string | null): string {
  if (!platform) return FALLBACK_POST_TIME
  return DEFAULT_POST_TIMES[platform] ?? FALLBACK_POST_TIME
}

export async function POST(request: Request, { params }: RouteParams) {
  const { brandId } = await params
  console.log("[brands/calendar/bulk-schedule] POST called")

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[brands/calendar/bulk-schedule] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  const { data: brand } = await supabase.from("brands").select("id, user_id").eq("id", brandId).single<{ id: string; user_id: string }>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  if (brand.user_id !== user.id) return NextResponse.json(buildError(ErrorCodes.UNAUTHORIZED, "You do not have access to this brand."), { status: 403 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = bulkScheduleSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })

  const { entryIds } = parsed.data

  try {
    // Scope strictly to this brand — never trust entryIds blindly, an id
    // belonging to another brand simply won't come back from this query.
    const { data: candidates, error: fetchError } = await supabase
      .from("calendar_entries")
      .select("id, platform, scheduled_time, status")
      .eq("brand_id", brandId)
      .in("id", entryIds)
      .returns<Pick<CalendarEntryRow, "id" | "platform" | "scheduled_time" | "status">[]>()

    if (fetchError) {
      console.error("[brands/calendar/bulk-schedule] fetch error:", fetchError)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to load calendar entries.", fetchError.message), { status: 500 })
    }

    const eligible = (candidates ?? []).filter((c) => c.status === "content_ready")
    let skipped = (candidates ?? []).length - eligible.length
    // Any requested id that didn't come back at all (wrong brand, or doesn't exist) also counts as skipped.
    skipped += entryIds.length - (candidates ?? []).length

    const scheduledIds: string[] = []

    const results = await Promise.allSettled(
      eligible.map(async (entry) => {
        const scheduledTime = entry.scheduled_time ?? defaultScheduledTime(entry.platform)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: updateError } = await (supabase.from("calendar_entries") as any)
          .update({ status: "scheduled", scheduled_time: scheduledTime, updated_at: new Date().toISOString() })
          .eq("id", entry.id)
          .eq("brand_id", brandId)

        if (updateError) throw new Error(updateError.message)
        return entry.id
      })
    )

    for (const result of results) {
      if (result.status === "fulfilled") {
        scheduledIds.push(result.value)
      } else {
        skipped++
        console.error("[brands/calendar/bulk-schedule] entry update failed:", result.reason)
      }
    }

    return NextResponse.json({
      data: { scheduled: scheduledIds.length, skipped, scheduledIds },
    })
  } catch (err) {
    console.error("[brands/calendar/bulk-schedule] unexpected error:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to schedule entries."), { status: 500 })
  }
}
