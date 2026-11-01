import crypto from "crypto"

/**
 * The "Send photos from your phone" link (app/send-photos/[token]): no login
 * on the phone, so this signature is the auth. The token names one brand and
 * an expiry (7 days); anyone holding it can only add photos to that brand
 * until then -- never read anything.
 *
 * The key is derived from SUPABASE_SERVICE_ROLE_KEY for this one purpose
 * (HMAC(key, "photo-link-v1")), so a token never carries or reveals the
 * service key and no new env var is needed.
 */

export const PHOTO_LINK_DAYS = 7
/** Photos one link accepts. */
export const PHOTO_LINK_MAX = 30

function key(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set -- cannot sign photo links.")
  return crypto.createHmac("sha256", secret).update("photo-link-v1").digest()
}

const sign = (payload: string) => crypto.createHmac("sha256", key()).update(payload).digest("base64url")

export function createPhotoLinkToken(brandId: string, now = Date.now()): { token: string; expiresAt: string } {
  const exp = Math.floor(now / 1000) + PHOTO_LINK_DAYS * 86_400
  const payload = `${brandId}.${exp.toString(36)}`
  return { token: `${payload}.${sign(payload)}`, expiresAt: new Date(exp * 1000).toISOString() }
}

/** The brand id and the link's own id (for its photo count) -- or null: malformed, tampered with or expired. */
export function verifyPhotoLinkToken(token: string, now = Date.now()): { brandId: string; linkId: string; expiresAt: string } | null {
  const parts = token.split(".")
  if (parts.length !== 3) return null
  const [brandId, expStr, sig] = parts as [string, string, string]
  if (!/^[0-9a-f-]{36}$/i.test(brandId) || !/^[0-9a-z]+$/.test(expStr)) return null
  const expected = Buffer.from(sign(`${brandId}.${expStr}`))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null
  const exp = parseInt(expStr, 36)
  if (!Number.isFinite(exp) || exp * 1000 < now) return null
  return { brandId, linkId: sig.slice(0, 12).replace(/[^a-zA-Z0-9]/g, "x"), expiresAt: new Date(exp * 1000).toISOString() }
}
