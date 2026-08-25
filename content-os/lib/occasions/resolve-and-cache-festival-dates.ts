import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { FESTIVAL_CATALOG } from "./festival-catalog"
import { fetchFestivalsForYear, type TathaAstuFestival } from "./tathaastu-client"

type AdminClient = SupabaseClient<Database>

function normalizeForMatch(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function findMatch(variants: string[], festivals: TathaAstuFestival[]): TathaAstuFestival | null {
  const normalizedVariants = variants.map(normalizeForMatch)
  for (const festival of festivals) {
    const normalizedName = normalizeForMatch(festival.name)
    if (normalizedVariants.some((v) => normalizedName === v || normalizedName.includes(v))) {
      return festival
    }
  }
  return null
}

export interface RefreshYearSummary {
  year: number
  resolved: number
  fallback: number
  total: number
}

/**
 * Resolves every resolveViaApi festival in FESTIVAL_CATALOG for one year
 * and upserts the result into festival_dates -- 'api' rows when TathaAstu
 * had a match, 'fallback' rows (using the catalog's static MM-DD) when it
 * didn't, logged loudly via console.warn so a fallback is visible in cron
 * logs rather than silently indistinguishable from a real API-sourced date.
 * Called by app/api/v1/cron/refresh-festival-dates for the current year and
 * next year, once a year -- this is the only code path that ever calls the
 * paid TathaAstu API; both consumers (dashboard card, Autopilot prompt)
 * only ever read the cache this writes.
 */
export async function refreshFestivalDatesForYear(admin: AdminClient, year: number): Promise<RefreshYearSummary> {
  const festivals = await fetchFestivalsForYear(year)

  const toResolve = FESTIVAL_CATALOG.filter((f) => f.resolveViaApi)
  let resolved = 0
  let fallback = 0

  const rows: Database["public"]["Tables"]["festival_dates"]["Insert"][] = []

  for (const entry of toResolve) {
    const match = entry.apiNameVariants ? findMatch(entry.apiNameVariants, festivals) : null

    if (match) {
      resolved++
      rows.push({ festival_id: entry.id, year, occurs_on: match.date, source: "api" })
    } else {
      fallback++
      console.warn(`[resolve-and-cache-festival-dates] no TathaAstu match for "${entry.name}" (${entry.id}) in ${year} -- using fallback date ${entry.fallbackDate}`)
      const [mm, dd] = entry.fallbackDate.split("-")
      rows.push({ festival_id: entry.id, year, occurs_on: `${year}-${mm}-${dd}`, source: "fallback" })
    }
  }

  if (rows.length > 0) {
    // .from("festival_dates") infers to `never` here the same way every
    // other admin-client call against a newer table does in this codebase
    // (see e.g. app/api/v1/cron/cleanup-abandoned-drafts/route.ts's own
    // `table()` cast helper) -- the manual Database scaffold in
    // types/database.ts doesn't give @supabase/supabase-js enough to infer
    // .upsert()'s argument type on its own.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin.from("festival_dates") as any)
      .upsert(rows, { onConflict: "festival_id,year" })

    if (error) {
      console.error(`[resolve-and-cache-festival-dates] upsert failed for ${year}:`, error.message)
    }
  }

  return { year, resolved, fallback, total: toResolve.length }
}
