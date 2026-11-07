import { NextResponse } from "next/server"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/server"
import { verifyPassword } from "@/lib/admin/password"
import { signAdminSession, ADMIN_SESSION_COOKIE } from "@/lib/admin/session"
import { decryptTotpSecret } from "@/lib/admin/totp-crypto"
import { checkRateLimit } from "@/lib/security/rate-limit"
import { buildError, ErrorCodes } from "@/types/api"
import { verify as verifyTotp } from "otplib"
import { logAudit, requestIp } from "@/lib/security/audit"

const schema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
  totp: z.string().trim().optional(),
})

// Lockout (migration 074): this many wrong attempts in a row lock the
// account for LOCKOUT_MINUTES. Per-IP: IP_LIMIT attempts per IP_WINDOW_SECONDS.
const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_MINUTES = 15
const IP_LIMIT = 10
const IP_WINDOW_SECONDS = 900
// One 30-second TOTP step either side of now ("window 1").
const TOTP_TOLERANCE_SECONDS = 30

// Same 7-day window signAdminSession itself signs the JWT for -- kept in
// sync here since the cookie's own maxAge is what actually controls when
// the browser stops sending it, independent of the token's exp claim.
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60

// Applied on every failure path (unknown email or wrong password) so a
// timing attack can't distinguish "no such admin" from "wrong password" --
// blunts brute-forcing/credential-stuffing against this login endpoint,
// which (unlike the customer-facing login) has no Supabase-managed rate
// limiting in front of it.
const FAILURE_DELAY_MS = 300

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface AdminUserRow {
  id: string
  email: string
  password_hash: string
  // Migration 074 -- absent before it runs (no lockout / TOTP then).
  failed_attempts?: number
  locked_until?: string | null
  totp_secret_enc?: string | null
  totp_enabled?: boolean
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminDb = any

const invalidCredentials = () => NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "Invalid credentials"), { status: 401 })

function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown"
}

/** The admin row, with the 074 columns when they exist. */
async function loadAdmin(admin: AdminDb, email: string): Promise<AdminUserRow | null> {
  const full = await admin.from("admin_users")
    .select("id, email, password_hash, failed_attempts, locked_until, totp_secret_enc, totp_enabled")
    .eq("email", email)
    .maybeSingle() as { data: AdminUserRow | null; error: { message: string } | null }
  if (!full.error) return full.data
  // Before migration 074: the columns don't exist yet.
  const base = await admin.from("admin_users").select("id, email, password_hash").eq("email", email).maybeSingle() as { data: AdminUserRow | null }
  return base.data
}

/** One more failed attempt; the fifth in a row locks the account and resets the count. Returns whether it locked. */
async function recordFailedAttempt(admin: AdminDb, user: AdminUserRow): Promise<boolean> {
  if (user.failed_attempts === undefined) return false // before migration 074
  const attempts = user.failed_attempts + 1
  const locks = attempts >= MAX_FAILED_ATTEMPTS
  const { error } = await admin.from("admin_users")
    .update(locks ? { failed_attempts: 0, locked_until: new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString() } : { failed_attempts: attempts })
    .eq("id", user.id)
  if (error) console.error("[admin/auth/login] failed-attempt update failed:", error.message)
  if (locks) console.error(`[admin/auth/login] admin ${user.id} locked for ${LOCKOUT_MINUTES} minutes after ${MAX_FAILED_ATTEMPTS} failed attempts`)
  return locks
}

/**
 * Admin panel login -- entirely separate from Supabase auth (see
 * lib/admin/session.ts's doc comment). Verifies email/password against
 * public.admin_users (service-role only, no client-facing RLS policy —
 * see supabase/migrations/048_admin_users.sql), then signs and sets a
 * short-lived HS256 session JWT scoped to /admin.
 */
