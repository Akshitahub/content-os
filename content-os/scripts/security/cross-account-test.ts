// Cross-account isolation test. Run MANUALLY against a deployment with two
// throwaway test accounts -- never in prod CI, never with real accounts:
//
//   BASE_URL=https://preview.example.com \
//   USER_A_EMAIL=... USER_A_PASSWORD=... USER_B_EMAIL=... USER_B_PASSWORD=... \
//   npm run security:isolation
//
// Also needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
// (read from the environment or .env.local).
//
// WARNING: user B really sends PUT / PATCH / DELETE requests and raw
// update / delete queries at user A's data. If isolation is broken, A's
// data WILL be changed or deleted -- that's the point, and why A must be a
// throwaway account. Updates write a column back to the value it already
// has; deletes are real.
//
// What it checks, as user B against user A's ids:
//   1. every app/api/v1/brands/[brandId]/** route (found by walking the
//      filesystem), with each method the route exports among GET, PUT,
//      PATCH, DELETE (POST too with INCLUDE_POST=1) -> must be 401/403/404
//   2. POST /api/v1/share for A's content, the share page and the
//      photo-link upload with forged / other-user tokens -> refused
//   3. raw Supabase select / update / delete as B (anon key + B's JWT) on
//      every public table, filtered by A's ids -> 0 rows
// Prints a pass/fail table; exits 1 on any failure.
import { existsSync, readdirSync, readFileSync, statSync } from "fs"
import { join, relative, sep } from "path"
import { randomBytes, randomUUID } from "crypto"
import { createServerClient } from "@supabase/ssr"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const ROOT = join(__dirname, "..", "..")

function loadEnvLocal(): void {
  const envPath = join(ROOT, ".env.local")
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

function need(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`Missing env var ${name}.`)
    process.exit(2)
  }
  return v
}

type Result = { area: string; check: string; detail: string; pass: boolean }
const results: Result[] = []
const record = (area: string, check: string, detail: string, pass: boolean) => results.push({ area, check, detail, pass })

// ── Sign-in: the cookies @supabase/ssr sets are exactly what the API routes read ──

type Session = { userId: string; accessToken: string; cookieHeader: string }

async function signIn(url: string, anonKey: string, email: string, password: string): Promise<Session> {
  const jar = new Map<string, string>()
  const ssr = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  })
  const { data, error } = await ssr.auth.signInWithPassword({ email, password })
  if (error || !data.session || !data.user) throw new Error(`Sign-in failed for ${email}: ${error?.message ?? "no session"}`)
  return {
    userId: data.user.id,
    accessToken: data.session.access_token,
    cookieHeader: [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
  }
}

function clientFor(url: string, anonKey: string, s: Session): SupabaseClient {
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${s.accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// ── A's ids ──

/** Dynamic route segment -> the table its id comes from. */
const SEGMENT_TABLES: Record<string, string> = {
  adId: "ad_copies",
  captionId: "captions",
  carouselId: "carousels",
  descId: "product_descriptions",
  entryId: "calendar_entries",
  hookId: "hooks",
  imageId: "generated_images",
  lessonId: "brand_lessons",
  postId: "blog_posts",
  productId: "products",
  scriptId: "reel_scripts",
  sequenceId: "email_sequences",
  storyId: "stories",
}

type Ids = { brandId: string; byTable: Record<string, string>; photoId: string | null; customerPhotoId: string | null }

async function collectIds(a: SupabaseClient, userId: string): Promise<Ids> {
  const { data: brands, error } = await a.from("brands").select("id").eq("user_id", userId).limit(1)
  if (error || !brands?.length) throw new Error(`User A has no brand to test with (${error?.message ?? "none found"}). Create one first.`)
  const brandId = brands[0]!.id as string
  const byTable: Record<string, string> = {}
  for (const table of new Set(Object.values(SEGMENT_TABLES))) {
    const { data } = await a.from(table).select("id").eq("brand_id", brandId).limit(1)
    if (data?.[0]?.id) byTable[table] = data[0].id as string
  }
  const { data: photo } = await a.from("brand_images").select("id").eq("brand_id", brandId).neq("source", "ugc").limit(1)
  const { data: ugc } = await a.from("brand_images").select("id").eq("brand_id", brandId).eq("source", "ugc").limit(1)
  return { brandId, byTable, photoId: (photo?.[0]?.id as string) ?? null, customerPhotoId: (ugc?.[0]?.id as string) ?? null }
}

// ── 1. Brand routes ──

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) routeFiles(full, out)
    else if (name === "route.ts") out.push(full)
  }
  return out
}

const EXPECTED = new Set([401, 403, 404])

async function hit(base: string, path: string, method: string, cookie: string, body?: string, extraHeaders: Record<string, string> = {}): Promise<number> {
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...extraHeaders },
      body,
      redirect: "manual",
    })
    await res.arrayBuffer().catch(() => {})
    return res.status
  } catch {
    return -1
  }
}

