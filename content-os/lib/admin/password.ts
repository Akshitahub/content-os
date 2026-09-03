import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto"
import { promisify } from "util"

// Node's built-in crypto.scrypt — no new native-binary dependency (unlike
// bcrypt/argon2, which ship a compiled addon). This only ever protects a
// small, hand-provisioned set of internal admin accounts (see
// supabase/migrations/048_admin_users.sql), not a public signup surface,
// so scrypt's own default work factors (N=16384, r=8, p=1, applied when
// promisify(scrypt) is called with no options object) are left as-is
// rather than tuned further.
const scrypt = promisify(scryptCallback)

const SALT_BYTES = 16
const KEY_LENGTH = 64

/**
 * Hashes a plaintext password with a fresh random salt per call, so
 * hashing the same password twice never produces the same stored string.
 * Returns "saltHex:hashHex" — both hex-encoded, stored together in one
 * column (admin_users.password_hash) rather than a separate salt column.
 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES).toString("hex")
  const derivedKey = (await scrypt(plain, salt, KEY_LENGTH)) as Buffer
  return `${salt}:${derivedKey.toString("hex")}`
}

/**
 * Verifies a plaintext password against a "saltHex:hashHex" string from
 * hashPassword above. Re-derives the key with the stored salt and compares
 * with timingSafeEqual (not ===) — a plain string/Buffer comparison would
 * leak how many leading bytes matched via response timing, the standard
 * password-hash-comparison pitfall. Never throws — a malformed hash (or
 * any other failure) is just a non-match.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    const [salt, storedHashHex] = hash.split(":")
    if (!salt || !storedHashHex) return false
    const storedHash = Buffer.from(storedHashHex, "hex")
    const derivedKey = (await scrypt(plain, salt, storedHash.length)) as Buffer
    if (derivedKey.length !== storedHash.length) return false
    return timingSafeEqual(derivedKey, storedHash)
  } catch {
    return false
  }
}
