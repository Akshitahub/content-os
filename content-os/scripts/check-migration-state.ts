import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"

function loadEnvLocal(): void {
  const envPath = join(process.cwd(), ".env.local")
  if (!existsSync(envPath)) return
  const contents = readFileSync(envPath, "utf-8")
  for (const line of contents.split("\n")) {
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
loadEnvLocal()
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
async function main() {
  const { error } = await supabase.from("users").select("topup_credits_balance, trial_ends_at, marketing_emails_opted_out, last_active_at, no_brand_nudge_sent_at").limit(1)
  console.log("users new columns error:", error)
  const { error: cpError } = await supabase.from("credit_purchases").select("id").limit(1)
  console.log("credit_purchases table error:", cpError)
}
main()
