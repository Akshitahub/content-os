/**
 * One-off cleanup: finds Supabase Storage objects in "published-media" and
 * "brand-images" that no database row references, and (with --apply)
 * deletes the ones older than 14 days. Written when the project went over
 * the free-tier 1 GB storage limit.
 *
 * DRY RUN BY DEFAULT -- prints counts/sizes and sample paths, deletes
 * nothing. Pass --apply to actually delete (storage API remove(), batches
 * of 100 -- never SQL on storage.objects, which would leave the files).
 *
 * Run:
 *   npx tsx scripts/cleanup-orphan-storage.ts            # dry run
 *   npx tsx scripts/cleanup-orphan-storage.ts --apply    # deletes
 *
 * How references are found: rather than trusting a hand-kept column list
 * (columns known to hold storage refs today include generated_images.
 * storage_path, calendar_entries.platform_specific_data.{image_url,
 * image_urls,hosted_image_url,hosted_image_urls,base_image_url},
 * reel_video_jobs.scene_assets[].{videoUrl,audioUrl}, carousels.slides,
 * daily_draft_cache image URLs, products.image_urls, brands.logo_url --
 * see app/api/v1/user/account/route.ts), every table PostgREST exposes is
 * read from its OpenAPI schema and every text/varchar/json/jsonb/array
 * column is scanned, walking nested JSON. Any string containing a
 * /storage/v1/... URL counts as a reference to that bucket path; any
 * path-shaped bare string (e.g. generated_images.storage_path) counts as a
 * reference to that exact path. If any table fails to scan, --apply is
 * refused, since a missed table means missed references.
 *
 * A file is deletable ONLY if it is unreferenced AND older than 14 days
 * AND not a user-uploaded original (product reference photos, uploaded
 * post photos -- matched by the path patterns their upload routes use).
 * Carousel/story slide backgrounds and Ad Maker variation uploads are
 * never written to a DB row (they live in client state until scheduled),
 * so the 14-day window is what protects in-progress work.
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, loaded
 * from .env.local automatically if present.
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
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in .env.local or the environment.")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const APPLY = process.argv.includes("--apply")
const BUCKETS = ["published-media", "brand-images"] as const
const MIN_AGE_DAYS = 14
const LIST_PAGE = 1000
const ROW_PAGE = 1000
const REMOVE_BATCH = 100

// User-uploaded originals, never deleted even when unreferenced:
// images/generate-from-upload's upload-reference-*, ad-maker/generate's
// ad-maker-product-* (both brand-images), and fullpost/generate-from-photo's
// ${brandId}/uploaded-posts/ (published-media).
const PROTECTED_PATTERNS = [/\/upload-reference-/, /\/ad-maker-product-/, /\/uploaded-posts\//]

type StorageObject = { path: string; size: number; createdAt: Date }

// --- 1. List every object (paginated, recursing into folders) ---

// Transient "fetch failed" errors happen over a long recursive walk -- retry
// each page a few times before giving up on the whole run.
async function listPage(bucket: string, prefix: string, offset: number) {
  for (let attempt = 1; ; attempt++) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: LIST_PAGE, offset, sortBy: { column: "name", order: "asc" } })
    if (!error) return data ?? []
    if (attempt >= 4) throw new Error(`list ${bucket}/${prefix} failed: ${error.message}`)
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
  }
}

async function listBucket(bucket: string, prefix = ""): Promise<StorageObject[]> {
  const out: StorageObject[] = []
  if (prefix && !prefix.includes("/")) process.stdout.write(".")
  for (let offset = 0; ; offset += LIST_PAGE) {
    const data = await listPage(bucket, prefix, offset)
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.id === null) {
        out.push(...(await listBucket(bucket, path)))
      } else if (entry.name !== ".emptyFolderPlaceholder") {
        const size = Number((entry.metadata as { size?: number } | null)?.size ?? 0)
        out.push({ path, size, createdAt: new Date(entry.created_at ?? entry.updated_at ?? Date.now()) })
      }
    }
    if (data.length < LIST_PAGE) break
  }
  return out
}

// --- 2. Collect every referenced path from the database ---

const STORAGE_URL_RE = /\/storage\/v1\/(?:object|render\/image)\/(?:public|sign|authenticated)\/([^/\s"'?#]+)\/([^\s"'?#)\]<>]+)/g

type References = { urls: Map<string, Set<string>>; barePaths: Set<string> }

function addReferencesFrom(value: unknown, refs: References): void {
  if (typeof value === "string") {
    for (const m of value.matchAll(STORAGE_URL_RE)) {
      let path = m[2]!
      try { path = decodeURIComponent(path) } catch { /* keep raw */ }
      refs.urls.get(m[1]!)?.add(path)
    }
    if (value.length < 1024 && value.includes("/") && !/\s/.test(value) && !value.includes("://")) {
      refs.barePaths.add(value.replace(/^\/+/, ""))
    }
  } else if (Array.isArray(value)) {
    for (const v of value) addReferencesFrom(v, refs)
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) addReferencesFrom(v, refs)
  }
}

