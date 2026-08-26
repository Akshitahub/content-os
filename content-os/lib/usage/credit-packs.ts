/**
 * One-time credit top-up packs (2026-08-26 pricing revision) — a separate
 * purchase from a monthly plan, same spirit as PLAN_LIMITS/credit-costs.ts:
 * one place these numbers live, read by both the checkout route
 * (app/api/v1/billing/create-topup-checkout-session/route.ts) and any UI
 * that lists the packs (Settings' "Buy more credits"), so they can never
 * drift apart.
 *
 * `price` is in whole rupees, same convention as PLAN_LIMITS.price — the
 * checkout route converts to paise for Razorpay itself.
 *
 * Top-up credits never expire (roll over indefinitely) and are drawn from
 * only after the monthly plan pool is exhausted — see
 * supabase/migrations/040_credit_topups.sql's charge_generation_usage,
 * the one place that spending order is implemented.
 */
export type CreditPackId = "quick_topup" | "power_pack" | "mega_pack"

export interface CreditPack {
  id: CreditPackId
  name: string
  credits: number
  price: number
}

export const CREDIT_PACKS: Record<CreditPackId, CreditPack> = {
  quick_topup: { id: "quick_topup", name: "Quick Top-Up", credits: 100, price: 249 },
  power_pack: { id: "power_pack", name: "Power Pack", credits: 200, price: 449 },
  mega_pack: { id: "mega_pack", name: "Mega Pack", credits: 500, price: 999 },
}

export const CREDIT_PACK_IDS = Object.keys(CREDIT_PACKS) as CreditPackId[]
