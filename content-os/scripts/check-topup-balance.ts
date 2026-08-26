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
  const email = process.argv[2] ?? "akshitawork16@gmail.com"
  const { data: u } = await supabase.from("users").select("id, email, plan, topup_credits_balance, generation_count, trial_ends_at, subscribed_at").eq("email", email).single()
  console.log("USER:", JSON.stringify(u, null, 2))
  if (u) {
    const { data: purchases } = await supabase.from("credit_purchases").select("*").eq("user_id", u.id).order("purchased_at", { ascending: false })
    console.log("PURCHASES:", JSON.stringify(purchases, null, 2))
  }
}
main()
