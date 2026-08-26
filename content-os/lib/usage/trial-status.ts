import { PLAN_LIMITS, type UserPlan } from "@/types/app"
import { TRIAL_CREDIT_CAP } from "./credit-costs"

/**
 * `plan` always resolves to a real paid tier (see PLAN_LIMITS in
 * types/app.ts) — trial-vs-subscribed status is tracked orthogonally via
 * these two nullable columns (added in supabase/migrations/038 and set at
 * signup in 039). This is the one place that distinction gets interpreted,
 * so every caller (usage charging, UI copy, upgrade-vs-subscribe buttons)
 * reads it the same way.
 */
export interface TrialFields {
  trial_ends_at: string | null
  subscribed_at: string | null
}

/** A real Razorpay payment (lib/billing/apply-plan-upgrade.ts) sets
 * subscribed_at exactly once, permanently — once set, this user is never
 * trial-gated again regardless of trial_ends_at. */
export function isSubscribed(user: TrialFields): boolean {
  return user.subscribed_at !== null
}

/** True only while genuinely trialing: not subscribed, and the 7-day
 * window hasn't passed. A null trial_ends_at on an unsubscribed account
 * (shouldn't happen for any row created after migration 039, but covers
 * rows that predate it or were created outside the normal signup trigger)
 * fails closed as expired rather than granting an infinite trial. */
export function isTrialActive(user: TrialFields): boolean {
  if (isSubscribed(user)) return false
  if (!user.trial_ends_at) return false
  return new Date(user.trial_ends_at).getTime() > Date.now()
}

/** Not subscribed AND the trial is over (or never properly started) —
 * every credit-charging action should block here until the user
 * subscribes to a real plan. */
export function isTrialExpired(user: TrialFields): boolean {
  return !isSubscribed(user) && !isTrialActive(user)
}

/** The credit ceiling this billing cycle actually enforces: the trial's
 * reduced cap while trialing, the real plan pool once subscribed. The
 * single place lib/usage/check-and-increment-usage.ts and every route
 * that needs to preview "how many credits do they have" (e.g. Autopilot's
 * upsell screen) should read this from, so they can never disagree. */
export function resolveGenerationLimit(plan: UserPlan, user: TrialFields): number {
  return isTrialActive(user) ? TRIAL_CREDIT_CAP : PLAN_LIMITS[plan].generations
}
