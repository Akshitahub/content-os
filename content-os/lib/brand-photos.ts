import { createHash } from "crypto"
import { after } from "next/server"
import sharp from "sharp"
import { z } from "zod"
import type { BrandRow, ProductRow } from "@/types/database"
import { MODELS, getOpenAIClient } from "@/lib/ai/models"

/**
 * The brand's own real photos, collected automatically -- never an upload
 * step for the user (migration 064):
 * - website: the images on the brand's site (brands/import saves the home
 *   page's; a backfill / website change re-runs it);
 * - Instagram: the brand's own recent media (images and carousel children,
 *   no videos, latest 60) through its active Instagram connection.
 * Every image is copied into our storage (Instagram URLs expire -- never
 * hotlinked) and classified ONCE by one vision call: kind, quality_ok,
 * product_id and a one-line description (migration 066). rankPhotoCandidates
 * orders them for a post (never another product's photo); lib/ai/photo-fit.ts
 * then uses one only when its description fits the post's brief and copy.
 * Fail-soft everywhere: no photos = today's behaviour.
 */

export const PHOTO_KINDS = ["product_only", "product_in_use", "person", "lifestyle", "flatlay", "graphic_or_text"] as const
export type PhotoKind = (typeof PHOTO_KINDS)[number]

/** Which kinds each use prefers, best first. */
export const PHOTO_KINDS_FOR: Record<"story" | "post" | "annotated_product", PhotoKind[]> = {
  story: ["person", "product_in_use", "lifestyle", "flatlay"],
  post: ["person", "product_in_use", "lifestyle", "flatlay", "product_only"],
  annotated_product: ["product_only"],
}

export interface BrandPhoto {
  id: string
  brand_id: string
  url: string
  kind: PhotoKind | null
  quality_ok: boolean | null
  product_id: string | null
  source: "website" | "instagram" | "upload"
  published_at: string | null
  use_count: number
  last_used_at: string | null
  /** One plain line: what the photo shows, setting, people, product (migration 066). Null until described. */
  description: string | null
}

const BUCKET = "brand-images"
const MIN_SIDE_PX = 800
const MAX_SIDE_PX = 2048
const INSTAGRAM_MEDIA_LIMIT = 60
const WEBSITE_IMAGE_LIMIT = 30
const REFRESH_AFTER_DAYS = 7
const OWN_POST_COOLDOWN_DAYS = 30
const FETCH_TIMEOUT_MS = 15_000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 24)

/** An image's bytes, or null (not an image, too big, unreachable). Also used
 * by generation routes to read a picked photo (text style, compositing). */
export async function download(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { "User-Agent": "Mozilla/5.0 (SocioPosts photo collector)" } })
    if (!res.ok) return null
    const type = res.headers.get("content-type") ?? ""
    if (type && !type.startsWith("image/")) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length > 0 && buf.length <= 20 * 1024 * 1024 ? buf : null
  } catch {
    return null
  }
}

