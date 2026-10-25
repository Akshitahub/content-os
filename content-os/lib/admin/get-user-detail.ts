import { createAdminClient } from "@/lib/supabase/server"
import { getUserCreditSummary, type UserCreditSummary } from "@/lib/usage/get-user-credit-summary"
import type { UserRow, BrandRow } from "@/types/database"

export type AdminUserActivityRow = {
  id: string
  feature: string
  model: string
  cost_usd: number | null
  credits_charged: number | null
  success: boolean
  error_message: string | null
  created_at: string
}

export type AdminUserPurchaseRow = {
  id: string
  pack_id: string
  credits: number
  amount_paid: number
  razorpay_payment_id: string
  purchased_at: string
}

/** One Post's total spend, from the ai_generation_cost_by_project view
 * (supabase/migrations/056_ai_generation_logs_content_project.sql). */
export type AdminPostCostRow = {
  content_project_id: string
  title: string | null
  log_rows: number
  failed_rows: number
  total_cost_usd: number | null
  total_tokens: number | null
  total_latency_ms: number | null
  last_logged_at: string
}

export interface AdminUserDetail {
  profile: UserRow
  brands: Pick<BrandRow, "id" | "name" | "created_at">[]
  activity: AdminUserActivityRow[]
  purchases: AdminUserPurchaseRow[]
  creditSummary: UserCreditSummary
  /** null when the view doesn't exist yet (migration 056 not run) --
   * the page says so instead of showing an empty table. */
  postCosts: AdminPostCostRow[] | null
}

// Most recent 20 Posts' totals for this user, with their titles. Never
// throws: a missing view (migration 056 not run yet) or any other error
// returns null and the rest of the page renders normally.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getPostCosts(admin: any, userId: string): Promise<AdminPostCostRow[] | null> {
  const { data, error } = await admin
    .from("ai_generation_cost_by_project")
    .select("content_project_id, log_rows, failed_rows, total_cost_usd, total_tokens, total_latency_ms, last_logged_at")
    .eq("user_id", userId)
    .order("last_logged_at", { ascending: false })
    .limit(20)
  if (error) {
    console.error("[admin/get-user-detail] per-post cost query failed (migration 056 not run?):", error.message)
    return null
  }
  const rows = (data ?? []) as Omit<AdminPostCostRow, "title">[]
  if (rows.length === 0) return []

  const { data: projects } = await admin
    .from("content_projects")
    .select("id, title")
    .in("id", rows.map((r) => r.content_project_id))
  const titleById = new Map(((projects ?? []) as { id: string; title: string }[]).map((p) => [p.id, p.title]))

  // numeric/bigint aggregates can arrive as strings depending on
  // PostgREST settings -- normalized to numbers here.
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  return rows.map((r) => ({
    ...r,
    title: titleById.get(r.content_project_id) ?? null,
    log_rows: Number(r.log_rows),
    failed_rows: Number(r.failed_rows),
    total_cost_usd: num(r.total_cost_usd),
    total_tokens: num(r.total_tokens),
    total_latency_ms: num(r.total_latency_ms),
  }))
}

/**
 * Shared by app/api/admin/users/[id]/route.ts and
 * app/admin/(panel)/users/[id]/page.tsx so the actual queries live in one
 * place -- the page calls this directly (it's already a Server Component
 * inside app/admin/(panel)/layout.tsx, which has already re-verified the
 * admin session, so an internal fetch to the API route would just repeat
 * that check for no benefit), the route calls it after its own session
 * check for anything else that wants this over HTTP. Returns null when
 * the user id doesn't exist, rather than throwing.
 */
export async function getAdminUserDetail(userId: string): Promise<AdminUserDetail | null> {
  const admin = await createAdminClient()

  const { data: profile } = await admin
    .from("users")
    .select("*")
    .eq("id", userId)
    .single<UserRow>()

  if (!profile) return null

  const [brandsResult, activityResult, purchasesResult, creditSummary, postCosts] = await Promise.all([
    admin
      .from("brands")
      .select("id, name, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .returns<Pick<BrandRow, "id" | "name" | "created_at">[]>(),
    admin
      .from("ai_generation_logs")
      .select("id, feature, model, cost_usd, credits_charged, success, error_message, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20)
      .returns<AdminUserActivityRow[]>(),
    admin
      .from("credit_purchases")
      .select("id, pack_id, credits, amount_paid, razorpay_payment_id, purchased_at")
      .eq("user_id", userId)
      .order("purchased_at", { ascending: false })
      .returns<AdminUserPurchaseRow[]>(),
    // Same server-side function hooks/useUserCredits.ts's own route
    // (app/api/v1/user/profile/route.ts) uses -- reused here, not
    // reimplemented, via the admin (service-role) client instead of the
    // logged-in user's own RLS-scoped one.
    getUserCreditSummary(admin, userId),
    getPostCosts(admin, userId),
  ])

  return {
    profile,
    brands: brandsResult.data ?? [],
    activity: activityResult.data ?? [],
    purchases: purchasesResult.data ?? [],
    creditSummary,
    postCosts,
  }
}
