import { createHash } from "crypto"
import type { ChatCompletionContentPart } from "openai/resources/chat/completions"
import type { BrandRow, ProductRow } from "@/types/database"
import { MODELS, getGroqClient, getOpenAIClient } from "./models"
import { artDirectionFrom, artDirectionSchema, type ArtDirection } from "./brand-brain"
import { buildBrandBrainLines, isMissingBrandBrainColumn, parseBrandBrain } from "@/lib/brand-brain-profile"

/**
 * Brand art direction: derived ONCE per brand with one model call from what's
 * already known (name, industry, description, Brand Brain profile, colours,
 * logo, product photos via vision when there are any; MODELS.creative
 * otherwise) and cached in
 * brands.brand_brain.art_direction. Re-derived only when the brand's colours /
 * description change (source_hash) or on an explicit refresh. Fail-soft
 * everywhere: no art direction = today's behaviour.
 */

// Always on the avoid list -- the default "AI lifestyle" scene.
const GENERIC_SCENE_AVOID = "the generic warm-beige desk / table-lamp / chai-mug lifestyle scene"
const DERIVE_TIMEOUT_MS = 30_000

type Brandish = Pick<BrandRow, "id" | "name" | "niche" | "description" | "primary_color" | "color_palette" | "logo_url" | "brand_brain"> & Partial<BrandRow>

/** The brand's own colours, as #rrggbb, primary first. */
export function brandColors(brand: Pick<BrandRow, "primary_color" | "color_palette">): string[] {
  const hexes: string[] = []
  const add = (v: unknown) => {
    if (typeof v !== "string") return
    const m = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(v.trim())
    if (!m) return
    const h = m[1]!.length === 3 ? m[1]!.split("").map((c) => c + c).join("") : m[1]!
    const hex = `#${h.toLowerCase()}`
    if (!hexes.includes(hex)) hexes.push(hex)
  }
  add(brand.primary_color)
  if (brand.color_palette && typeof brand.color_palette === "object") Object.values(brand.color_palette as Record<string, unknown>).forEach(add)
  return hexes
}

/** What the art direction depends on -- a change in any of these means re-derive. */
export function artDirectionSourceHash(brand: Brandish): string {
  return createHash("sha1")
    .update(JSON.stringify([brand.name, brand.niche, brand.description, brandColors(brand)]))
    .digest("hex")
    .slice(0, 16)
}

function buildPrompt(brand: Brandish, colors: string[], products: Pick<ProductRow, "name" | "description">[]): string {
  const profile = buildBrandBrainLines(parseBrandBrain(brand.brand_brain))
  return `You are the art director for an Indian D2C brand. Write the brand's art direction for its social media imagery, from what is known about it.

BRAND
Name: ${brand.name}
Industry: ${brand.niche ?? "unknown"}
Description: ${brand.description ?? "none given"}
${brand.target_audience ? `Audience: ${brand.target_audience}\n` : ""}${brand.vibe ? `Vibe: ${brand.vibe}\n` : ""}${profile.length ? `${profile.join("\n")}\n` : ""}${products.length ? `Products: ${products.map((p) => `${p.name}${p.description ? ` (${p.description.slice(0, 120)})` : ""}`).join("; ")}\n` : ""}Brand colours: ${colors.length ? colors.join(", ") : "none"}
${colors.length ? "" : "(No colours given.)"}

Respond with JSON only, exactly this shape:
{"palette":{"deep":"#rrggbb","base":"#rrggbb","accent":"#rrggbb","pop":"#rrggbb"},"mood":"3-5 words","motifs":["3-6 items"],"cultural_context":"one line","photo_style":"one line","avoid":["3-6 items"]}

RULES
- palette: deep = the darkest colour (for text and strips); base = the background / light colour; accent = the brand's signature colour; pop = a contrasting highlight.
${colors.length
    ? `- Build the palette FROM the brand colours: accent keeps the hue of ${colors[0]}; derive deep (a dark shade tinted toward it), base (a light tint or neutral that suits it) and pop (a contrasting highlight)${colors[1] ? `, using ${colors[1]} if it works` : ""}.`
    : "- The brand has no colours: invent a palette that fits this industry and mood. Make it distinctive -- not a generic preset (no stock violet or sunset gradients) and not beige-everything."}
- mood: 3-5 words.
- motifs: 3-6 CONCRETE, photographable props, materials or textures from this brand's actual world (e.g. marigolds, saffron threads, brass, block-print fabric) -- never abstract ideas.
- cultural_context: one specific line about the Indian setting and audience it lives in (kinds of homes, workplaces, cities, occasions) -- not clichés.
- photo_style: one line on lighting, saturation and framing.
- avoid: visual clichés never to use for this brand. Always include ${GENERIC_SCENE_AVOID}, plus anything else that reads as stock photography or an AI-default look for this industry.
${products.length ? "- The attached photos are the brand's real products: match the palette and world to them." : ""}`
}

