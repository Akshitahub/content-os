import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { sendNoBrandNudgeEmail, sendInactivityNudgeEmail } from "@/lib/email/resend"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

// Both queries below are cheap point-lookups against small candidate sets
// (a 24h-wide signup window, and however many accounts happen to cross
// the 14-day inactivity mark on a given day) -- nothing here scans the
// whole users table per row, so a generous but bounded ceiling is enough.
export const maxDuration = 60

const NO_BRAND_MIN_HOURS = 24
const NO_BRAND_MAX_HOURS = 48
const INACTIVITY_DAYS = 14

type AdminClient = SupabaseClient<Database>

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const authHeader = request.headers.get("authorization")
  if (authHeader === `Bearer ${secret}`) return true

  const { searchParams } = new URL(request.url)
  return searchParams.get("secret") === secret
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function table(admin: AdminClient, name: string): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (admin as any).from(name)
}

interface LifecycleCandidate {
  id: string
  email: string | null
  full_name: string | null
}

/**
 * The most recent content_projects.title across a user's brands, for the
 * inactivity email's "here's what you were working on" copy — content_
 * projects only has brand_id, not user_id, so this is two queries (the
 * user's brand ids, then the newest project across them) rather than one
 * join, matching how the rest of this codebase talks to Supabase (no
 * PostgREST embedding used elsewhere). Returns null for an account that
 * never generated anything, or on any lookup failure -- the caller
 * already has generic fallback copy for that case.
 */
async function getLastContentTitle(admin: AdminClient, userId: string): Promise<string | null> {
  const { data: brands } = await table(admin, "brands").select("id").eq("user_id", userId) as { data: { id: string }[] | null }
  const brandIds = (brands ?? []).map((b) => b.id)
  if (brandIds.length === 0) return null

  const { data: projects } = await table(admin, "content_projects")
    .select("title")
    .in("brand_id", brandIds)
    .order("created_at", { ascending: false })
    .limit(1) as { data: { title: string }[] | null }

  return projects?.[0]?.title ?? null
}

/**
 * "No brand yet" nudge: users.created_at is 24-48h in the past AND no
 * brands row exists for that user_id yet. The 24-48h window (not "ever,
 * anytime after 24h") is what naturally caps this to firing once per
 * user without needing the sent-tracking column to do that job alone --
 * no_brand_nudge_sent_at is still checked as the real guard, since a
 * user could otherwise re-enter the window on a retried/overlapping cron
 * run.
 */
async function sendNoBrandNudges(admin: AdminClient): Promise<{ sent: number; targetedUserIds: Set<string> }> {
  const now = Date.now()
  const windowStart = new Date(now - NO_BRAND_MAX_HOURS * 60 * 60 * 1000).toISOString()
  const windowEnd = new Date(now - NO_BRAND_MIN_HOURS * 60 * 60 * 1000).toISOString()

  const { data: candidates, error } = await table(admin, "users")
    .select("id, email, full_name")
    .gte("created_at", windowStart)
    .lte("created_at", windowEnd)
    .is("no_brand_nudge_sent_at", null)
    .eq("marketing_emails_opted_out", false) as { data: LifecycleCandidate[] | null; error: { message: string } | null }

  if (error) {
    console.error("[cron/send-lifecycle-emails] no-brand candidate query failed:", error.message)
    return { sent: 0, targetedUserIds: new Set() }
  }

  const targetedUserIds = new Set<string>()
  if (!candidates || candidates.length === 0) return { sent: 0, targetedUserIds }

  const candidateIds = candidates.map((c) => c.id)
  const { data: brandRows, error: brandsError } = await table(admin, "brands")
    .select("user_id")
    .in("user_id", candidateIds) as { data: { user_id: string }[] | null; error: { message: string } | null }

  if (brandsError) {
    console.error("[cron/send-lifecycle-emails] brands lookup failed, skipping no-brand nudges this run to be safe:", brandsError.message)
    return { sent: 0, targetedUserIds }
  }

  const usersWithBrands = new Set((brandRows ?? []).map((b) => b.user_id))
  const targets = candidates.filter((c) => !usersWithBrands.has(c.id))

  let sent = 0
  for (const target of targets) {
    if (!target.email) continue
    try {
      await sendNoBrandNudgeEmail(target.id, target.email, target.full_name ?? undefined)
      const { error: markError } = await table(admin, "users")
        .update({ no_brand_nudge_sent_at: new Date().toISOString() })
        .eq("id", target.id)
      if (markError) {
        console.error(`[cron/send-lifecycle-emails] failed to mark no_brand_nudge_sent_at for ${target.id}:`, markError.message)
        continue
      }
      targetedUserIds.add(target.id)
      sent++
    } catch (err) {
      console.error(`[cron/send-lifecycle-emails] no-brand nudge failed for ${target.id}:`, err instanceof Error ? err.message : err)
    }
  }

  return { sent, targetedUserIds }
}

