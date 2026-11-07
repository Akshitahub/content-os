import { createAdminClient } from "@/lib/supabase/server"

/**
 * The security audit trail (migration 075's audit_logs). Best-effort: a
 * failed write is logged and swallowed -- auditing never breaks the action
 * it records. Callers must never put passwords, tokens or other secrets in
 * `meta`; keys that look like one are dropped here as a backstop.
 */

export interface AuditEntry {
  actorType: "user" | "admin" | "system"
  actorId?: string | null
  action: string
  targetType?: string | null
  targetId?: string | null
  meta?: Record<string, unknown>
  ip?: string | null
}

const SECRET_KEY = /token|secret|password|passwd|totp|otp|key|authorization|cookie/i

function scrub(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!meta) return {}
  return Object.fromEntries(Object.entries(meta).filter(([k]) => !SECRET_KEY.test(k)))
}

/** The caller's IP from the proxy headers (Vercel sets x-forwarded-for), or null. */
export function requestIp(request: Request): string | null {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || null
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const admin = await createAdminClient()
    // audit_logs isn't in the generated Database type (hand-run migration).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin.from("audit_logs") as any).insert({
      actor_type: entry.actorType,
      actor_id: entry.actorId ?? null,
      action: entry.action,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      meta: scrub(entry.meta),
      ip: entry.ip ?? null,
    }) as { error: { message: string } | null }
    if (error) console.error(`[audit] couldn't record ${entry.action}:`, error.message)
  } catch (err) {
    console.error(`[audit] couldn't record ${entry.action}:`, err instanceof Error ? err.message : err)
  }
}
