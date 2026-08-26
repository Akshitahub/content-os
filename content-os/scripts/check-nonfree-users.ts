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
  const { data, error, count } = await supabase.from("users").select("email, plan, created_at, stripe_customer_id", { count: "exact" }).neq("plan", "free")
  console.log("count:", count, "error:", error)
  console.log(JSON.stringify(data, null, 2))

  const all = await supabase.from("users").select("email, plan")
  console.log("ALL PLANS:", JSON.stringify(all.data?.map(u => u.plan)))
}
main()