async function testBrandRoutes(base: string, b: Session, ids: Ids): Promise<void> {
  const brandDir = join(ROOT, "app", "api", "v1", "brands", "[brandId]")
  const methods = ["GET", "PUT", "PATCH", "DELETE", ...(process.env.INCLUDE_POST === "1" ? ["POST"] : [])]
  // DELETE last, so a broken route can't remove A's rows before the other methods are tried.
  const order = (m: string) => (m === "DELETE" ? 1 : 0)
  for (const file of routeFiles(brandDir).sort()) {
    const rel = relative(join(ROOT, "app"), file).split(sep).join("/").replace(/\/route\.ts$/, "")
    const source = readFileSync(file, "utf8")
    const exported = methods.filter((m) => new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b|export\\s+const\\s+${m}\\b`).test(source)).sort((x, y) => order(x) - order(y))
    let note = ""
    const path = "/" + rel.replace(/\[(\w+)\]/g, (_, seg: string) => {
      if (seg === "brandId") return ids.brandId
      const id = seg === "photoId"
        ? (rel.includes("customer-photos") ? ids.customerPhotoId : ids.photoId)
        : ids.byTable[SEGMENT_TABLES[seg] ?? ""] ?? null
      if (!id) note = ` (A has no ${seg}; random id)`
      return id ?? randomUUID()
    })
    for (const method of exported) {
      const status = await hit(base, path, method, b.cookieHeader, method === "GET" || method === "DELETE" ? undefined : "{}")
      const pass = EXPECTED.has(status)
      record("api", `${method} ${rel.replace(/^api\/v1/, "")}`, `${status}${status >= 200 && status < 300 ? " LEAK (2xx)" : pass ? "" : " unexpected"}${note}`, pass)
    }
  }
}

// ── 2. Share + photo-link ──

const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")

async function photoLinkUpload(base: string, token: string): Promise<number> {
  const form = new FormData()
  form.append("photo", new Blob([new Uint8Array(TINY_PNG)], { type: "image/png" }), "x.png")
  try {
    const res = await fetch(`${base}/api/v1/photo-link/${encodeURIComponent(token)}`, { method: "POST", body: form })
    await res.arrayBuffer().catch(() => {})
    return res.status
  } catch {
    return -1
  }
}

async function testShareAndPhotoLink(base: string, b: Session, ids: Ids, bClient: SupabaseClient): Promise<void> {
  const shareTargets: [string, string | undefined][] = [
    ["caption", ids.byTable.captions],
    ["carousel", ids.byTable.carousels],
    ["story", ids.byTable.stories],
    ["ad_copy", ids.byTable.ad_copies],
  ]
  for (const [contentType, contentId] of shareTargets) {
    const status = await hit(base, "/api/v1/share", "POST", b.cookieHeader, JSON.stringify({ brandId: ids.brandId, contentType, contentId: contentId ?? randomUUID() }))
    record("share", `B mints a share link for A's ${contentType}`, `${status}${contentId ? "" : " (A has none; random id)"}`, EXPECTED.has(status))
  }

  // A forged share token: the public page must not resolve it.
  const forged = randomBytes(24).toString("base64url")
  const pageStatus = await hit(base, `/p/${forged}`, "GET", "")
  record("share", "forged share token page", String(pageStatus), pageStatus === 404)

  // B asks for a photo link to A's brand.
  const linkStatus = await hit(base, `/api/v1/brands/${ids.brandId}/photo-link`, "POST", b.cookieHeader, "{}")
  record("photo-link", "B creates a photo link for A's brand", String(linkStatus), EXPECTED.has(linkStatus))

  // Forged tokens naming A's brand: random signature, and an expiry far ahead.
  const exp = (Math.floor(Date.now() / 1000) + 86_400).toString(36)
  for (const [label, token] of [
    ["random signature", `${ids.brandId}.${exp}.${randomBytes(32).toString("base64url")}`],
    ["no signature", `${ids.brandId}.${exp}`],
    ["garbage", "not-a-token"],
  ] as const) {
    const status = await photoLinkUpload(base, token)
    record("photo-link", `upload with forged token (${label})`, String(status), status === 401)
  }

  // B's own valid token with A's brand swapped in.
  const { data: bBrands } = await bClient.from("brands").select("id").eq("user_id", b.userId).limit(1)
  const bBrand = bBrands?.[0]?.id as string | undefined
  if (!bBrand) {
    record("photo-link", "B's token re-pointed at A's brand", "skipped: B has no brand", true)
    return
  }
  try {
    const res = await fetch(`${base}/api/v1/brands/${bBrand}/photo-link`, { method: "POST", headers: { cookie: b.cookieHeader, "content-type": "application/json" }, body: "{}" })
    const json = (await res.json().catch(() => null)) as { data?: { url?: string } } | null
    const bToken = json?.data?.url?.split("/send-photos/")[1]
    if (!bToken) {
      record("photo-link", "B's token re-pointed at A's brand", `skipped: couldn't mint B's link (${res.status})`, true)
      return
    }
    const swapped = decodeURIComponent(bToken).replace(bBrand, ids.brandId)
    const status = await photoLinkUpload(base, swapped)
    record("photo-link", "B's token re-pointed at A's brand", String(status), status === 401)
  } catch (err) {
    record("photo-link", "B's token re-pointed at A's brand", `error: ${err instanceof Error ? err.message : err}`, false)
  }
}

// ── 3. Raw Supabase as B ──

function publicTables(): string[] {
  const dir = join(ROOT, "supabase", "migrations")
  const names = new Set<string>()
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql"))) {
    for (const m of readFileSync(join(dir, f), "utf8").matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi)) names.add(m[1]!.toLowerCase())
  }
  return [...names].sort()
}

