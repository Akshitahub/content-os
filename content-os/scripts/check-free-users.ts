/**
 * One-off read-only diagnostic: current plan='free' user count, run before
 * writing the migration that moves them to a fresh Starter trial (see
 * supabase/migrations/038_remove_free_tier.sql). Mirrors
 * check-prospect-scores.ts's env-loading pattern exactly. Safe to delete
 * once that migration has been reviewed/run.
 */
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

loadEnvLocal()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function main(): Promise<void> {
  const { count: totalCount } = await supabase.from("users").select("*", { count: "exact", head: true })
  const { data: freeUsers, count: freeCount } = await supabase
    .from("users")
    .select("id, email, plan, generation_count, created_at", { count: "exact" })
    .eq("plan", "free")

  console.log(`Total users: ${totalCount}`)
  console.log(`plan='free' users: ${freeCount}`)
  console.log("")
  for (const u of freeUsers ?? []) {
    console.log(`  ${u.email}  gen_count=${u.generation_count}  created=${u.created_at}`)
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err)
  process.exit(1)
})
