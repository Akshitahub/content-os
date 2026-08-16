/**
 * One-off diagnostic: prospect_customer fit_score distribution.
 *
 * Read-only — no writes, no schema changes. Standalone script, not part of
 * the app bundle (no existing scripts/ directory or admin-script pattern
 * was found in this repo to match, so this establishes a minimal one).
 *
 * Run:
 *   npx tsx scripts/check-prospect-scores.ts              # all brands
 *   npx tsx scripts/check-prospect-scores.ts <brandId>     # one brand
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY — same two
 * vars lib/supabase/server.ts's createAdminClient() uses (note: the actual
 * URL env var in this repo is NEXT_PUBLIC_SUPABASE_URL, not SUPABASE_URL).
 * Loaded from .env.local automatically below if present — no dotenv
 * dependency needed, and nothing here is added to package.json.
 */
import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

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
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in .env.local or the environment.")
  process.exit(1)
}

const supabase = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

interface ProspectRow {
  handle: string
  fit_score: number | null
  fit_reasoning: string | null
  brand_id: string
}

function printRow(row: ProspectRow): void {
  console.log(`\n@${row.handle} (brand ${row.brand_id}) — score ${row.fit_score}`)
  console.log(row.fit_reasoning ?? "(no reasoning stored)")
}

async function main(): Promise<void> {
  const brandId = process.argv[2]

  let query = supabase
    .from("influencers")
    .select("handle, fit_score, fit_reasoning, brand_id")
    .eq("discovery_type", "prospect_customer")

  if (brandId) {
    query = query.eq("brand_id", brandId)
  }

  const { data, error } = await query.returns<ProspectRow[]>()

  if (error) {
    console.error("Query failed:", error.message)
    process.exit(1)
  }

  const rows = data ?? []
  if (rows.length === 0) {
    console.log(
      brandId
        ? `No prospect_customer rows found for brand ${brandId}.`
        : "No prospect_customer rows found for any brand."
    )
    return
  }

  console.log(`\nTotal prospect_customer rows: ${rows.length}${brandId ? ` (brand ${brandId})` : " (all brands)"}\n`)

  // ─── Histogram ────────────────────────────────────────────────────────
  const histogram = new Map<number, number>()
  for (let s = 1; s <= 10; s++) histogram.set(s, 0)
  let nullCount = 0

  for (const row of rows) {
    if (row.fit_score === null) {
      nullCount++
    } else {
      const bucket = Math.max(1, Math.min(10, Math.round(row.fit_score)))
      histogram.set(bucket, (histogram.get(bucket) ?? 0) + 1)
    }
  }

  console.log("fit_score histogram:")
  for (let s = 10; s >= 1; s--) {
    const count = histogram.get(s) ?? 0
    console.log(`  ${String(s).padStart(2)}: ${"#".repeat(count)} (${count})`)
  }
  console.log(`  null: ${"#".repeat(nullCount)} (${nullCount})`)

  const scored = rows.filter((r): r is ProspectRow & { fit_score: number } => r.fit_score !== null)
  const sortedDesc = [...scored].sort((a, b) => b.fit_score - a.fit_score)

  // ─── Top 3 highest-scored overall ────────────────────────────────────
  console.log("\n─── Top 3 highest-scored rows ───")
  for (const row of sortedDesc.slice(0, 3)) {
    printRow(row)
  }

  // ─── Top 3 highest-scored rows still below 9 ("almost made it") ──────
  console.log("\n─── Top 3 highest-scored rows still below 9 (\"almost made it\") ───")
  const belowNine = sortedDesc.filter((r) => r.fit_score < 9)
  if (belowNine.length === 0) {
    console.log("(none — no scored row is below 9)")
  } else {
    for (const row of belowNine.slice(0, 3)) {
      printRow(row)
    }
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err)
  process.exit(1)
})
