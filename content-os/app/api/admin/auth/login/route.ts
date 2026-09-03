import { NextResponse } from "next/server"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/server"
import { verifyPassword } from "@/lib/admin/password"
import { signAdminSession, ADMIN_SESSION_COOKIE } from "@/lib/admin/session"
import { buildError, ErrorCodes } from "@/types/api"

const schema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
})

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
  const { email, password } = parsed.data

  const admin = await createAdminClient()
  // admin_users isn't in the generated Database type (a hand-run
  // migration, not one supabase gen types has ever seen) -- same `as any`
  // pattern already used elsewhere in this codebase for tables in that
  // situation.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: adminUser } = await (admin.from("admin_users") as any)
    .select("id, email, password_hash")
    .eq("email", email)
    .single() as { data: AdminUserRow | null }

  const passwordValid = adminUser ? await verifyPassword(password, adminUser.password_hash) : false

  if (!adminUser || !passwordValid) {
    await sleep(FAILURE_DELAY_MS)
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "Invalid credentials"), { status: 401 })
  }

  const token = await signAdminSession({ id: adminUser.id, email: adminUser.email })

  // Best-effort -- a failed write here shouldn't block a successful login.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: touchError } = await (admin.from("admin_users") as any)
    .update({ last_login_at: new Date().toISOString() })
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
