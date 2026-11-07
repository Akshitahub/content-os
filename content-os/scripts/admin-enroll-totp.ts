// Enrols an admin in TOTP two-factor sign-in (migration 074). Run locally
// with the service role key (read from .env.local or the environment):
//
//   npx tsx scripts/admin-enroll-totp.ts <admin-email>
//
// Generates a new secret, stores it encrypted (ADMIN_TOTP_ENC_KEY,
// lib/admin/totp-crypto.ts), sets totp_enabled = true, and prints the
// otpauth:// URI plus a QR code to scan with Google Authenticator (or any
// TOTP app). Re-running replaces the secret -- the old app entry stops
// working. From then on /admin/login asks for the 6-digit code.
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import { generateSecret, generateURI } from "otplib"
import qrcode from "qrcode-terminal"

function loadEnvLocal(): void {
  const envPath = join(process.cwd(), ".env.local")
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let value = trimmed.slice(eqIdx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (!(key in process.env)) process.env[key] = value
  }
}

async function main() {
  loadEnvLocal()
  const email = process.argv[2]?.trim()
  if (!email) {
    console.error("Usage: npx tsx scripts/admin-enroll-totp.ts <admin-email>")
    process.exit(1)
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
    process.exit(1)
  }
  const { encryptTotpSecret } = await import("@/lib/admin/totp-crypto")

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: admin, error } = await db.from("admin_users").select("id, email").eq("email", email).maybeSingle()
  if (error) {
    console.error("Couldn't read admin_users (has migration 074 been run?):", error.message)
    process.exit(1)
  }
  if (!admin) {
    console.error(`No admin with email ${email}.`)
    process.exit(1)
  }

  const secret = generateSecret()
  const { error: updateError } = await db.from("admin_users")
    .update({ totp_secret_enc: encryptTotpSecret(secret), totp_enabled: true, failed_attempts: 0, locked_until: null })
    .eq("id", admin.id)
  if (updateError) {
    console.error("Couldn't store the TOTP secret:", updateError.message)
    process.exit(1)
  }

  const uri = generateURI({ issuer: "SocioPosts Admin", label: admin.email, secret })
  console.log(`\nTOTP enabled for ${admin.email}. Scan this with Google Authenticator:\n`)
  qrcode.generate(uri, { small: true })
  console.log(`\nOr add it by hand with this URI (keep it private -- it IS the second factor):\n${uri}\n`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
