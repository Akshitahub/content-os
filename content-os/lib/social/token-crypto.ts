/**
 * Encrypts the access tokens we hold ourselves (direct Instagram
 * connections, provider 'meta') before they reach social_connections.
 * AES-256-GCM, key from SOCIAL_TOKEN_KEY (32 bytes, base64). Stored as
 * "v1:<iv>:<tag>:<ciphertext>", each part base64; GCM's tag means a
 * changed byte, or the wrong key, fails to decrypt instead of giving a
 * wrong token.
 *
 * Server-only: scripts/check-client-imports.ts fails CI if anything a
 * "use client" file can reach imports this.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const VERSION = "v1"
const IV_BYTES = 12
const TAG_BYTES = 16

export type TokenCryptoResult = { ok: true; value: string } | { ok: false; error: string }

/** The key from SOCIAL_TOKEN_KEY, or why it can't be used. `raw` is for tests. */
function loadKey(raw = process.env.SOCIAL_TOKEN_KEY): { ok: true; key: Buffer } | { ok: false; error: string } {
  if (!raw) return { ok: false, error: "SOCIAL_TOKEN_KEY is not configured" }
  const key = Buffer.from(raw, "base64")
  if (key.length !== 32) return { ok: false, error: "SOCIAL_TOKEN_KEY must be 32 bytes, base64" }
  return { ok: true, key }
}

export function encryptToken(token: string, rawKey?: string): TokenCryptoResult {
  const k = loadKey(rawKey)
  if (!k.ok) return k
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv("aes-256-gcm", k.key, iv)
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return { ok: true, value: [VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":") }
}

export function decryptToken(stored: string, rawKey?: string): TokenCryptoResult {
  const k = loadKey(rawKey)
  if (!k.ok) return k
  const parts = stored.split(":")
  if (parts.length !== 4 || parts[0] !== VERSION) return { ok: false, error: "Not an encrypted token" }
  const [, ivB64, tagB64, ctB64] = parts as [string, string, string, string]
  const iv = Buffer.from(ivB64, "base64")
  const tag = Buffer.from(tagB64, "base64")
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return { ok: false, error: "Not an encrypted token" }
  try {
    const decipher = createDecipheriv("aes-256-gcm", k.key, iv, { authTagLength: TAG_BYTES })
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()])
    return { ok: true, value: plain.toString("utf8") }
  } catch {
    // Tampered, or encrypted under another key.
    return { ok: false, error: "Token could not be decrypted" }
  }
}