export async function POST(request: Request) {
  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.issues[0]?.message), { status: 400 })
  }
  const { email, password, totp } = parsed.data

  const ip = clientIp(request)
  const audit = (action: string, actorId: string | null, meta: Record<string, unknown>) =>
    logAudit({ actorType: "admin", actorId, action, targetType: "admin_user", targetId: actorId, meta: { email, ...meta }, ip })

  if (!(await checkRateLimit(`admin-login:${ip}`, IP_LIMIT, IP_WINDOW_SECONDS))) {
    await audit("admin.login.failure", null, { reason: "ip_rate_limited" })
    await sleep(FAILURE_DELAY_MS)
    return NextResponse.json(
      buildError(ErrorCodes.RATE_LIMITED, "Too many sign-in attempts. Try again in a few minutes."),
      { status: 429, headers: { "Retry-After": String(IP_WINDOW_SECONDS) } }
    )
  }

  // admin_users isn't in the generated Database type (a hand-run
  // migration, not one supabase gen types has ever seen) -- same `as any`
  // pattern already used elsewhere in this codebase for tables in that
  // situation.
  const admin: AdminDb = await createAdminClient()
  const adminUser = await loadAdmin(admin, email)

  // Locked: the same generic failure, without even checking the password.
  if (adminUser?.locked_until && new Date(adminUser.locked_until).getTime() > Date.now()) {
    await audit("admin.login.failure", adminUser.id, { reason: "locked" })
    await sleep(FAILURE_DELAY_MS)
    return invalidCredentials()
  }

  const passwordValid = adminUser ? await verifyPassword(password, adminUser.password_hash) : false

  if (!adminUser || !passwordValid) {
    const locked = adminUser ? await recordFailedAttempt(admin, adminUser) : false
    await audit("admin.login.failure", adminUser?.id ?? null, { reason: adminUser ? "bad_password" : "unknown_email" })
    if (locked) await audit("admin.login.lockout", adminUser!.id, { minutes: LOCKOUT_MINUTES })
    await sleep(FAILURE_DELAY_MS)
    return invalidCredentials()
  }

  // Password correct from here on.
  if (process.env.ADMIN_REQUIRE_TOTP === "true" && !adminUser.totp_enabled) {
    console.error(`[admin/auth/login] admin ${adminUser.id} refused: ADMIN_REQUIRE_TOTP is on and they have no TOTP enrolled`)
    await audit("admin.login.failure", adminUser.id, { reason: "totp_not_enrolled" })
    await sleep(FAILURE_DELAY_MS)
    return NextResponse.json(
      buildError(ErrorCodes.UNAUTHORIZED, "Two-factor sign-in is required. Ask an admin to enrol you (scripts/admin-enroll-totp.ts)."),
      { status: 403 }
    )
  }

  if (adminUser.totp_enabled) {
    if (!totp) {
      // Counts as an attempt, so the password step alone can't be hammered.
      if (await recordFailedAttempt(admin, adminUser)) await audit("admin.login.lockout", adminUser.id, { minutes: LOCKOUT_MINUTES })
      return NextResponse.json({ totpRequired: true })
    }
    let secret: string
    try {
      secret = decryptTotpSecret(adminUser.totp_secret_enc ?? "")
    } catch (err) {
      console.error("[admin/auth/login] TOTP secret unusable:", err instanceof Error ? err.message : err)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Admin sign-in is misconfigured."), { status: 500 })
    }
    const result = /^\d{6}$/.test(totp) ? await verifyTotp({ secret, token: totp, epochTolerance: TOTP_TOLERANCE_SECONDS }).catch(() => ({ valid: false })) : { valid: false }
    if (!result.valid) {
      const locked = await recordFailedAttempt(admin, adminUser)
      await audit("admin.login.failure", adminUser.id, { reason: "bad_totp" })
      if (locked) await audit("admin.login.lockout", adminUser.id, { minutes: LOCKOUT_MINUTES })
      await sleep(FAILURE_DELAY_MS)
      return invalidCredentials()
    }
  }

  const token = await signAdminSession({ id: adminUser.id, email: adminUser.email })
  await audit("admin.login.success", adminUser.id, { second_factor: !!adminUser.totp_enabled })

  // Best-effort -- a failed write here shouldn't block a successful login.
  // A successful sign-in clears the failed-attempt count and any lock.
  const { error: touchError } = await admin.from("admin_users")
    .update({ last_login_at: new Date().toISOString(), ...(adminUser.failed_attempts !== undefined ? { failed_attempts: 0, locked_until: null } : {}) })
    .eq("id", adminUser.id)
  if (touchError) {
    console.error("[admin/auth/login] last_login_at update failed:", touchError.message)
  }

  const response = NextResponse.json({ success: true })
  response.cookies.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    // path: "/" (not "/admin") -- httpOnly + secure + sameSite=lax already
    // keep this cookie scoped to this domain; a narrower path added no
    // real protection and just meant the browser never sent it to
    // /api/admin/* routes (a different path prefix than /admin itself).
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
  return response
}
