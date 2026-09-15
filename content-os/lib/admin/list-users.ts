import { createAdminClient } from "@/lib/supabase/server"
import { isTrialActive, resolveGenerationLimit, type TrialFields } from "@/lib/usage/trial-status"
import type { UserPlan } from "@/types/app"

const PAGE_SIZE = 25

export interface AdminUserListRow {
  id: string
  email: string
  full_name: string | null
  plan: UserPlan
  plan_billing_period: "monthly" | "annual" | null
  creditsUsed: number
  creditsLimit: number
  creditsRemaining: number
  trialing: boolean
  subscribed: boolean
  last_active_at: string | null
  created_at: string
}

export interface AdminUserListResult {
  users: AdminUserListRow[]
  total: number
  page: number
  pageSize: number
}

export interface AdminUserListParams {
  /** Matched against email OR full_name, case-insensitive substring. */
  search?: string
  plan?: UserPlan
  /** 1-indexed. */
  page?: number
}

type UserListQueryRow = {
  id: string
  email: string
  full_name: string | null
  plan: UserPlan
  plan_billing_period: "monthly" | "annual" | null
  generation_count: number
  generation_count_reset_at: string | null
  trial_ends_at: string | null
  subscribed_at: string | null
  topup_credits_balance: number | null
  last_active_at: string | null
  created_at: string
}

// Postgres ILIKE wildcards ("%", "_") and PostgREST's or() filter syntax
// (",", "(", ")") both have special meaning in the raw filter string built
// below -- this is a plain substring search box, not a query language, so
// those characters are just dropped rather than escaped/rejected.
function sanitizeSearchTerm(raw: string): string {
  return raw.replace(/[%_,()]/g, "").trim()
}

/**
 * Paginated/searchable list backing app/admin/(panel)/users/page.tsx and
 * app/api/admin/users/route.ts -- the list-level counterpart to
 * lib/admin/get-user-detail.ts's per-user getAdminUserDetail. Deliberately
 * does NOT call getUserCreditSummary per row (that runs its own `users`
 * query per userId -- fine for a single detail page, an N+1 query storm
 * for a 25-row list). Instead this fetches every needed column in the one
 * list query already being paginated, then applies the exact same pure
 * calculation getUserCreditSummary uses (isTrialActive/
 * resolveGenerationLimit, same "has generation_count_reset_at passed"
 * check) directly against each row in memory.
 */
export async function getAdminUserList(params: AdminUserListParams = {}): Promise<AdminUserListResult> {
  const admin = await createAdminClient()

  const page = Math.max(1, params.page ?? 1)
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (admin.from("users") as any)
    .select(
      "id, email, full_name, plan, plan_billing_period, generation_count, generation_count_reset_at, trial_ends_at, subscribed_at, topup_credits_balance, last_active_at, created_at",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })

  if (params.plan) query = query.eq("plan", params.plan)

  const term = params.search ? sanitizeSearchTerm(params.search) : ""
  if (term) query = query.or(`email.ilike.%${term}%,full_name.ilike.%${term}%`)

  const { data, count, error } = await query.range(from, to) as {
    data: UserListQueryRow[] | null
    count: number | null
    error: { message: string } | null
  }

  if (error) {
    console.error("[admin/list-users] query failed:", error.message)
    return { users: [], total: 0, page, pageSize: PAGE_SIZE }
  }

  const now = new Date()
  const users: AdminUserListRow[] = (data ?? []).map((row) => {
    const trialFields: TrialFields = { trial_ends_at: row.trial_ends_at, subscribed_at: row.subscribed_at }
    const limit = resolveGenerationLimit(row.plan, trialFields)

    // Mirrors get-user-credit-summary.ts's own reasoning exactly:
    // generation_count_reset_at is always set to "now + 1 month" by
    // charge_generation_usage, so the only correct check is whether that
    // stored timestamp has actually passed, not a calendar-month compare.
    const resetAt = row.generation_count_reset_at ? new Date(row.generation_count_reset_at) : null
    const shouldReset = !resetAt || resetAt <= now
    const used = shouldReset ? 0 : row.generation_count
    const planRemaining = Math.max(0, limit - used)
    const topupBalance = row.topup_credits_balance ?? 0

    return {
      id: row.id,
      email: row.email,
      full_name: row.full_name,
      plan: row.plan,
      plan_billing_period: row.plan_billing_period,
      creditsUsed: used,
      creditsLimit: limit,
      creditsRemaining: planRemaining + topupBalance,
      trialing: isTrialActive(trialFields),
      subscribed: row.subscribed_at !== null,
      last_active_at: row.last_active_at,
      created_at: row.created_at,
    }
  })

  return { users, total: count ?? 0, page, pageSize: PAGE_SIZE }
}
