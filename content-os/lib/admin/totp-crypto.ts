/**
 * Encrypts admin TOTP secrets at rest (admin_users.totp_secret_enc).
 * AES-256-GCM, key from ADMIN_TOTP_ENC_KEY (32 bytes, base64), stored as
 * "v1:<iv>:<tag>:<ciphertext>" (base64 parts). Unlike the social token
 * helper this throws: it's only used by admin login and the enrolment
 * script, where a missing key is a configuration error to surface.
 *
 * Server-only (node:crypto).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const VERSION = "v1"
const IV_BYTES = 12
const TAG_BYTES = 16

function key(): Buffer {
  const raw = process.env.ADMIN_TOTP_ENC_KEY
  if (!raw) throw new Error("ADMIN_TOTP_ENC_KEY is not set -- it's needed to read and store admin TOTP secrets (32 random bytes, base64).")
  const k = Buffer.from(raw, "base64")
  if (k.length !== 32) throw new Error("ADMIN_TOTP_ENC_KEY must be 32 bytes, base64-encoded.")
  return k
}

export function encryptTotpSecret(secret: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv("aes-256-gcm", key(), iv)
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()])
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(":")
}

export function decryptTotpSecret(stored: string): string {
  const parts = stored.split(":")
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error("Stored TOTP secret is not in the expected format.")
  const [, ivB64, tagB64, ctB64] = parts as [string, string, string, string]
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"), { authTagLength: TAG_BYTES })
  decipher.setAuthTag(Buffer.from(tagB64, "base64"))
  try {
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8")
  } catch {
    throw new Error("Stored TOTP secret could not be decrypted (tampered, or ADMIN_TOTP_ENC_KEY changed).")
  }
}
