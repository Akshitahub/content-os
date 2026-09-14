import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { getFestivalOccasionsInWindow, type DashboardOccasion } from "@/lib/occasions/get-upcoming-occasions"
import { z } from "zod"

// Not brand-specific or sensitive (festival dates + suggested angles are
// the same for every brand), but matches this repo's existing
// auth-on-every-route convention anyway (see app/api/v1/calendar/route.ts's
// GET). Backs components/calendar/ContentCalendar.tsx's occasion badges on
// empty days, for whatever date range the calendar currently has in view.
const querySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.coerce.number().int().min(1).max(60),
})

export async function GET(request: Request) {
  console.log("[occasions] GET called")
  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[occasions] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error initializing request."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  const { searchParams } = new URL(request.url)
  const parsed = querySchema.safeParse({
    startDate: searchParams.get("startDate"),
    days: searchParams.get("days"),
  })
  if (!parsed.success) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })
  }

  try {
    const all = await getFestivalOccasionsInWindow(new Date(parsed.data.startDate), parsed.data.days)
    // Same filter getUpcomingOccasions (lib/occasions/get-upcoming-occasions.ts)
    // already applies for its own fixed "from today" window -- replicated
    // here rather than calling that function directly since this route's
    // window is caller-supplied instead.
    const occasions = all.filter((o): o is DashboardOccasion => !!o.category && !!o.suggestedAngle)
    return NextResponse.json({ data: occasions })
  } catch (err) {
    console.error("[occasions] GET unexpected error:", err instanceof Error ? err.message : err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to fetch occasions."), { status: 500 })
  }
}
