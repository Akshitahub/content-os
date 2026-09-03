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

export interface AdminUserDetail {
  profile: UserRow
  brands: Pick<BrandRow, "id" | "name" | "created_at">[]
  activity: AdminUserActivityRow[]
  purchases: AdminUserPurchaseRow[]
  creditSummary: UserCreditSummary
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

  const [brandsResult, activityResult, purchasesResult, creditSummary] = await Promise.all([
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
  ])

  return {
    profile,
    brands: brandsResult.data ?? [],
    activity: activityResult.data ?? [],
    purchases: purchasesResult.data ?? [],
    creditSummary,
  }
}
