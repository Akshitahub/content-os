import crypto from "crypto"

/**
 * The direct Instagram connector (Business Login for Instagram, no Zernio):
 * who may use it, its redirect URI, and the OAuth state that ties a
 * callback to the connect that started it.
 *
 * Server-only (reads env, signs with a server secret) -- the client learns
 * whether direct is on from the social-connections GET, never from here.
 */

/** True only for user ids listed in INSTAGRAM_DIRECT_USER_IDS (comma-separated). */
export function isInstagramDirectEnabled(userId: string): boolean {
  const ids = (process.env.INSTAGRAM_DIRECT_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  return ids.includes(userId)
}

/** Must match the redirect URI registered on the Instagram app exactly -- so no query string; the brand rides in the state. */
export function instagramDirectRedirectUri(appUrl: string): string {
  return `${appUrl.replace(/\/+$/, "")}/api/v1/social/instagram-direct/callback`
}

/** The httpOnly cookie holding the state's nonce: a callback only counts in the browser that started it. */
export const STATE_COOKIE = "ig_direct_state"
export const STATE_TTL_SECONDS = 600

// Key derived from SUPABASE_SERVICE_ROLE_KEY for this one purpose (the
// lib/photo-link-token.ts approach): no new env var, never reveals the key.
function key(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set -- cannot sign OAuth state.")
  return crypto.createHmac("sha256", secret).update("instagram-direct-state-v1").digest()
}

const sign = (payload: string) => crypto.createHmac("sha256", key()).update(payload).digest("base64url")

/** A signed state naming the brand and user, plus the nonce to set in STATE_COOKIE. */
export function createConnectState(brandId: string, userId: string, now = Date.now()): { state: string; nonce: string } {
  const nonce = crypto.randomBytes(16).toString("base64url")
  const payload = Buffer.from(JSON.stringify({ b: brandId, u: userId, n: nonce, e: Math.floor(now / 1000) + STATE_TTL_SECONDS })).toString("base64url")
  return { state: `${payload}.${sign(payload)}`, nonce }
}

/** The brand and user the state names -- or null: malformed, tampered with, expired, or not from this browser. */
export function verifyConnectState(state: string, cookieNonce: string | undefined, now = Date.now()): { brandId: string; userId: string } | null {
  const [payload, sig, extra] = state.split(".")
  if (!payload || !sig || extra !== undefined) return null
  const expected = Buffer.from(sign(payload))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null
  let body: { b?: unknown; u?: unknown; n?: unknown; e?: unknown }
  try {
    body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
  } catch {
    return null
  }
  if (typeof body.b !== "string" || typeof body.u !== "string" || typeof body.n !== "string" || typeof body.e !== "number") return null
  if (body.e * 1000 < now) return null
  if (!cookieNonce || cookieNonce !== body.n) return null
  return { brandId: body.b, userId: body.u }
}