/** Validated, with the code-side guarantees applied; null if unusable. */
function finalize(raw: unknown, colors: string[], sourceHash: string): ArtDirection | null {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const palette = (obj.palette && typeof obj.palette === "object" ? obj.palette : {}) as Record<string, unknown>
  const hex = (v: unknown) => (typeof v === "string" && /^#?[0-9a-fA-F]{6}$/.test(v.trim()) ? `#${v.trim().replace(/^#/, "").toLowerCase()}` : undefined)
  const list = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()).slice(0, max) : [])
  const avoid = list(obj.avoid, 9)
  // Always avoid the generic AI lifestyle scene.
  if (!avoid.some((a) => /beige|chai|mug|desk/i.test(a))) avoid.unshift(GENERIC_SCENE_AVOID)
  const candidate = {
    palette: {
      deep: hex(palette.deep),
      base: hex(palette.base),
      // The brand's own colour stays the accent, exactly.
      accent: colors[0] ?? hex(palette.accent),
      pop: hex(palette.pop),
    },
    mood: typeof obj.mood === "string" ? obj.mood.trim().split(/\s+/).slice(0, 5).join(" ") : undefined,
    motifs: list(obj.motifs, 6),
    cultural_context: typeof obj.cultural_context === "string" ? obj.cultural_context.trim() : undefined,
    photo_style: typeof obj.photo_style === "string" ? obj.photo_style.trim() : undefined,
    avoid,
    source_hash: sourceHash,
    palette_source: colors.length ? "brand_colors" : "invented",
    derived_at: new Date().toISOString(),
  }
  const parsed = artDirectionSchema.safeParse(candidate)
  if (!parsed.success) {
    console.error("[art-direction] derived art direction failed validation:", parsed.error.issues[0]?.message)
    return null
  }
  return parsed.data
}

/** One model call -> art direction (vision when there are photos or a logo). Null on any failure. */
export async function deriveArtDirection(brand: Brandish, products: Pick<ProductRow, "name" | "description" | "image_urls">[] = []): Promise<{ artDirection: ArtDirection | null; model: string }> {
  const colors = brandColors(brand)
  const prompt = buildPrompt(brand, colors, products)
  const images = [...products.map((p) => p.image_urls?.[0]).filter((u): u is string => !!u).slice(0, 2), ...(brand.logo_url ? [brand.logo_url] : [])]
  const sourceHash = artDirectionSourceHash(brand)
  try {
    let content: string
    let model: string
    if (images.length) {
      model = MODELS.vision
      const parts: ChatCompletionContentPart[] = [{ type: "text", text: prompt }, ...images.map((url) => ({ type: "image_url" as const, image_url: { url } }))]
      const res = await getOpenAIClient().chat.completions.create(
        { model, max_completion_tokens: 900, reasoning_effort: "low", response_format: { type: "json_object" }, messages: [{ role: "user", content: parts }] },
        { timeout: DERIVE_TIMEOUT_MS, maxRetries: 1 },
      )
      content = res.choices[0]?.message?.content ?? "{}"
    } else {
      // The larger creative model: the small scoring model fell back to stock
      // "Flat UI" palettes when it had to invent one.
      model = MODELS.creative
      const res = await getGroqClient().chat.completions.create(
        { model, reasoning_effort: "low", max_tokens: 1500, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] },
        { timeout: DERIVE_TIMEOUT_MS },
      )
      content = res.choices[0]?.message?.content ?? "{}"
    }
    return { artDirection: finalize(JSON.parse(content), colors, sourceHash), model }
  } catch (err) {
    console.error("[art-direction] derivation failed (non-fatal):", err instanceof Error ? err.message : err)
    return { artDirection: null, model: images.length ? MODELS.vision : MODELS.creative }
  }
}

/**
 * The brand's art direction, deriving and caching it when it's missing,
 * stale (its source_hash no longer matches the brand) or `refresh` is set.
 * Updates `brand.brand_brain` in memory so every prompt builder in this
 * request sees it. `persist: false` derives without saving (the harnesses).
 * Never throws; falls back to whatever was cached, else null.
 */
export async function ensureArtDirection(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  brand: Brandish,
  opts: { refresh?: boolean; persist?: boolean } = {},
): Promise<ArtDirection | null> {
  const cached = artDirectionFrom(brand)
  try {
    if (cached && !opts.refresh && cached.source_hash === artDirectionSourceHash(brand)) return cached

    const { data: products } = await db
      .from("products")
      .select("name, description, image_urls")
      .eq("brand_id", brand.id)
      .limit(3) as { data: Pick<ProductRow, "name" | "description" | "image_urls">[] | null }
    const withPhotoFirst = [...(products ?? [])].sort((a, b) => Number(!!b.image_urls?.[0]) - Number(!!a.image_urls?.[0]))
    const { artDirection, model } = await deriveArtDirection(brand, withPhotoFirst)
    if (!artDirection) return cached

    const rawBrain = brand.brand_brain && typeof brand.brand_brain === "object" ? (brand.brand_brain as Record<string, unknown>) : {}
    const nextBrain = { ...rawBrain, art_direction: artDirection }
    ;(brand as { brand_brain: unknown }).brand_brain = nextBrain
    console.log(`[art-direction] ${cached ? "re-derived" : "derived"} for brand ${brand.id} with ${model} (palette ${artDirection.palette_source})`)

    if (opts.persist !== false) {
      const { error } = await db.from("brands").update({ brand_brain: nextBrain }).eq("id", brand.id)
      if (error && !isMissingBrandBrainColumn(error)) console.error("[art-direction] couldn't save (non-fatal):", error.message)
    }
    return artDirection
  } catch (err) {
    console.error("[art-direction] ensure failed (non-fatal):", err instanceof Error ? err.message : err)
    return cached
  }
}