/**
 * "We miss you" nudge: last_active_at is 14+ days in the past. Send-once-
 * EVER per the task spec (inactivity_nudge_sent_at, once set, is never
 * cleared even if the user comes back and goes quiet again) -- an
 * explicit choice, not an oversight. Worth revisiting: a user who returns
 * after this fires, stays engaged for months, then goes quiet again gets
 * no second nudge, ever. Flagging this back rather than silently building
 * it differently, per the original instruction to build it as specified
 * and revisit later if it turns out wrong.
 *
 * `excludeUserIds` is who already got the no-brand nudge this same run --
 * at most one lifecycle email per user per run, no-brand nudge wins (a
 * clearer, more actionable next step than an inactivity email for
 * someone who never even finished setup).
 */
async function sendInactivityNudges(admin: AdminClient, excludeUserIds: Set<string>): Promise<number> {
  const cutoff = new Date(Date.now() - INACTIVITY_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // .lt() naturally excludes NULL last_active_at rows (NULL < x is NULL,
  // not true in Postgres) -- an account that has never loaded an
  // authenticated dashboard page since last_active_at tracking shipped
  // has no established baseline yet, so it's correctly left out rather
  // than treated as "infinitely inactive".
  const { data: candidates, error } = await table(admin, "users")
    .select("id, email, full_name")
    .lt("last_active_at", cutoff)
    .is("inactivity_nudge_sent_at", null)
    .eq("marketing_emails_opted_out", false) as { data: LifecycleCandidate[] | null; error: { message: string } | null }

  if (error) {
    console.error("[cron/send-lifecycle-emails] inactivity candidate query failed:", error.message)
    return 0
  }

  let sent = 0
  for (const target of candidates ?? []) {
    if (excludeUserIds.has(target.id)) continue
    if (!target.email) continue
    try {
      const lastContentTitle = await getLastContentTitle(admin, target.id)
      await sendInactivityNudgeEmail(target.id, target.email, target.full_name ?? undefined, lastContentTitle)
      const { error: markError } = await table(admin, "users")
        .update({ inactivity_nudge_sent_at: new Date().toISOString() })
        .eq("id", target.id)
      if (markError) {
        console.error(`[cron/send-lifecycle-emails] failed to mark inactivity_nudge_sent_at for ${target.id}:`, markError.message)
        continue
      }
      sent++
    } catch (err) {
      console.error(`[cron/send-lifecycle-emails] inactivity nudge failed for ${target.id}:`, err instanceof Error ? err.message : err)
    }
  }

  return sent
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    console.error("[cron/send-lifecycle-emails] unauthorized request")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  console.log("[cron/send-lifecycle-emails] GET called")

  const admin = await createAdminClient()

  const { sent: noBrandSent, targetedUserIds } = await sendNoBrandNudges(admin)
  const inactivitySent = await sendInactivityNudges(admin, targetedUserIds)

  console.log("[cron/send-lifecycle-emails] done:", { noBrandSent, inactivitySent })
  return NextResponse.json({ data: { noBrandSent, inactivitySent } })
}
