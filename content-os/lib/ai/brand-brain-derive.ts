import { after } from "next/server"
import { z } from "zod"
import type { BrandRow, ProductRow } from "@/types/database"
import { createCreativeCompletion } from "./creative-completion"
import { artDirectionFrom } from "./brand-brain"
import { resolveTypography } from "@/lib/design/fonts"
import { isMissingBrandBrainColumn } from "@/lib/brand-brain-profile"

/**
 * Brand Brain fills itself (migration 065): the fields the brand page used
 * to ask the user to type -- differentiators, phrases_to_avoid,
 * claims_never_to_make, objections, avoid_visuals, photography_style,
 * fonts -- derived in the background from what SocioPosts can read: the
 * website (home, about, product, FAQ / review pages), the brand's recent
 * Instagram captions, its products. Each derived field is marked auto;
 * a user edit marks it auto: false and re-derivation never touches it.
 *
 * Rules: differentiators only as the brand itself states them (each must
 * quote the sources); objections only from real reviews / FAQ (empty when
 * there are none); claims_never_to_make always carries the safe defaults;
 * photography_style and fonts are read from the art direction / the
 * brand's typography so they never disagree with what generation uses.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export const DERIVED_FIELDS = {
  differentiators: "facts",
  phrases_to_avoid: "voice",
  claims_never_to_make: "voice",
  objections: "strategy",
  avoid_visuals: "visual",
  photography_style: "visual",
  heading_font: "visual",
  body_font: "visual",
} as const
export type DerivedField = keyof typeof DERIVED_FIELDS

export interface DerivationStatus {
  status: "running" | "done" | "failed"
  started_at: string
  finished_at?: string
  /** Which sources it actually read. */
  sources?: { website_pages: number; instagram_captions: number; products: number; reviews_or_faq: boolean }
  error?: string
}

export interface DerivedBrain {
  facts: { differentiators: string[] }
  voice: { phrases_to_avoid: string[]; claims_never_to_make: string[] }
  strategy: { objections: string[] }
  visual: { avoid_visuals: string[]; photography_style?: string; heading_font: string; body_font: string }
}

const MAX_PAGE_CHARS = 3500
const MAX_SOURCE_CHARS = 16_000
const RUNNING_STALE_MS = 10 * 60_000

// Always on the never-say list, whatever the category.
function safeDefaultClaims(sourceText: string): string[] {
  const says = (re: RegExp) => re.test(sourceText)
  return [
    "Cure, treat or heal claims, or any medical claim",
    ...(says(/clinically\s+(proven|tested)/i) ? [] : ["Clinically proven"]),
    ...(says(/dermatologist[s]?\s+(tested|approved|recommended)/i) ? [] : ["Dermatologist tested"]),
    "Cheapest",
    "Best in India",
    "Guaranteed results or any guarantee",
  ]
}

// ─── Sources ───────────────────────────────────────────────────────────────

type Source = { label: string; text: string; kind: "website" | "reviews_or_faq" | "instagram" | "product" }