/** Our own copy (JPEG, longest side <= 2048) in storage; its public URL and metadata. */
async function storeCopy(db: Db, brand: Pick<BrandRow, "id" | "user_id">, externalId: string, original: Buffer) {
  const meta = await sharp(original).metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  const jpeg = await sharp(original).rotate().resize(MAX_SIDE_PX, MAX_SIDE_PX, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer()
  const path = `${brand.user_id}/${brand.id}/photos/${externalId}.jpg`
  const { error } = await db.storage.from(BUCKET).upload(path, jpeg, { contentType: "image/jpeg", upsert: true })
  if (error) throw new Error(`storage upload failed: ${error.message}`)
  const { data } = db.storage.from(BUCKET).getPublicUrl(path)
  return { url: data.publicUrl as string, path, width, height }
}

// ─── Sources ───────────────────────────────────────────────────────────────

/** The brand's website images (absolute URLs), from its home page. */
async function websiteImageUrls(websiteUrl: string): Promise<string[]> {
  const { fetchPage } = await import("@/lib/web/fetch-page")
  const { extractImagesFromPage } = await import("@/lib/ai/url-extractor")
  const page = await fetchPage(websiteUrl)
  return extractImagesFromPage(websiteUrl, page.html).map((i) => i.url).slice(0, WEBSITE_IMAGE_LIMIT)
}

type InstagramImage = { externalId: string; url: string; publishedAt: string | null }

/**
 * The brand's own recent Instagram images: images and carousel children,
 * never videos. Read through the account's Zernio connection (the Meta
 * token lives there); the image URL is read from whichever field Zernio's
 * item carries it in.
 */
async function instagramImages(zernioAccountId: string): Promise<InstagramImage[]> {
  const { listZernioPostAnalytics } = await import("@/lib/social/zernio-client")
  const res = await listZernioPostAnalytics(zernioAccountId, "instagram", INSTAGRAM_MEDIA_LIMIT)
  if (!res.ok) throw new Error(res.error)
  const out: InstagramImage[] = []
  for (const raw of res.items as Record<string, unknown>[]) {
    const type = String(raw.mediaType ?? raw.media_type ?? "").toUpperCase()
    if (type.includes("VIDEO") || type.includes("REEL")) continue
    const postId = String(raw.platformPostUrl ?? raw.permalink ?? raw.id ?? "")
    if (!postId) continue
    const publishedAt = typeof raw.publishedAt === "string" ? raw.publishedAt : null
    const children = (raw.children ?? raw.mediaItems ?? raw.media ?? raw.carouselItems) as unknown
    const childList = Array.isArray(children) ? children : (children as { data?: unknown[] } | undefined)?.data
    const urls: string[] = []
    if (Array.isArray(childList) && childList.length) {
      for (const c of childList as Record<string, unknown>[]) {
        const ct = String(c.mediaType ?? c.media_type ?? c.type ?? "").toUpperCase()
        if (ct.includes("VIDEO")) continue
        const u = c.mediaUrl ?? c.media_url ?? c.url ?? c.imageUrl
        if (typeof u === "string") urls.push(u)
      }
    } else {
      const u = raw.mediaUrl ?? raw.media_url ?? raw.imageUrl ?? raw.thumbnailUrl ?? raw.thumbnail_url
      if (typeof u === "string") urls.push(u)
    }
    urls.forEach((url, i) => out.push({ externalId: `ig-${hash(`${postId}#${i}`)}`, url, publishedAt }))
  }
  return out
}

// ─── Classification (one vision call per image, once) ──────────────────────

const classificationSchema = z.object({
  kind: z.enum(PHOTO_KINDS),
  quality_ok: z.boolean(),
  product_index: z.number().int().nullable().optional(),
  description: z.string().max(400).optional(),
  reason: z.string().optional(),
})

async function classify(url: string, products: Pick<ProductRow, "id" | "name">[]): Promise<{ kind: PhotoKind; quality_ok: boolean; product_id: string | null; description: string | null } | null> {
  const productList = products.length ? products.map((p, i) => `${i}: ${p.name}`).join("\n") : "(none)"
  try {
    const res = await getOpenAIClient().chat.completions.create({
      model: MODELS.vision,
      reasoning_effort: "low",
      max_completion_tokens: 400,
      response_format: { type: "json_object" },
      messages: [{
        role: "user",
        content: [
          { type: "text", text: `Classify this brand photo for reuse in its social media posts. Respond with JSON only:
{"kind": "product_only | product_in_use | person | lifestyle | flatlay | graphic_or_text", "quality_ok": true|false, "product_index": <the number of the product shown, from the list, or null>, "description": "one plain line: what the photo shows, the setting, any people (and what they're doing), and the product if visible -- e.g. 'a woman pouring kesar oil from a small glass bottle into her palm at a bathroom sink, morning window light'", "reason": "a few words"}

kind: product_only = the product alone (packshot); product_in_use = someone using / wearing it; person = mainly a person; lifestyle = a scene or setting; flatlay = items arranged from above; graphic_or_text = a designed graphic, banner, poster, screenshot or mostly text.
quality_ok is false for: blurry or noisy photos, screenshots, banners or images mostly covered by text or graphics, collages, low-resolution or heavily compressed images. Otherwise true.
The brand's products:
${productList}` },
          { type: "image_url", image_url: { url } },
        ],
      }],
    }, { timeout: 30_000, maxRetries: 1 })
    const parsed = classificationSchema.safeParse(JSON.parse(res.choices[0]?.message?.content ?? "{}"))
    if (!parsed.success) return null
    const p = parsed.data.product_index
    return {
      kind: parsed.data.kind,
      quality_ok: parsed.data.quality_ok && parsed.data.kind !== "graphic_or_text",
      product_id: p != null && p >= 0 && p < products.length ? products[p]!.id : null,
      description: parsed.data.description?.trim() || null,
    }
  } catch (err) {
    console.error("[brand-photos] classification failed (will retry next sync):", err instanceof Error ? err.message : err)
    return null
  }
}

// Until migration 066 adds brand_images.description, a write that includes it
// is retried without it, and reads fall back to the columns without it.
const isMissingDescription = (error: { message?: string } | null | undefined) => !!error?.message && /description/.test(error.message) && /column|schema cache/i.test(error.message)

async function updatePhoto(db: Db, id: string, fields: Record<string, unknown>): Promise<void> {
  const { error } = await db.from("brand_images").update(fields).eq("id", id)
  if (isMissingDescription(error)) {
    const { description: _d, ...rest } = fields
    void _d
    await db.from("brand_images").update(rest).eq("id", id)
  }
}

const DESCRIBE_PER_RUN = 30

/** Describes classified, usable photos that have no description yet. Returns how many. Never throws. */
async function backfillDescriptions(db: Db, brandId: string): Promise<number> {
  try {
    const { data, error } = await db.from("brand_images").select("id, url").eq("brand_id", brandId).eq("quality_ok", true).not("classified_at", "is", null).is("description", null).limit(DESCRIBE_PER_RUN)
    if (error || !data?.length) return 0
    const { data: products } = await db.from("products").select("id, name").eq("brand_id", brandId)
    let described = 0
    for (const row of data as { id: string; url: string }[]) {
      const result = await classify(row.url, products ?? [])
      if (!result?.description) continue
      const { error: updateError } = await db.from("brand_images").update({ description: result.description }).eq("id", row.id)
      if (updateError) break
      described++
    }
    return described
  } catch {
    return 0
  }
}

// ─── Sync ──────────────────────────────────────────────────────────────────

export interface PhotoSyncReport {
  found: number
  added: number
  classified: number
  /** Already-classified photos given a description this run (migration 066 backfill). */
  described: number
  passed: number
  kinds: Partial<Record<PhotoKind, number>>
  errors: string[]
}

/** Collects new photos (website and/or Instagram) and classifies every unclassified one. Never throws. */
export async function syncBrandPhotos(db: Db, brandId: string, opts: { website?: boolean; instagram?: boolean } = { website: true, instagram: true }): Promise<PhotoSyncReport> {
  const report: PhotoSyncReport = { found: 0, added: 0, classified: 0, described: 0, passed: 0, kinds: {}, errors: [] }
  try {
    const { data: brand } = await db.from("brands").select("id, user_id, website_url").eq("id", brandId).single() as { data: Pick<BrandRow, "id" | "user_id" | "website_url"> | null }
    if (!brand) throw new Error("brand not found")
    const { data: existing } = await db.from("brand_images").select("id, url, external_id, source, classified_at").eq("brand_id", brandId)
    const known = new Set<string>((existing ?? []).map((r: { external_id: string | null; url: string }) => r.external_id ?? `web-${hash(r.url)}`))

    const candidates: { externalId: string; url: string; source: "website" | "instagram"; publishedAt: string | null }[] = []
    if (opts.website && brand.website_url) {
      try {
        for (const url of await websiteImageUrls(brand.website_url)) candidates.push({ externalId: `web-${hash(url)}`, url, source: "website", publishedAt: null })
      } catch (err) {
        report.errors.push(`website: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (opts.instagram) {
      const { data: conn } = await db.from("social_connections").select("zernio_account_id").eq("brand_id", brandId).eq("platform", "instagram").eq("is_active", true).maybeSingle() as { data: { zernio_account_id: string | null } | null }
      if (conn?.zernio_account_id) {
        try {
          for (const img of await instagramImages(conn.zernio_account_id)) candidates.push({ ...img, source: "instagram" })
        } catch (err) {
          report.errors.push(`instagram: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
    report.found = candidates.length

    // New ones: downloaded, copied into storage, stored unclassified.
    for (const c of candidates) {
      if (known.has(c.externalId)) continue
      known.add(c.externalId)
      const bytes = await download(c.url)
      if (!bytes) continue
      try {
        const copy = await storeCopy(db, brand, c.externalId, bytes)
        const tooSmall = Math.max(copy.width, copy.height) < MIN_SIDE_PX
        const { error } = await db.from("brand_images").insert({
          brand_id: brandId, url: copy.url, storage_path: copy.path, external_id: c.externalId, source: c.source,
          published_at: c.publishedAt, type: c.source === "instagram" ? "instagram" : "website", is_active: true,
          // Under 800px is rejected outright -- no vision call spent on it.
          ...(tooSmall ? { quality_ok: false, classified_at: new Date().toISOString() } : {}),
        })
        if (!error) report.added++
        else report.errors.push(`insert: ${error.message}`)
      } catch (err) {
        report.errors.push(`store: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // Rows saved before 064 (brands/import hotlinked them): copied into storage first.
    for (const row of (existing ?? []) as { id: string; url: string; external_id: string | null }[]) {
      if (row.external_id) continue
      const bytes = await download(row.url)
      if (!bytes) {
        await db.from("brand_images").update({ quality_ok: false, classified_at: new Date().toISOString(), external_id: `web-${hash(row.url)}` }).eq("id", row.id)
        continue
      }
      try {
        const externalId = `web-${hash(row.url)}`
        const copy = await storeCopy(db, brand, externalId, bytes)
        const tooSmall = Math.max(copy.width, copy.height) < MIN_SIDE_PX
        await db.from("brand_images").update({
          url: copy.url, storage_path: copy.path, external_id: externalId, source: "website",
          ...(tooSmall ? { quality_ok: false, classified_at: new Date().toISOString() } : {}),
        }).eq("id", row.id)
      } catch (err) {
        report.errors.push(`store: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // Classify everything not yet classified -- once each.
    const { data: pending } = await db.from("brand_images").select("id, url").eq("brand_id", brandId).is("classified_at", null)
    if (pending?.length) {
      const { data: products } = await db.from("products").select("id, name").eq("brand_id", brandId)
      for (const row of pending as { id: string; url: string }[]) {
        const result = await classify(row.url, products ?? [])
        if (!result) continue
        await updatePhoto(db, row.id, { ...result, classified_at: new Date().toISOString() })
        report.classified++
      }
    }

    // Photos classified before migration 066 get their description here
    // (one vision call each, capped per run -- the weekly refresh finishes them).
    report.described = await backfillDescriptions(db, brandId)

    const { data: all } = await db.from("brand_images").select("kind, quality_ok").eq("brand_id", brandId)
    for (const r of (all ?? []) as { kind: PhotoKind | null; quality_ok: boolean | null }[]) {
      if (r.quality_ok) report.passed++
      if (r.kind) report.kinds[r.kind] = (report.kinds[r.kind] ?? 0) + 1
    }
    await db.from("brands").update({ photos_synced_at: new Date().toISOString() }).eq("id", brandId)
  } catch (err) {
    report.errors.push(err instanceof Error ? err.message : String(err))
    console.error(`[brand-photos] sync failed for ${brandId} (non-fatal):`, err instanceof Error ? err.message : err)
  }
  return report
}

// Brands with a sync already queued in this instance.
const inFlight = new Set<string>()

/** Sync after the response (brand created / imported, website changed). Call from a route handler. Never throws. */
export function scheduleBrandPhotoSync(brandId: string, opts?: { website?: boolean; instagram?: boolean }): void {
  if (inFlight.has(brandId)) return
  inFlight.add(brandId)
  try {
    after(async () => {
      try {
        const { createAdminClient } = await import("@/lib/supabase/server")
        await syncBrandPhotos(await createAdminClient(), brandId, opts)
      } finally {
        inFlight.delete(brandId)
      }
    })
  } catch (err) {
    inFlight.delete(brandId)
    console.error("[brand-photos] couldn't schedule a sync (non-fatal):", err instanceof Error ? err.message : err)
  }
}

/** The weekly refresh: brands with a website or Instagram not synced for 7 days -- new media only. */
export async function refreshStaleBrandPhotos(db: Db, opts: { limit?: number } = {}): Promise<{ brands: number }> {
  const cutoff = new Date(Date.now() - REFRESH_AFTER_DAYS * 86_400_000).toISOString()
  const { data } = await db.from("brands").select("id").or(`photos_synced_at.is.null,photos_synced_at.lt.${cutoff}`).limit(opts.limit ?? 20)
  for (const b of (data ?? []) as { id: string }[]) await syncBrandPhotos(db, b.id)
  return { brands: data?.length ?? 0 }
}

// ─── Picking ───────────────────────────────────────────────────────────────

const PHOTO_COLUMNS = "id, brand_id, url, kind, quality_ok, product_id, source, published_at, use_count, last_used_at"

/** The brand's usable photos of the wanted kinds (quality_ok, active), with descriptions when 066 has run. [] on any error. */
export async function loadBrandPhotos(db: Db, brand: Pick<BrandRow, "id">, kinds: PhotoKind[]): Promise<BrandPhoto[]> {
  try {
    const query = (cols: string) => db.from("brand_images").select(cols).eq("brand_id", brand.id).eq("quality_ok", true).eq("is_active", true).in("kind", kinds).limit(300)
    let { data, error } = await query(`${PHOTO_COLUMNS}, description`)
    if (isMissingDescription(error)) ({ data, error } = await query(PHOTO_COLUMNS))
    if (error) return []
    return ((data ?? []) as BrandPhoto[]).map((p) => ({ ...p, description: p.description ?? null }))
  } catch {
    return []
  }
}

/**
 * Candidate photos for one post / frame, best first (pure):
 * - with a product: that product's own photos first, then photos tied to NO
 *   product -- a photo of a different product is never a candidate (a
 *   kesar-oil post never gets the ghee jar);
 * - without one: photos tied to no product (person, lifestyle, flatlay)
 *   before any product's photo;
 * - then least used, the kinds' preference order, least recently used --
 *   never one in `exclude`, never the brand's own Instagram post from the
 *   last 30 days.
 */
export function rankPhotoCandidates(rows: BrandPhoto[], opts: { productId?: string | null; kinds: PhotoKind[]; exclude?: string[]; now?: number }): BrandPhoto[] {
  const cooldown = (opts.now ?? Date.now()) - OWN_POST_COOLDOWN_DAYS * 86_400_000
  const exclude = new Set(opts.exclude ?? [])
  const productTier = (p: BrandPhoto) => (opts.productId ? (p.product_id === opts.productId ? 0 : 1) : (p.product_id ? 1 : 0))
  return rows
    .filter((p) => !exclude.has(p.id))
    .filter((p) => !(opts.productId && p.product_id && p.product_id !== opts.productId))
    .filter((p) => !(p.source === "instagram" && p.published_at && Date.parse(p.published_at) > cooldown))
    .sort((a, b) =>
      productTier(a) - productTier(b)
      || a.use_count - b.use_count
      || opts.kinds.indexOf(a.kind!) - opts.kinds.indexOf(b.kind!)
      || (Date.parse(a.last_used_at ?? "1970-01-01") - Date.parse(b.last_used_at ?? "1970-01-01")))
}

/** The best `count` candidates, without a fit check (scripts / previews). Read-only. */
export async function pickBrandPhotos(db: Db, brand: Pick<BrandRow, "id">, opts: { productId?: string | null; kinds: PhotoKind[]; count: number; exclude?: string[] }): Promise<BrandPhoto[]> {
  return rankPhotoCandidates(await loadBrandPhotos(db, brand, opts.kinds), opts).slice(0, opts.count)
}

/** Records that photos were used, so the next pick prefers others. Never throws. */
export async function markBrandPhotosUsed(db: Db, photos: Pick<BrandPhoto, "id" | "use_count">[]): Promise<void> {
  try {
    const now = new Date().toISOString()
    await Promise.all(photos.map((p) => db.from("brand_images").update({ use_count: p.use_count + 1, last_used_at: now }).eq("id", p.id)))
  } catch (err) {
    console.error("[brand-photos] couldn't record use (non-fatal):", err instanceof Error ? err.message : err)
  }
}
