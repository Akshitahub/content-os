import { createAdminClient } from "@/lib/supabase/server"

export interface AdminDashboardStats {
  usersByPlan: { starter: number; pro: number; agency: number }
  /** trial_ends_at in the future -- currently mid-trial, not yet
   * subscribed or expired. */
  trialingCount: number
  /** subscribed_at set (not null) -- has paid at least once, regardless
   * of current plan or trial state. */
  subscribedCount: number
  /** last_active_at within the last 7 days. */
  activeLast7DaysCount: number
  /** Sum of ai_generation_logs.cost_usd for the current calendar month
   * (from the 1st, in the server's local time zone, same boundary
   * app/(dashboard)/dashboard/page.tsx's own firstOfMonth uses). */
  monthCostUsd: number
}

/**
 * Overview stats for the admin panel's home page
 * (app/admin/(panel)/page.tsx). Uses createAdminClient() (service-role,
 * bypasses RLS) since this reads counts/sums across every user's row, not
 * one user's own -- there's no per-user RLS policy that would ever permit
 * this from a normal client anyway.
 */
export async function getAdminDashboardStats(): Promise<AdminDashboardStats> {
  const admin = await createAdminClient()

  const now = new Date()
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  const [
    starterResult,
    proResult,
    agencyResult,
    trialingResult,
    subscribedResult,
    activeResult,
    costResult,
  ] = await Promise.all([
    admin.from("users").select("*", { count: "exact", head: true }).eq("plan", "starter"),
    admin.from("users").select("*", { count: "exact", head: true }).eq("plan", "pro"),
    admin.from("users").select("*", { count: "exact", head: true }).eq("plan", "agency"),
    admin.from("users").select("*", { count: "exact", head: true }).gt("trial_ends_at", now.toISOString()),
    admin.from("users").select("*", { count: "exact", head: true }).not("subscribed_at", "is", null),
    admin.from("users").select("*", { count: "exact", head: true }).gte("last_active_at", sevenDaysAgo.toISOString()),
    // PostgREST aggregate select (`.sum()`) -- avoids the alternative of
    // fetching every ai_generation_logs.cost_usd row for the month and
    // reducing client-side, which would silently under-report past
    // Supabase's default 1000-row cap on any month with real volume.
    // Not in the generated Database type (supabase gen types doesn't
    // model aggregate selects) -- same `as any` pattern already used
    // elsewhere in this codebase for query shapes outside the strict
    // generated types. Never throws: a failure here (e.g. if this
    // project's PostgREST doesn't have aggregate functions enabled) is
    // logged and degrades monthCostUsd to 0 rather than breaking the
    // whole overview page.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin.from("ai_generation_logs") as any)
      .select("total:cost_usd.sum()")
      .gte("created_at", firstOfMonth.toISOString())
      .single(),
  ])

  if (costResult.error) {
    console.error("[admin/dashboard-stats] cost_usd sum query failed:", costResult.error.message)
  }

  return {
    usersByPlan: {
      starter: starterResult.count ?? 0,
      pro: proResult.count ?? 0,
      agency: agencyResult.count ?? 0,
    },
    trialingCount: trialingResult.count ?? 0,
    subscribedCount: subscribedResult.count ?? 0,
    activeLast7DaysCount: activeResult.count ?? 0,
    monthCostUsd: (costResult.data as { total: number | null } | null)?.total ?? 0,
  }
}
