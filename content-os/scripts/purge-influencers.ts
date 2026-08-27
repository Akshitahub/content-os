/**
 * One-time cleanup: permanently deletes every row in the `influencers`,
 * `influencer_partnerships`, and `outreach_messages` tables, ahead of
 * dropping all three entirely (see
 * supabase/migrations/046_drop_influencer_tables.sql).
 *
 * The Creators (Influencers) feature's UI/API reachability was already
 * removed (no route creates or serves influencer data anymore) — this
 * script destroys the data that's left over. Unlike memes (see
 * purge-memes.ts), none of these three tables reference Supabase Storage —
 * avatar_url/profile_url are third-party scraped CDN URLs (Instagram/
 * TikTok/YouTube/LinkedIn's own hosting), never re-hosted into this app's
 * own bucket — so there's no storage cleanup step here, just row deletion.
 * IRREVERSIBLE. Standalone script, not part of the app bundle, not a
 * recurring cron — run this by hand, once.
 *
 * Order matters:
 *   1. Run this script (deletes outreach_messages and
 *      influencer_partnerships first, then influencers — child tables
 *      before the parent they reference, even though both have
 *      ON DELETE CASCADE from influencers, for an explicit per-table count
 *      rather than relying on cascade to do it silently).
 *   2. Confirm it printed 0 remaining rows in all three tables.
 *   3. Then run supabase/migrations/046_drop_influencer_tables.sql in the
 *      Supabase SQL Editor to drop the tables themselves.
 *
 * Dry-run by default — prints what would be deleted without deleting
 * anything. Pass --yes to actually delete.
 *
 * Run:
 *   npx tsx scripts/purge-influencers.ts            # dry run
 *   npx tsx scripts/purge-influencers.ts --yes       # actually deletes
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY — same two
 * vars lib/supabase/server.ts's createAdminClient() uses. Loaded from
 * .env.local automatically below if present.
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
}) as any

async function purgeTable(table: string, dryRun: boolean): Promise<void> {
  const { data, error } = await supabase.from(table).select("id")
  if (error) {
    console.error(`Failed to fetch ${table}:`, error.message)
    process.exit(1)
  }

  const rows = (data ?? []) as { id: string }[]
  console.log(`Found ${rows.length} row(s) in ${table}.`)
  if (rows.length === 0) {
    console.log(`Nothing to delete in ${table}.`)
    return
  }

  if (dryRun) {
    console.log(`DRY RUN — would delete ${rows.length} row(s) from ${table}. Ids:`, rows.map((r) => r.id).join(", "))
    return
  }

  const { error: deleteError } = await supabase.from(table).delete().in("id", rows.map((r) => r.id))
  if (deleteError) {
    console.error(`Row deletion failed for ${table}:`, deleteError.message)
    process.exit(1)
  }
  console.log(`Deleted ${rows.length} row(s) from ${table}.`)

  const { count, error: verifyError } = await supabase.from(table).select("*", { count: "exact", head: true })
  if (verifyError) {
    console.error(`Couldn't verify remaining row count for ${table}:`, verifyError.message)
    return
  }
  console.log(`Remaining rows in ${table}: ${count ?? "unknown"}.`)
}

async function main(): Promise<void> {
  const dryRun = !process.argv.includes("--yes")
  if (dryRun) console.log("DRY RUN mode — nothing will be deleted. Re-run with --yes to actually delete.\n")

  // Child tables first (both reference influencer_id, ON DELETE CASCADE
  // from influencers) -- deleted explicitly rather than relying on cascade,
  // so each table gets its own confirmed count.
  await purgeTable("outreach_messages", dryRun)
  await purgeTable("influencer_partnerships", dryRun)
  await purgeTable("influencers", dryRun)

  if (dryRun) {
    console.log("\nDRY RUN complete — nothing was deleted. Re-run with --yes to actually delete.")
  } else {
    console.log("\nIf all three tables above show 0 remaining rows, it's safe to now run supabase/migrations/046_drop_influencer_tables.sql in the Supabase SQL Editor.")
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err)
  process.exit(1)
})