async function testRawQueries(bClient: SupabaseClient, a: Session, ids: Ids): Promise<void> {
  const aIds = [ids.brandId, ...Object.values(ids.byTable), ids.photoId, ids.customerPhotoId].filter((x): x is string => !!x)
  for (const table of publicTables()) {
    // Which of A's ids this table can be filtered by: brand_id, user_id, or id.
    let filter: { col: string; values: string[] } | null = null
    for (const candidate of [
      { col: "brand_id", values: [ids.brandId] },
      { col: "user_id", values: [a.userId] },
      { col: "id", values: table === "users" ? [a.userId] : aIds },
    ]) {
      const probe = await bClient.from(table).select(candidate.col).limit(0)
      if (!probe.error) {
        filter = candidate
        break
      }
    }
    if (!filter) {
      record("db", `${table}`, "skipped: no brand_id / user_id / id column visible to B (or table missing)", true)
      continue
    }
    const { col, values } = filter

    const sel = await bClient.from(table).select(col).in(col, values)
    record("db", `select ${table} by ${col}`, sel.error ? `error (ok): ${sel.error.code ?? sel.error.message}` : `${sel.data?.length ?? 0} rows`, (sel.data?.length ?? 0) === 0)

    // Writes the column back to the value it already has -- harmless if allowed, but it must not be.
    let updated = 0
    for (const v of values) {
      const up = await bClient.from(table).update({ [col]: v }).eq(col, v).select(col)
      updated += up.data?.length ?? 0
    }
    record("db", `update ${table} by ${col}`, `${updated} rows`, updated === 0)
  }
  // Deletes last, after every read / update check has run.
  for (const table of publicTables()) {
    for (const [col, values] of [["brand_id", [ids.brandId]], ["user_id", [a.userId]]] as const) {
      const probe = await bClient.from(table).select(col).limit(0)
      if (probe.error) continue
      const del = await bClient.from(table).delete().in(col, [...values]).select(col)
      record("db", `delete ${table} by ${col}`, `${del.data?.length ?? 0} rows`, (del.data?.length ?? 0) === 0)
      break
    }
  }
}

// ── Report ──

function printTable(): void {
  const w = { area: 10, check: 62 }
  const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n))
  console.log(`\n${pad("AREA", w.area)} ${pad("CHECK", w.check)} RESULT`)
  console.log("-".repeat(w.area + w.check + 30))
  for (const r of results) console.log(`${pad(r.area, w.area)} ${pad(r.check, w.check)} ${r.pass ? "PASS" : "FAIL"}  ${r.detail}`)
  const failed = results.filter((r) => !r.pass).length
  console.log(`\n${results.length - failed} passed, ${failed} failed`)
}

async function main() {
  loadEnvLocal()
  const base = need("BASE_URL").replace(/\/+$/, "")
  const url = need("NEXT_PUBLIC_SUPABASE_URL")
  const anon = need("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  const a = await signIn(url, anon, need("USER_A_EMAIL"), need("USER_A_PASSWORD"))
  const b = await signIn(url, anon, need("USER_B_EMAIL"), need("USER_B_PASSWORD"))
  if (a.userId === b.userId) throw new Error("USER_A and USER_B are the same account.")

  const ids = await collectIds(clientFor(url, anon, a), a.userId)
  console.log(`A: user ${a.userId}, brand ${ids.brandId}; ids found for: ${Object.keys(ids.byTable).join(", ") || "none"}${ids.photoId ? ", photo" : ""}${ids.customerPhotoId ? ", customer photo" : ""}`)
  console.log(`B: user ${b.userId} -- testing against ${base}`)

  const bClient = clientFor(url, anon, b)
  await testBrandRoutes(base, b, ids)
  await testShareAndPhotoLink(base, b, ids, bClient)
  await testRawQueries(bClient, a, ids)

  printTable()
  process.exit(results.some((r) => !r.pass) ? 1 : 0)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
