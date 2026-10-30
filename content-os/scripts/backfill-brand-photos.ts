// One-off backfill for brand photos (lib/brand-photos.ts, migration 064):
// every brand with a website (and/or an active Instagram connection) gets
// its photos collected, copied into storage and classified -- the same
// syncBrandPhotos the import route and the weekly cron run.
//
//   npx tsx scripts/backfill-brand-photos.ts [--brand <brandId>] [--dry-run]
//
// --dry-run: no writes and no vision calls -- lists what each brand's
// website (and Instagram, when reachable) would give and how many images
// pass the 800px size check. Needs migration 064 for a real run.
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"

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

const DRY = process.argv.includes("--dry-run")
const only = process.argv.indexOf("--brand") !== -1 ? process.argv[process.argv.indexOf("--brand") + 1] : null

async function main() {
  const sharp = (await import("sharp")).default
  const { syncBrandPhotos } = await import("@/lib/brand-photos")
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

  let query = db.from("brands").select("id, name, website_url")
  if (only) query = query.eq("id", only)
  const { data: brands } = await query
  const { data: conns } = await db.from("social_connections").select("brand_id").eq("platform", "instagram").eq("is_active", true)
  const withInstagram = new Set((conns ?? []).map((c) => c.brand_id as string))
  const targets = (brands ?? []).filter((b) => b.website_url || withInstagram.has(b.id))
  console.log(`${targets.length} brand(s) with a website or Instagram${DRY ? " (dry run)" : ""}`)

  for (const b of targets) {
    if (DRY) {
      const { fetchPage } = await import("@/lib/web/fetch-page")
      const { extractImagesFromPage } = await import("@/lib/ai/url-extractor")
      let urls: string[] = []
      let note = ""
      if (b.website_url) {
        try {
          const page = await fetchPage(b.website_url)
          urls = extractImagesFromPage(b.website_url, page.html).map((i) => i.url).slice(0, 30)
        } catch (err) {
          note = ` (website: ${err instanceof Error ? err.message : String(err)})`
        }
      }
      let passed = 0
      for (const url of urls) {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
          if (!res.ok) continue
          const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata()
          if (Math.max(meta.width ?? 0, meta.height ?? 0) >= 800) passed++
        } catch {
          // unreadable -- not counted
        }
      }
      console.log(`${b.name.padEnd(28)} website images: ${urls.length}, >= 800px: ${passed}${withInstagram.has(b.id) ? " · has Instagram" : ""}${note}`)
      continue
    }
    const r = await syncBrandPhotos(db, b.id)
    console.log(`${b.name.padEnd(28)} found ${r.found}, added ${r.added}, classified ${r.classified}, passed ${r.passed}, kinds ${JSON.stringify(r.kinds)}${r.errors.length ? `, errors: ${r.errors.slice(0, 3).join(" | ")}` : ""}`)
  }
}

main().catch((err) => {
  console.error("[backfill-brand-photos] failed:", err)
  process.exit(1)
})
