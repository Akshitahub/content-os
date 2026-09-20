import { randomBytes } from "crypto"

// 20 random bytes (well above the 16-byte floor) base64url-encoded -- never
// sequential, never derived from a content id, so a token can't be guessed
// or enumerated from another one. base64url (not plain base64) so the
// result is already URL-safe with no encoding needed in app/p/[token]'s
// route segment.
const TOKEN_BYTES = 20

export function generateShareToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url")
}
