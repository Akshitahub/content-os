import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { refreshFestivalDatesForYear } from "@/lib/occasions/resolve-and-cache-festival-dates"

// One TathaAstu call per month per year (24 requests for current+next year),
// each a plain fetch -- generous headroom under this maxDuration even on a
// slow day.
export const maxDuration = 60

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const authHeader = request.headers.get("authorization")
  if (authHeader === `Bearer ${secret}`) return true

  const { searchParams } = new URL(request.url)
  return searchParams.get("secret") === secret
}

/**
 * Refreshes the festival_dates cache for the current year and next year --
 * this data changes once a year (a festival's date for a given year never
 * changes once it's happened), so there's no reason to hit TathaAstu (a
 * paid external API) more often than that. Fetching next year too, every
 * time this runs, means the cache always has next year's dates ready well
 * before December 31st -- not just from this run but from EVERY prior
 * year's run, so a Dec->Jan boundary never finds a gap even if this cron
 * is ever delayed or misses a run.
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    console.error("[cron/refresh-festival-dates] unauthorized request")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  console.log("[cron/refresh-festival-dates] GET called")

  const admin = await createAdminClient()
  const currentYear = new Date().getFullYear()

  const results = await Promise.all([
    refreshFestivalDatesForYear(admin, currentYear),
    refreshFestivalDatesForYear(admin, currentYear + 1),
  ])

  console.log("[cron/refresh-festival-dates] done:", results)
  return NextResponse.json({ data: results })
}
