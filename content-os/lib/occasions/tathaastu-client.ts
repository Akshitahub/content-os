const BASE_URL = "https://api.tathaastuapi.com/v1"

export interface TathaAstuFestival {
  name: string
  /** "YYYY-MM-DD" */
  date: string
}

/**
 * TathaAstu's actual JSON response shape hasn't been confirmed against a
 * live key yet (evaluated during Phase 1 via docs only, no account created
 * without the user's go-ahead) -- this parses defensively across the
 * plausible shapes a REST API like this would return, and logs clearly
 * (rather than silently returning nothing useful) if none match, so a real
 * shape mismatch is visible in cron logs instead of quietly producing an
 * empty result that looks identical to "no festivals this month."
 */
function extractFestivalList(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>
    if (Array.isArray(obj.festivals)) return obj.festivals
    if (Array.isArray(obj.data)) return obj.data
    if (Array.isArray(obj.results)) return obj.results
  }
  return null
}

function extractNameAndDate(item: unknown): TathaAstuFestival | null {
  if (!item || typeof item !== "object") return null
  const obj = item as Record<string, unknown>
  const name = obj.name ?? obj.festival ?? obj.festival_name
  const date = obj.date ?? obj.occurs_on ?? obj.matched_date
  if (typeof name === "string" && typeof date === "string" && name.trim() && date.trim()) {
    return { name, date: date.slice(0, 10) }
  }
  return null
}

/**
 * One month's worth of festivals for the given year/month, region-filtered
 * to India. Never throws -- every failure mode (missing key, network error,
 * non-200, unrecognized response shape) logs clearly and returns [], so a
 * cron run degrades to "this month contributed nothing" for that one month
 * rather than aborting the whole year's refresh.
 */
export async function fetchFestivalsForMonth(year: number, month: number): Promise<TathaAstuFestival[]> {
  const apiKey = process.env.TATHAASTU_API_KEY
  if (!apiKey) {
    console.error("[tathaastu-client] TATHAASTU_API_KEY is not configured")
    return []
  }

  const url = `${BASE_URL}/festivals/month?year=${year}&month=${month}&region=IN`

  let res: Response
  try {
    res = await fetch(url, { headers: { "X-API-Key": apiKey } })
  } catch (err) {
    console.error(`[tathaastu-client] request failed for ${year}-${month}:`, err instanceof Error ? err.message : err)
    return []
  }

  if (!res.ok) {
    console.error(`[tathaastu-client] ${year}-${month} responded ${res.status}: ${await res.text().catch(() => "(no body)")}`)
    return []
  }

  let payload: unknown
  try {
    payload = await res.json()
  } catch (err) {
    console.error(`[tathaastu-client] ${year}-${month} returned non-JSON:`, err instanceof Error ? err.message : err)
    return []
  }

  const list = extractFestivalList(payload)
  if (!list) {
    console.error(`[tathaastu-client] ${year}-${month} response shape not recognized -- check the real TathaAstu response and update extractFestivalList:`, JSON.stringify(payload).slice(0, 500))
    return []
  }

  const festivals: TathaAstuFestival[] = []
  for (const item of list) {
    const parsed = extractNameAndDate(item)
    if (parsed) festivals.push(parsed)
  }
  return festivals
}

/** All twelve months for a given year, in one place -- used by the yearly
 * refresh cron for both the current year and next year. */
export async function fetchFestivalsForYear(year: number): Promise<TathaAstuFestival[]> {
  const months = await Promise.all(
    Array.from({ length: 12 }, (_, i) => fetchFestivalsForMonth(year, i + 1))
  )
  return months.flat()
}
