import { createAdminClient } from "@/lib/supabase/server"
import { FESTIVAL_CATALOG, type FestivalCatalogEntry, type OccasionCategory } from "./festival-catalog"

export type { OccasionCategory } from "./festival-catalog"

export type UpcomingOccasion = FestivalCatalogEntry & {
  daysUntil: number
  occurrenceDate: Date
}

/** Narrowed for the dashboard card, where category/suggestedAngle are
 * guaranteed present (see getUpcomingOccasions's filter below) rather than
 * the optional-on-the-shared-catalog types FestivalCatalogEntry declares. */
export type DashboardOccasion = UpcomingOccasion & {
  category: OccasionCategory
  suggestedAngle: string
}

/**
 * festival_id:year -> "YYYY-MM-DD", read from the cache the yearly cron
 * (app/api/v1/cron/refresh-festival-dates) writes. Read-only, cheap DB
 * query -- never calls the paid TathaAstu API directly; that only happens
 * once a year, from the cron. A read failure (table not migrated yet, RLS
 * misconfigured, etc.) degrades to every festival using its static
 * fallbackDate rather than breaking either consumer.
 */
async function loadFestivalDatesCache(years: number[]): Promise<Map<string, string>> {
  try {
    const admin = await createAdminClient()
    const { data, error } = await admin
      .from("festival_dates")
      .select("festival_id, year, occurs_on")
      .in("year", years) as { data: { festival_id: string; year: number; occurs_on: string }[] | null; error: { message: string } | null }

    if (error) {
      console.error("[get-upcoming-occasions] festival_dates read failed, falling back to hardcoded dates:", error.message)
      return new Map()
    }

    const map = new Map<string, string>()
    for (const row of data ?? []) {
      map.set(`${row.festival_id}:${row.year}`, row.occurs_on)
    }
    return map
  } catch (err) {
    console.error("[get-upcoming-occasions] festival_dates read failed, falling back to hardcoded dates:", err instanceof Error ? err.message : err)
    return new Map()
  }
}

/**
 * Shared window-matching logic both consumers build on -- the dashboard
 * card (getUpcomingOccasions, a fixed "next N days from today" window) and
 * Autopilot (lib/ai/fastlane.ts, an arbitrary start date + slot-count
 * window). Paired with its day-offset from `startDate` so results sort by
 * actual proximity, not FESTIVAL_CATALOG's declaration order -- without
 * this, any window crossing a Dec->Jan boundary surfaces New Year ahead of
 * Black Friday/Christmas even though those are chronologically sooner.
 */
export async function getFestivalOccasionsInWindow(startDate: Date, days: number): Promise<UpcomingOccasion[]> {
  const start = new Date(startDate)
  start.setHours(0, 0, 0, 0)

  const years = [start.getFullYear(), start.getFullYear() + 1]
  const cache = await loadFestivalDatesCache(years)

  const results: UpcomingOccasion[] = []

  for (const occasion of FESTIVAL_CATALOG) {
    for (const yearOffset of [0, 1]) {
      const year = start.getFullYear() + yearOffset
      const cached = cache.get(`${occasion.id}:${year}`)

      let occDate: Date
      if (cached) {
        occDate = new Date(`${cached}T00:00:00`)
      } else {
        const [mm, dd] = occasion.fallbackDate.split("-").map(Number)
        occDate = new Date(year, mm - 1, dd)
      }
      occDate.setHours(0, 0, 0, 0)

      const diffDays = Math.floor((occDate.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
      if (diffDays >= 0 && diffDays <= days) {
        results.push({ ...occasion, daysUntil: diffDays, occurrenceDate: occDate })
        break
      }
    }
  }

  return results.sort((a, b) => a.daysUntil - b.daysUntil)
}

/**
 * Dashboard's "Upcoming occasions" card (components/dashboard/
 * UpcomingOccasions.tsx). Entries without category+suggestedAngle never
 * existed for this consumer before the occasions-data.ts/indian-occasions.ts
 * merge -- filtered out here exactly as if they'd never been listed.
 */
export async function getUpcomingOccasions(daysAhead = 14): Promise<DashboardOccasion[]> {
  const all = await getFestivalOccasionsInWindow(new Date(), daysAhead)
  return all.filter((o): o is DashboardOccasion => !!o.category && !!o.suggestedAngle)
}

/**
 * Autopilot's occasionsNote prompt input (lib/ai/fastlane.ts). Entries
 * without emoji+content_angle+vibe never existed for this consumer before
 * the merge, filtered out the same way as getUpcomingOccasions above.
 */
export async function getUpcomingOccasionsForAutopilot(startDate: Date, days: number): Promise<UpcomingOccasion[]> {
  const all = await getFestivalOccasionsInWindow(startDate, days)
  return all.filter((o) => o.emoji && o.content_angle && o.vibe)
}
