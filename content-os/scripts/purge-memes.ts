/**
 * One-time cleanup: permanently deletes every row in the `memes` table and
 * their storage files, ahead of dropping the table entirely (see
 * supabase/migrations/033_drop_memes_table.sql).
 *
 * The Memes feature's UI/API reachability was already removed (no route
 * creates or serves new memes) — this script destroys the data that's
 * left over. IRREVERSIBLE. Standalone script, not part of the app bundle,
 * not a recurring cron — run this by hand, once.
 *
 * Order matters:
 *   1. Run this script (deletes storage files, then table rows).
 *   2. Confirm it printed 0 remaining rows.
 *   3. Then run supabase/migrations/033_drop_memes_table.sql in the
 *      Supabase SQL Editor to drop the table itself.
 * Do this BEFORE deploying the commit that removes the cleanup cron's
 * meme-handling block and the account-deletion route's meme storage-path
 * collection — those exist specifically to keep meme storage files from
 * orphaning while the `memes` table still has rows in it. Running this
 * script first empties the table, so by the time that code is removed
 * there's nothing left for it to have been protecting.
 *
 * Dry-run by default — prints what would be deleted without deleting
 * anything. Pass --yes to actually delete.
 *
 * Run:
 *   npx tsx scripts/purge-memes.ts            # dry run
 *   npx tsx scripts/purge-memes.ts --yes       # actually deletes
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

const supabase = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Matches app/api/v1/cron/cleanup-abandoned-drafts/route.ts and
// app/api/v1/user/account/route.ts's identical helper — memes.image_url is
// a full public URL into this bucket, not a bare storage path.
const STORAGE_BUCKET = "published-media"

function extractStoragePath(publicUrl: string, bucket: string): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`
  const idx = publicUrl.indexOf(marker)
  if (idx === -1) return null
  try {
    return decodeURIComponent(publicUrl.slice(idx + marker.length))
  } catch {
    return publicUrl.slice(idx + marker.length)
  }
}

interface MemeRow {
  id: string
  image_url: string | null
}

async function main(): Promise<void> {
  const dryRun = !process.argv.includes("--yes")

  const { data, error } = await supabase.from("memes").select("id, image_url").returns<MemeRow[]>()
  if (error) {
    console.error("Failed to fetch memes:", error.message)
    process.exit(1)
  }

  const rows = data ?? []
  console.log(`Found ${rows.length} meme row(s).`)
  if (rows.length === 0) {
    console.log("Nothing to delete.")
    return
  }

  const paths = rows
    .map((r) => (r.image_url ? extractStoragePath(r.image_url, STORAGE_BUCKET) : null))
    .filter((p): p is string => !!p)
  console.log(`${paths.length} of those rows have a resolvable storage file in "${STORAGE_BUCKET}".`)

  if (dryRun) {
    console.log("\nDRY RUN — nothing was deleted. Re-run with --yes to actually delete.")
    console.log("Row ids:", rows.map((r) => r.id).join(", "))
    return
  }

  if (paths.length > 0) {
    const { error: removeError, data: removed } = await supabase.storage.from(STORAGE_BUCKET).remove(paths)
    if (removeError) {
      console.error("Storage removal failed, aborting before touching table rows:", removeError.message)
      process.exit(1)
    }
    console.log(`Deleted ${removed?.length ?? paths.length} storage file(s).`)
  }

  const { error: deleteError } = await supabase.from("memes").delete().in("id", rows.map((r) => r.id))
  if (deleteError) {
    console.error("Row deletion failed (storage files were already removed above):", deleteError.message)
    process.exit(1)
  }
  console.log(`Deleted ${rows.length} row(s) from memes.`)

  const { count, error: verifyError } = await supabase.from("memes").select("*", { count: "exact", head: true })
  if (verifyError) {
    console.error("Couldn't verify remaining row count:", verifyError.message)
    return
  }
  console.log(`Remaining rows in memes: ${count ?? "unknown"}.`)
  if ((count ?? 0) === 0) {
    console.log("Safe to now run supabase/migrations/033_drop_memes_table.sql in the Supabase SQL Editor.")
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err)
  process.exit(1)
})
