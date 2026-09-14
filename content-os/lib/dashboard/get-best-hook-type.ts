import { createClient } from "@/lib/supabase/server"
import type { HookRow } from "@/types/database"

// Don't declare a "best" hook type off a single lucky rating -- this is
// the threshold below which a type's average isn't meaningful.
const MIN_RATED_HOOKS_PER_TYPE = 3

export interface BestHookType {
  hookType: string
  avgRating: number
}

/**
 * Highest-averaging hook_type (by user_rating) across the given brands
 * this calendar month, among types with at least MIN_RATED_HOOKS_PER_TYPE
 * rated hooks. Returns null when there's no qualifying data -- the
 * dashboard card simply doesn't render rather than showing a fake result.
 * Never throws: runs inside a Server Component render.
 */
export async function getBestHookType(brandIds: string[]): Promise<BestHookType | null> {
  if (brandIds.length === 0) return null

  try {
    const supabase = await createClient()
    const now = new Date()
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    const { data, error } = await supabase
      .from("hooks")
      .select("hook_type, user_rating")
      .in("brand_id", brandIds)
      .not("user_rating", "is", null)
      .gte("created_at", firstOfMonth.toISOString()) as {
        data: Pick<HookRow, "hook_type" | "user_rating">[] | null
        error: { message: string } | null
      }

    if (error || !data) return null

    const byType = new Map<string, { sum: number; count: number }>()
    for (const row of data) {
      if (!row.hook_type || row.user_rating === null) continue
      const entry = byType.get(row.hook_type) ?? { sum: 0, count: 0 }
      entry.sum += row.user_rating
      entry.count += 1
      byType.set(row.hook_type, entry)
    }

    let best: BestHookType | null = null
    for (const [hookType, { sum, count }] of byType) {
      if (count < MIN_RATED_HOOKS_PER_TYPE) continue
      const avgRating = sum / count
      if (!best || avgRating > best.avgRating) best = { hookType, avgRating }
    }
    return best
  } catch (err) {
    console.error("[get-best-hook-type] unexpected error:", err instanceof Error ? err.message : err)
    return null
  }
}
