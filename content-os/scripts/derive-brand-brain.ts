// Runs the self-filling Brand Brain derivation (lib/ai/brand-brain-derive.ts)
// on real brands and prints the full result: every derived field, what it
// read (website pages, Instagram captions, products, reviews / FAQ), and the
// differentiators / objections dropped because their quote wasn't in the
// sources. Real model call per brand.
//
//   npx tsx scripts/derive-brand-brain.ts --brand <brandId> [--brand <brandId>] [--write]
//
// Without --write nothing is saved; with it the result is stored exactly
// as the app stores it (auto fields only; user-edited fields untouched).
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import type { BrandRow } from "@/types/database"

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
loadEnvLocal()

const brandIds = process.argv.flatMap((a, i) => (a === "--brand" ? [process.argv[i + 1]!] : [])).filter(Boolean)
const WRITE = process.argv.includes("--write")
if (!brandIds.length) {
  console.error("usage: npx tsx scripts/derive-brand-brain.ts --brand <brandId> [--brand <brandId>] [--write]")
  process.exit(1)
}

async function main() {
  const { deriveBrandBrain, deriveAndStoreBrandBrain } = await import("@/lib/ai/brand-brain-derive")
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  for (const id of brandIds) {
    const { data: brand } = await db.from("brands").select("*").eq("id", id).single<BrandRow>()
    if (!brand) throw new Error(`brand ${id} not found`)
    console.log(`\n=== ${brand.name} (${brand.website_url ?? "no website"}) ===`)
    const result = WRITE ? await deriveAndStoreBrandBrain(db, id) : await deriveBrandBrain(db, brand)
    if (!result) {
      console.log("derivation failed -- see the error above")
      continue
    }
    console.log(JSON.stringify({ derived: result.brain, sources: result.status.sources, dropped_unquoted: result.dropped }, null, 2))
  }
}

main().catch((err) => {
  console.error("[derive-brand-brain] failed:", err)
  process.exit(1)
})