type OpenApiSpec = { definitions?: Record<string, { properties?: Record<string, { format?: string; type?: string }> }> }

const SCANNABLE_FORMAT = /text|character|json|\[\]/

async function scanDatabase(refs: References): Promise<{ tables: number; rows: number; failures: string[] }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, Accept: "application/openapi+json" },
  })
  if (!res.ok) throw new Error(`PostgREST schema fetch failed (${res.status})`)
  const spec = (await res.json()) as OpenApiSpec
  const failures: string[] = []
  let tables = 0
  let rows = 0

  for (const [table, def] of Object.entries(spec.definitions ?? {})) {
    const props = def.properties ?? {}
    const columns = Object.entries(props)
      .filter(([, p]) => SCANNABLE_FORMAT.test(p.format ?? "") || p.type === "array")
      .map(([name]) => name)
    if (columns.length === 0) continue
    tables++
    const orderBy = "id" in props ? "id" : columns[0]!
    for (let from = 0; ; from += ROW_PAGE) {
      const { data, error } = await supabase
        .from(table)
        .select(columns.map((c) => `"${c}"`).join(","))
        .order(orderBy, { ascending: true })
        .range(from, from + ROW_PAGE - 1)
      if (error) {
        failures.push(`${table}: ${error.message}`)
        break
      }
      for (const row of data ?? []) addReferencesFrom(row, refs)
      rows += (data ?? []).length
      if ((data ?? []).length < ROW_PAGE) break
    }
  }
  return { tables, rows, failures }
}

// --- 3/4. Classify, report, optionally delete ---

type Bucket = { count: number; bytes: number }
const mb = (b: Bucket) => `${b.count} files / ${(b.bytes / 1024 / 1024).toFixed(1)} MB`
const add = (b: Bucket, o: StorageObject) => { b.count++; b.bytes += o.size }

async function main(): Promise<void> {
  console.log(`Mode: ${APPLY ? "APPLY (will delete)" : "DRY RUN (nothing is deleted)"}\n`)

  const refs: References = { urls: new Map(BUCKETS.map((b) => [b, new Set<string>()])), barePaths: new Set() }
  const scan = await scanDatabase(refs)
  console.log(`Scanned ${scan.rows} rows across ${scan.tables} tables.`)
  if (scan.failures.length > 0) {
    console.warn(`WARNING: ${scan.failures.length} table(s) failed to scan -- references may be missing:`)
    for (const f of scan.failures) console.warn(`  ${f}`)
  }

  const cutoff = Date.now() - MIN_AGE_DAYS * 24 * 60 * 60 * 1000
  const deletableByBucket = new Map<string, string[]>()

  for (const bucket of BUCKETS) {
    const objects = await listBucket(bucket)
    const total: Bucket = { count: 0, bytes: 0 }
    const referenced: Bucket = { count: 0, bytes: 0 }
    const protectedUploads: Bucket = { count: 0, bytes: 0 }
    const recent: Bucket = { count: 0, bytes: 0 }
    const deletable: Bucket = { count: 0, bytes: 0 }
    const deletablePaths: string[] = []
    const bucketRefs = refs.urls.get(bucket)!

    for (const o of objects) {
      add(total, o)
      if (bucketRefs.has(o.path) || refs.barePaths.has(o.path) || refs.barePaths.has(`${bucket}/${o.path}`)) add(referenced, o)
      else if (PROTECTED_PATTERNS.some((re) => re.test(`/${o.path}`))) add(protectedUploads, o)
      else if (o.createdAt.getTime() > cutoff) add(recent, o)
      else {
        add(deletable, o)
        deletablePaths.push(o.path)
      }
    }
    deletableByBucket.set(bucket, deletablePaths)

    console.log(`\n=== ${bucket} ===`)
    console.log(`  total:                        ${mb(total)}`)
    console.log(`  referenced (kept):            ${mb(referenced)}`)
    console.log(`  user-upload original (kept):  ${mb(protectedUploads)}`)
    console.log(`  unreferenced, <${MIN_AGE_DAYS}d (kept):   ${mb(recent)}`)
    console.log(`  DELETABLE:                    ${mb(deletable)}`)
    if (deletablePaths.length > 0) {
      console.log(`  sample deletable paths:`)
      for (const p of deletablePaths.slice(0, 10)) console.log(`    ${p}`)
    }
  }

  if (!APPLY) {
    console.log(`\nDry run only. Re-run with --apply to delete the DELETABLE files above.`)
    return
  }
  if (scan.failures.length > 0) {
    console.error(`\nRefusing to --apply: some tables failed to scan (see warnings above).`)
    process.exit(1)
  }

  for (const [bucket, paths] of deletableByBucket) {
    let removed = 0
    for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
      const batch = paths.slice(i, i + REMOVE_BATCH)
      const { data, error } = await supabase.storage.from(bucket).remove(batch)
      if (error) {
        console.error(`[${bucket}] batch ${i / REMOVE_BATCH + 1} failed: ${error.message}`)
        continue
      }
      removed += data?.length ?? 0
    }
    console.log(`[${bucket}] removed ${removed}/${paths.length} files.`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
