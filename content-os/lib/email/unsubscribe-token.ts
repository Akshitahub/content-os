import crypto from "crypto"

/**
 * Signs/verifies the token in a one-click unsubscribe link
 * (app/api/v1/email/unsubscribe/route.ts) — a bare user id in that URL
 * would let anyone unsubscribe anyone else just by guessing/enumerating
 * ids, so the id is HMAC-signed instead. No login is required to click
 * the link (standard unsubscribe UX), so this signature is what stands in
 * for auth here.
 *
 * Keyed off RESEND_API_KEY rather than a new dedicated env var — it's
 * already a required secret for this exact subsystem (no email, including
 * this token, ever gets generated without it configured), and HMAC output
 * never exposes the key material itself, so reusing it doesn't widen the
 * blast radius of a leaked token the way reusing e.g.
 * SUPABASE_SERVICE_ROLE_KEY would.
 */
function getSecret(): string {
  const secret = process.env.RESEND_API_KEY
  if (!secret) throw new Error("RESEND_API_KEY is not set — cannot sign/verify unsubscribe tokens.")
  return secret
}

function sign(userId: string): string {
  return crypto.createHmac("sha256", getSecret()).update(userId).digest("hex")
}

export function generateUnsubscribeToken(userId: string): string {
  return `${userId}.${sign(userId)}`
}

/** Returns the user id if the token is valid, null otherwise (malformed,
 * wrong signature, or tampered-with). Never throws on a bad token — only
 * a missing RESEND_API_KEY is treated as a real error. */
export function verifyUnsubscribeToken(token: string): string | null {
  const dotIndex = token.lastIndexOf(".")
  if (dotIndex === -1) return null

  const userId = token.slice(0, dotIndex)
  const providedSignature = token.slice(dotIndex + 1)
  if (!userId || !providedSignature) return null

  const expectedSignature = sign(userId)
  const expectedBuffer = Buffer.from(expectedSignature, "hex")
  const providedBuffer = Buffer.from(providedSignature, "hex")

  if (expectedBuffer.length !== providedBuffer.length) return null
  if (!crypto.timingSafeEqual(expectedBuffer, providedBuffer)) return null

  return userId
}