const LINK_PATTERNS: { kind: Source["kind"]; label: string; re: RegExp }[] = [
  { kind: "website", label: "ABOUT PAGE", re: /\/(about|about-us|our-story|story|who-we-are)(\/|$|\?)/i },
  { kind: "reviews_or_faq", label: "FAQ PAGE", re: /\/(faq|faqs|help|questions)(\/|$|\?)/i },
  { kind: "reviews_or_faq", label: "REVIEWS PAGE", re: /\/(reviews|testimonials|customer-reviews)(\/|$|\?)/i },
  { kind: "website", label: "PRODUCT PAGE", re: /\/products?\/[^/?#]+/i },
]

function linksIn(html: string, base: string): string[] {
  const out = new Set<string>()
  for (const m of html.matchAll(/href="([^"#]+)"/gi)) {
    try {
      const u = new URL(m[1]!, base)
      if (u.host === new URL(base).host) out.add(u.toString().split("#")[0]!)
    } catch {
      // not a URL
    }
  }
  return [...out]
}

async function websiteSources(websiteUrl: string): Promise<Source[]> {
  const { fetchPage } = await import("@/lib/web/fetch-page")
  const home = await fetchPage(websiteUrl)
  const sources: Source[] = [{ label: "HOME PAGE", text: home.text.slice(0, MAX_PAGE_CHARS), kind: "website" }]
  const links = linksIn(home.html, websiteUrl)
  const picked: { url: string; label: string; kind: Source["kind"] }[] = []
  for (const p of LINK_PATTERNS) {
    const matches = links.filter((l) => p.re.test(new URL(l).pathname))
    for (const url of matches.slice(0, p.label === "PRODUCT PAGE" ? 2 : 1)) picked.push({ url, label: p.label, kind: p.kind })
  }
  for (const p of picked) {
    try {
      const page = await fetchPage(p.url)
      sources.push({ label: p.label, text: page.text.slice(0, MAX_PAGE_CHARS), kind: p.kind })
    } catch {
      // one unreachable page is fine
    }
  }
  // Reviews / testimonials embedded on the home page itself count as reviews.
  if (/testimonial|customer reviews?|what (our )?customers say|★|⭐/i.test(home.text)) sources[0] = { ...sources[0]!, label: "HOME PAGE (includes customer reviews)", kind: "reviews_or_faq" }
  return sources
}

async function instagramCaptions(db: Db, brandId: string): Promise<string[]> {
  const { data: conn } = await db.from("social_connections").select("zernio_account_id").eq("brand_id", brandId).eq("platform", "instagram").eq("is_active", true).maybeSingle() as { data: { zernio_account_id: string | null } | null }
  if (!conn?.zernio_account_id) return []
  const { listZernioPostAnalytics } = await import("@/lib/social/zernio-client")
  const res = await listZernioPostAnalytics(conn.zernio_account_id, "instagram", 30)
  if (!res.ok) return []
  return res.items.map((i) => i.content?.trim() ?? "").filter((c) => c.length > 10).slice(0, 30)
}

// ─── The model call ────────────────────────────────────────────────────────

const quoted = z.object({ text: z.string().min(2).max(160), quote: z.string().max(300).default("") })
const responseSchema = z.object({
  category: z.string().max(80).default(""),
  differentiators: z.array(quoted).default([]),
  objections: z.array(quoted).default([]),
  phrases_to_avoid: z.array(z.string().max(80)).default([]),
  avoid_visuals: z.array(z.string().max(160)).default([]),
  category_claims_never_to_make: z.array(z.string().max(160)).default([]),
})

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()

/** A quote counts when its words appear in order in the source text (punctuation / case aside). */
function quoteFound(quote: string, sourceNorm: string): boolean {
  const q = norm(quote)
  return q.length >= 8 && sourceNorm.includes(q)
}

function buildPrompt(brand: Partial<BrandRow>, sources: Source[], products: Pick<ProductRow, "name" | "description">[]): string {
  const blocks = sources.map((s) => `--- ${s.label} ---\n${s.text}`).join("\n\n").slice(0, MAX_SOURCE_CHARS)
  return `Read what this brand says about itself and fill in its brand profile. Respond with JSON only.

BRAND: ${brand.name}${brand.niche ? ` (${brand.niche})` : ""}
${brand.description ? `Description: ${brand.description}\n` : ""}${products.length ? `Products: ${products.map((p) => `${p.name}${p.description ? ` -- ${p.description.slice(0, 140)}` : ""}`).join("; ")}\n` : ""}
SOURCES (the brand's own website pages and Instagram captions):
${blocks || "(none)"}

Return exactly:
{"category": "the product category in 1-3 words",
 "differentiators": [{"text": "what makes the brand different, in its own terms", "quote": "the exact words from the SOURCES that say it"}],
 "objections": [{"text": "a real customer concern or question", "quote": "the exact words from a REVIEWS or FAQ page"}],
 "phrases_to_avoid": ["words or phrases that clash with this brand's voice"],
 "avoid_visuals": ["images that would look wrong or generic for this brand"],
 "category_claims_never_to_make": ["claims risky or misleading for this category"]}

RULES
- differentiators: ONLY what the brand itself states in the SOURCES, 0-6 items, each with its exact quote. Never invent or embellish. If the sources state nothing distinctive, return [].
- objections: ONLY from a REVIEWS PAGE or FAQ PAGE above (or reviews quoted on the home page), 0-5 items with the exact quote. No reviews or FAQ -> [].
- phrases_to_avoid: 3-6, from the category and the brand's voice (e.g. hype words for a calm brand).
- avoid_visuals: 3-6 concrete visuals to avoid for this category.
- category_claims_never_to_make: 1-3 category-specific risky claims (e.g. "SPF without testing" for skincare, "fireproof" for fabrics). Not general ones.`
}

// ─── Derive + store ────────────────────────────────────────────────────────

export interface DerivationResult {
  brain: DerivedBrain
  status: DerivationStatus
  dropped: { differentiators: string[]; objections: string[] }
}

/** Reads the sources and derives the fields. Throws on a failed model call. */
export async function deriveBrandBrain(db: Db, brand: BrandRow): Promise<DerivationResult> {
  const started = new Date().toISOString()
  const sources: Source[] = []
  if (brand.website_url) {
    try {
      sources.push(...await websiteSources(brand.website_url))
    } catch (err) {
      console.error("[brand-brain-derive] website read failed (continuing):", err instanceof Error ? err.message : err)
    }
  }
  const captions = await instagramCaptions(db, brand.id).catch(() => [] as string[])
  if (captions.length) sources.push({ label: "INSTAGRAM CAPTIONS", text: captions.join("\n---\n").slice(0, MAX_PAGE_CHARS), kind: "instagram" })
  const { data: products } = await db.from("products").select("name, description, key_benefits").eq("brand_id", brand.id).limit(12) as { data: Pick<ProductRow, "name" | "description" | "key_benefits">[] | null }
  for (const p of products ?? []) sources.push({ label: `PRODUCT: ${p.name}`, text: [p.description, ...(p.key_benefits ?? [])].filter(Boolean).join(". ").slice(0, 600), kind: "product" })

  const res = await createCreativeCompletion({
    stage: "brand_brain",
    logPrefix: "ai/brand-brain-derive",
    system: "You are a careful brand strategist. You only state what the sources support. Respond with valid JSON only.",
    user: buildPrompt(brand, sources, products ?? []),
    reasoningEffort: "low",
    maxCompletionTokens: 2500,
    timeoutMs: 60_000,
  })
  const parsed = responseSchema.safeParse(JSON.parse(res.content ?? "{}"))
  if (!parsed.success) throw new Error(`brand brain response invalid: ${parsed.error.issues[0]?.message}`)
  const d = parsed.data

  const allText = norm(sources.map((s) => s.text).join("\n") + " " + (brand.description ?? ""))
  const reviewText = norm(sources.filter((s) => s.kind === "reviews_or_faq").map((s) => s.text).join("\n"))
  const kept = d.differentiators.filter((x) => quoteFound(x.quote, allText))
  const keptObjections = reviewText ? d.objections.filter((x) => quoteFound(x.quote, reviewText)) : []
  const dedupe = (list: string[]) => [...new Map(list.map((s) => [s.trim().toLowerCase(), s.trim()])).values()].filter(Boolean)

  const art = artDirectionFrom(brand)
  const typography = resolveTypography({ ...brand, brand_brain: null })
  const brain: DerivedBrain = {
    facts: { differentiators: dedupe(kept.map((x) => x.text)).slice(0, 6) },
    voice: {
      phrases_to_avoid: dedupe(d.phrases_to_avoid).slice(0, 6),
      claims_never_to_make: dedupe([...safeDefaultClaims(allText), ...d.category_claims_never_to_make]).slice(0, 8),
    },
    strategy: { objections: dedupe(keptObjections.map((x) => x.text)).slice(0, 5) },
    visual: {
      avoid_visuals: dedupe(d.avoid_visuals).slice(0, 6),
      ...(art?.photo_style ? { photography_style: art.photo_style } : {}),
      heading_font: typography.heading,
      body_font: typography.body,
    },
  }
  return {
    brain,
    status: {
      status: "done",
      started_at: started,
      finished_at: new Date().toISOString(),
      sources: {
        website_pages: sources.filter((s) => s.kind === "website" || s.kind === "reviews_or_faq").length,
        instagram_captions: captions.length,
        products: products?.length ?? 0,
        reviews_or_faq: !!reviewText,
      },
    },
    dropped: {
      differentiators: d.differentiators.filter((x) => !kept.includes(x)).map((x) => x.text),
      objections: d.objections.filter((x) => !keptObjections.includes(x)).map((x) => x.text),
    },
  }
}

/**
 * A Brand Brain value with nothing in it -- missing, null, [], "" or {}.
 * Such a value isn't the user's own even without field_meta: the Brand
 * Brain card saves an empty box as [], so auto-fill must still fill it.
 * Same rule as set_brand_brain_fields (migration 065).
 */
export function isEmptyBrainValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true
  if (Array.isArray(value)) return value.length === 0
  return typeof value === "object" && Object.keys(value as object).length === 0
}

function missingFunction(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === "PGRST202" || error.code === "42883" || /set_brand_brain_fields/.test(error.message ?? ""))
}

/**
 * Writes fields through set_brand_brain_fields (migration 065) -- auto ones
 * skip anything the user owns -- or, before 065, the same rules as a
 * read-merge-update. Never throws; resolves to whether it was saved.
 */
export async function writeBrainFields(db: Db, brandId: string, fields: Partial<Record<"facts" | "voice" | "strategy" | "visual", Record<string, unknown>>>, auto: boolean, status?: DerivationStatus): Promise<boolean> {
  const now = new Date().toISOString()
  const meta: Record<string, unknown> = {}
  for (const section of Object.values(fields)) for (const f of Object.keys(section ?? {})) meta[f] = auto ? { derived_at: now } : { edited_at: now }
  const { error } = await db.rpc("set_brand_brain_fields", { p_brand_id: brandId, p_fields: fields, p_meta: meta, p_auto: auto, p_status: status ?? null })
  if (!error) return true
  if (!missingFunction(error)) {
    console.error("[brand-brain-derive] couldn't save (non-fatal):", error.message)
    return false
  }
  // Before migration 065: the same rules, in a read-merge-update.
  const { data, error: readError } = await db.from("brands").select("brand_brain").eq("id", brandId).single() as { data: { brand_brain: unknown } | null; error: { message: string } | null }
  if (readError) {
    if (!isMissingBrandBrainColumn(readError)) console.error("[brand-brain-derive] couldn't save (non-fatal):", readError.message)
    return false
  }
  const brain = (data?.brand_brain && typeof data.brand_brain === "object" ? { ...(data.brand_brain as Record<string, unknown>) } : {}) as Record<string, Record<string, unknown>>
  const fieldMeta = { ...((brain.field_meta ?? {}) as Record<string, Record<string, unknown>>) }
  for (const [sec, section] of Object.entries(fields)) {
    for (const [f, value] of Object.entries(section ?? {})) {
      // The user's own: edited (auto: false), or a non-empty value from
      // before field_meta existed. An empty one is filled.
      const owned = fieldMeta[f]?.auto === false || (!(f in fieldMeta) && !isEmptyBrainValue(brain[sec]?.[f]))
      if (auto && owned) continue
      brain[sec] = { ...(brain[sec] ?? {}), [f]: value }
      fieldMeta[f] = { ...(meta[f] as Record<string, unknown>), auto }
    }
  }
  const next: Record<string, unknown> = { ...brain, field_meta: fieldMeta, ...(status ? { derivation: status } : {}) }
  const { error: updateError } = await db.from("brands").update({ brand_brain: next }).eq("id", brandId)
  if (updateError) console.error("[brand-brain-derive] couldn't save (non-fatal):", updateError.message)
  return !updateError
}

/** Derive and store, marking progress in brand_brain.derivation. Never throws. */
export async function deriveAndStoreBrandBrain(db: Db, brandId: string): Promise<DerivationResult | null> {
  const started = new Date().toISOString()
  try {
    const { data: brand } = await db.from("brands").select("*").eq("id", brandId).single() as { data: BrandRow | null }
    if (!brand) return null
    await writeBrainFields(db, brandId, {}, true, { status: "running", started_at: started })
    // photography_style comes from the art direction -- make sure there is one.
    if (!artDirectionFrom(brand)) {
      const { ensureArtDirection } = await import("./art-direction")
      await ensureArtDirection(db, brand)
    }
    const result = await deriveBrandBrain(db, brand)
    await writeBrainFields(db, brandId, result.brain as unknown as Record<"facts" | "voice" | "strategy" | "visual", Record<string, unknown>>, true, result.status)
    console.log(`[brand-brain-derive] ${brand.name}: derived (${result.brain.facts.differentiators.length} differentiators, ${result.brain.strategy.objections.length} objections)`)
    return result
  } catch (err) {
    console.error(`[brand-brain-derive] ${brandId} failed (non-fatal):`, err instanceof Error ? err.message : err)
    await writeBrainFields(db, brandId, {}, true, { status: "failed", started_at: started, finished_at: new Date().toISOString(), error: err instanceof Error ? err.message.slice(0, 200) : "failed" })
    return null
  }
}

// Brands with a derivation already queued in this instance.
const inFlight = new Set<string>()

/** Derive after the response (brand created / imported, or never derived yet). Call from a route handler. Never throws. */
export function scheduleBrandBrainDerivation(brandId: string): void {
  if (inFlight.has(brandId)) return
  inFlight.add(brandId)
  try {
    after(async () => {
      try {
        const { createAdminClient } = await import("@/lib/supabase/server")
        await deriveAndStoreBrandBrain(await createAdminClient(), brandId)
      } finally {
        inFlight.delete(brandId)
      }
    })
  } catch (err) {
    inFlight.delete(brandId)
    console.error("[brand-brain-derive] couldn't schedule (non-fatal):", err instanceof Error ? err.message : err)
  }
}

/** The brand's derivation status from brand_brain.derivation; a "running" one older than 10 minutes counts as failed. */
export function derivationStatusOf(brandBrain: unknown): DerivationStatus | null {
  const raw = brandBrain && typeof brandBrain === "object" ? (brandBrain as { derivation?: DerivationStatus }).derivation : undefined
  if (!raw || typeof raw !== "object" || !raw.status) return null
  if (raw.status === "running" && Date.now() - Date.parse(raw.started_at) > RUNNING_STALE_MS) return { ...raw, status: "failed", error: "timed out" }
  return raw
}
