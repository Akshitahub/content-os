// Comma-separated Supabase auth user IDs (uuid) that bypass all plan-based
// restrictions — generation-credit quota, reel quota, brand/product caps,
// Autopilot tier scaling, Pro/Agency-only social-platform gating. User ID
// rather than email: it's immutable (an email can be changed by the user),
// and every call site already has `user.id` on hand from
// supabase.auth.getUser(), so no extra lookup is needed anywhere this is
// checked. This does NOT touch users.plan, PLAN_LIMITS, or billing/webhook
// logic — it's a pure runtime bypass layered on top of normal enforcement.
// See .env.local.example for the INTERNAL_UNLIMITED_USER_IDS var itself.
const INTERNAL_UNLIMITED_USER_IDS = new Set(
  (process.env.INTERNAL_UNLIMITED_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
)

export function isInternalUnlimited(userId: string): boolean {
  return INTERNAL_UNLIMITED_USER_IDS.has(userId)
}
