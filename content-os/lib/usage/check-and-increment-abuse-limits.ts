import { createClient } from "@/lib/supabase/server"

export type AbuseLimitCheckResult =
  | { ok: true }
  | { ok: false; status: 429; message: string }

const DAY_MS = 24 * 60 * 60 * 1000

// Generous on purpose — these exist to bound automated abuse (storage-fill,
// spam-relay via outreach email), not to constrain a real heavy user's
// normal daily activity. Neither action costs a generation credit (that's
// the existing checkAndIncrementUsage system, scoped to AI generation cost),
// so without a limit here there was nothing bounding call frequency at all.
const SCHEDULE_POST_DAILY_LIMIT = 100
const OUTREACH_EMAIL_DAILY_LIMIT = 50

interface DailyCounterRow {
  count: number
  resetAt: string | null
}

async function checkAndIncrementDailyCounter(
  userId: string,
  select: string,
  countField: string,
  resetField: string,
  limit: number,
  limitMessage: string
): Promise<AbuseLimitCheckResult> {
  const supabase = await createClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row, error } = await (supabase.from("users") as any)
    .select(select)
    .eq("id", userId)
    .single() as { data: Record<string, number | string | null> | null; error: unknown }

  if (error || !row) {
    return { ok: false, status: 429, message: "Could not verify usage limits." }
  }

  const parsed: DailyCounterRow = {
    count: (row[countField] as number) ?? 0,
    resetAt: row[resetField] as string | null,
  }

  const resetAt = parsed.resetAt ? new Date(parsed.resetAt) : null
  const needsReset = !resetAt || resetAt <= new Date()
  const count = needsReset ? 0 : parsed.count

  if (count >= limit) {
    return { ok: false, status: 429, message: limitMessage }
  }

  const nextResetDate = new Date(Date.now() + DAY_MS)
  const updates: Record<string, unknown> = { [countField]: count + 1 }
  if (needsReset) updates[resetField] = nextResetDate.toISOString()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from("users") as any).update(updates).eq("id", userId)

  return { ok: true }
}

/** Bounds how many posts a user can schedule per day — each call re-hosts
 * an image/video to Supabase Storage, which has a real cost and no other
 * limit tied to it. */
export async function checkAndIncrementScheduleUsage(userId: string): Promise<AbuseLimitCheckResult> {
  return checkAndIncrementDailyCounter(
    userId,
    "schedule_post_count_today, schedule_post_count_reset_at",
    "schedule_post_count_today",
    "schedule_post_count_reset_at",
    SCHEDULE_POST_DAILY_LIMIT,
    `You've reached today's limit of ${SCHEDULE_POST_DAILY_LIMIT} scheduled posts. Try again tomorrow.`
  )
}

/** Bounds how many outreach emails a user can send per day — the target
 * address is user-supplied and unverified, so without a limit this app's
 * own email-sending reputation could be used to spam or phish arbitrary
 * addresses. */
export async function checkAndIncrementOutreachEmailUsage(userId: string): Promise<AbuseLimitCheckResult> {
  return checkAndIncrementDailyCounter(
    userId,
    "outreach_email_count_today, outreach_email_count_reset_at",
    "outreach_email_count_today",
    "outreach_email_count_reset_at",
    OUTREACH_EMAIL_DAILY_LIMIT,
    `You've reached today's limit of ${OUTREACH_EMAIL_DAILY_LIMIT} outreach emails. Try again tomorrow.`
  )
}
