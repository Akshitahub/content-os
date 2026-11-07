import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { refreshLongLivedToken } from "@/lib/social/meta-instagram-client"
import { decryptToken, encryptToken } from "@/lib/social/token-crypto"
import { logAudit } from "@/lib/security/audit"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

// Direct Instagram connections (provider 'meta') hold a 60-day long-lived
// token that Meta only extends when we ask (refresh_access_token). Daily:
// any active one expiring within REFRESH_WINDOW_DAYS gets a fresh 60 days.
// A failed refresh leaves the row as it is -- tomorrow's run tries again,
// well before it actually expires. Already expired: it can't be refreshed
// (Meta refuses), so it's deactivated and the owner reconnects.
export const maxDuration = 300

const REFRESH_WINDOW_DAYS = 15

type AdminClient = SupabaseClient<Database>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function socialConnectionsTable(supabase: AdminClient): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).from("social_connections")
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const authHeader = request.headers.get("authorization")
  if (authHeader === `Bearer ${secret}`) return true

  const { searchParams } = new URL(request.url)
  return searchParams.get("secret") === secret
}

type ConnectionRow = { id: string; brand_id: string; access_token: string | null; token_expires_at: string | null }

const auditRefresh = (row: ConnectionRow, action: string, reason: string) =>
  logAudit({ actorType: "system", action, targetType: "brand", targetId: row.brand_id, meta: { platform: "instagram", provider: "meta", connection_id: row.id, reason } })

async function refreshOne(admin: AdminClient, row: ConnectionRow, now: number): Promise<"refreshed" | "deactivated" | "failed"> {
  if (row.token_expires_at && new Date(row.token_expires_at).getTime() <= now) {
    const { error } = await socialConnectionsTable(admin).update({ is_active: false }).eq("id", row.id)
    if (error) console.error(`[cron/refresh-instagram-tokens] brand ${row.brand_id}: failed to deactivate expired connection:`, error.message)
    console.error(`[cron/refresh-instagram-tokens] brand ${row.brand_id}: token already expired -- connection deactivated`)
    await auditRefresh(row, "social.token_expired", "expired before refresh -- connection deactivated")
    return "deactivated"
  }

  const current = row.access_token ? decryptToken(row.access_token) : null
  if (!current?.ok) {
    console.error(`[cron/refresh-instagram-tokens] brand ${row.brand_id}: stored token unusable (${current ? current.error : "missing"}) -- left as is`)
    await auditRefresh(row, "social.token_refresh_failed", current ? current.error : "missing")
    return "failed"
  }

  const refreshed = await refreshLongLivedToken(current.value)
  if (!refreshed.ok) {
    console.error(`[cron/refresh-instagram-tokens] brand ${row.brand_id}: refresh failed -- ${refreshed.error}`)
    await auditRefresh(row, "social.token_refresh_failed", refreshed.error)
    return "failed"
  }

  const encrypted = encryptToken(refreshed.token)
  if (!encrypted.ok) {
    console.error(`[cron/refresh-instagram-tokens] brand ${row.brand_id}: could not encrypt refreshed token -- ${encrypted.error}`)
    await auditRefresh(row, "social.token_refresh_failed", encrypted.error)
    return "failed"
  }

  const { error } = await socialConnectionsTable(admin)
    .update({ access_token: encrypted.value, token_expires_at: refreshed.expiresAt, last_refreshed_at: new Date().toISOString() })
    .eq("id", row.id)
  if (error) {
    console.error(`[cron/refresh-instagram-tokens] brand ${row.brand_id}: refreshed but failed to save:`, error.message)
    await auditRefresh(row, "social.token_refresh_failed", "refreshed but not saved")
    return "failed"
  }
  return "refreshed"
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    console.error("[cron/refresh-instagram-tokens] unauthorized request")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  console.log("[cron/refresh-instagram-tokens] GET called")

  const admin = await createAdminClient()
  const now = Date.now()
  const cutoff = new Date(now + REFRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: rows, error: fetchError } = await socialConnectionsTable(admin)
    .select("id, brand_id, access_token, token_expires_at")
    .eq("provider", "meta")
    .eq("is_active", true)
    .lte("token_expires_at", cutoff) as { data: ConnectionRow[] | null; error: { message: string } | null }

  if (fetchError) {
    console.error("[cron/refresh-instagram-tokens] failed to fetch connections:", fetchError.message)
    return NextResponse.json({ error: "Failed to fetch connections." }, { status: 500 })
  }

  const summary = { due: rows?.length ?? 0, refreshed: 0, deactivated: 0, failed: 0 }
  // One at a time: a handful of rows a day, and it keeps us gentle on Meta.
  for (const row of rows ?? []) {
    try {
      summary[await refreshOne(admin, row, now)]++
    } catch (err) {
      console.error(`[cron/refresh-instagram-tokens] brand ${row.brand_id}: unexpected error:`, err instanceof Error ? err.message : "unknown")
      summary.failed++
    }
  }

  console.log("[cron/refresh-instagram-tokens] done:", summary)
  return NextResponse.json({ data: summary })
}
