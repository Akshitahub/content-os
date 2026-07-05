import type { SupabaseClient } from "@supabase/supabase-js"

export interface RoiBreakdownItem {
  type: string
  label: string
  count: number
  minutesPerItem: number
  minutesSaved: number
}

export interface RoiTracking {
  periodLabel: string
  periodStart: string
  periodEnd: string
  totalItems: number
  totalMinutesSaved: number
  totalHoursSaved: number
  breakdown: RoiBreakdownItem[]
  disclosure: string
}

export const ROI_DISCLOSURE =
  "Estimated using assumed industry-standard benchmarks for how long each content type typically takes to write by hand — not measured from your actual workflow. Actual time saved will vary."

/**
 * Assumed minutes a human would typically spend manually producing one
 * item of each content type. These are estimates for the "time saved"
 * framing shown to users — never presented as measured data.
 */
const BENCHMARKS: { type: string; table: string; label: string; minutesPerItem: number }[] = [
  { type: "hooks", table: "hooks", label: "Hooks", minutesPerItem: 5 },
  { type: "captions", table: "captions", label: "Captions", minutesPerItem: 15 },
  { type: "carousels", table: "carousels", label: "Carousels", minutesPerItem: 45 },
  { type: "stories", table: "stories", label: "Story sequences", minutesPerItem: 30 },
  { type: "reel_scripts", table: "reel_scripts", label: "Reel scripts", minutesPerItem: 60 },
  { type: "ad_copies", table: "ad_copies", label: "Ad copies", minutesPerItem: 20 },
  { type: "memes", table: "memes", label: "Memes", minutesPerItem: 15 },
  { type: "product_descriptions", table: "product_descriptions", label: "Product descriptions", minutesPerItem: 10 },
  { type: "generated_images", table: "generated_images", label: "Generated images", minutesPerItem: 20 },
]

/**
 * Counts saved content generated for this brand within [periodStart, periodEnd)
 * per content type, and multiplies by the assumed per-item time benchmark to
 * produce a "time saved" estimate. Shared by the live Analytics Dashboard and
 * the downloadable monthly PDF report so the two can never silently disagree.
 */
export async function getRoiTracking(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  brandId: string,
  periodStart: Date,
  periodEnd: Date,
  periodLabel: string
): Promise<RoiTracking> {
  const breakdown: RoiBreakdownItem[] = []

  for (const benchmark of BENCHMARKS) {
    const { count, error } = await supabase
      .from(benchmark.table)
      .select("id", { count: "exact", head: true })
      .eq("brand_id", brandId)
      .gte("created_at", periodStart.toISOString())
      .lt("created_at", periodEnd.toISOString())

    if (error) {
      console.error(`[roi-tracking] count query failed for ${benchmark.table}:`, error)
    }

    const itemCount = count ?? 0
    breakdown.push({
      type: benchmark.type,
      label: benchmark.label,
      count: itemCount,
      minutesPerItem: benchmark.minutesPerItem,
      minutesSaved: itemCount * benchmark.minutesPerItem,
    })
  }

  const totalItems = breakdown.reduce((sum, b) => sum + b.count, 0)
  const totalMinutesSaved = breakdown.reduce((sum, b) => sum + b.minutesSaved, 0)

  return {
    periodLabel,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    totalItems,
    totalMinutesSaved,
    totalHoursSaved: Math.round((totalMinutesSaved / 60) * 10) / 10,
    breakdown,
    disclosure: ROI_DISCLOSURE,
  }
}

/** The current calendar month, from day 1 through now — used as the default reporting period. */
export function currentMonthRange(): { start: Date; end: Date; label: string } {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const label = start.toLocaleString("en-US", { month: "long", year: "numeric" })
  return { start, end, label }
}
