import { SignJWT, jwtVerify } from "jose"

// The single literal every admin login/logout/middleware route reads or
// writes — imported everywhere the cookie is touched instead of each site
// hand-typing "admin_session", so the name can never drift between them.
export const ADMIN_SESSION_COOKIE = "admin_session"

const SESSION_EXPIRY = "7d"

export interface AdminSessionPayload {
  id: string
  email: string
}

function getSecretKey(): Uint8Array {
  const secret = process.env.ADMIN_SESSION_SECRET
  if (!secret) throw new Error("ADMIN_SESSION_SECRET is not set")
  return new TextEncoder().encode(secret)
}

/**
 * Signs a 7-day admin session JWT (HS256) for the separate admin panel —
 * entirely unrelated to Supabase auth's own session tokens (see
 * lib/admin/password.ts's doc comment for the same "independent from the
 * customer-facing system" reasoning on the credential side).
 */
export async function signAdminSession({ id, email }: AdminSessionPayload): Promise<string> {
  return new SignJWT({ id, email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_EXPIRY)
    .sign(getSecretKey())
}

/**
 * Verifies and decodes an admin session JWT. Never throws — an invalid,
 * expired, or tampered token (or a missing ADMIN_SESSION_SECRET) just
 * resolves to null, so callers can treat "no valid session" as one simple
 * case instead of a try/catch at every call site.
 */
export async function verifyAdminSession(token: string): Promise<AdminSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey())
    if (typeof payload.id !== "string" || typeof payload.email !== "string") return null
    return { id: payload.id, email: payload.email }
  } catch {
    return null
  }
}
