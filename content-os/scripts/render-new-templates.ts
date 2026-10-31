// Renders listicle_cover, festive_poster and review_card (lib/ai/post-
// template-rules.ts + lib/image/post-design.ts) for one brand, from fixture
// copy that goes through the same server-side checks a generated caption
// does -- the count, the occasion and the review are checked, never typed
// onto the image directly. Output under scripts/output/new-templates/<brand>/.
//
//   npx tsx scripts/render-new-templates.ts --brand <brandId> [--product <productId>]
//
// Reads the brand READ-ONLY. Photos: its photo library, else the product's
// own photos. The review card renders a labelled placeholder -- there is no
// real review to quote, and one is never invented.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import type { BrandRow, ProductRow } from "@/types/database"
import type { GeneratedCaption } from "@/types/app"

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

const arg = (name: string) => process.argv.flatMap((a, i) => (a === name ? [process.argv[i + 1]!] : [])).filter(Boolean)
const brandId = arg("--brand")[0]
const productId = arg("--product")[0] ?? null
if (!brandId) {
  console.error("usage: npx tsx scripts/render-new-templates.ts --brand <brandId> [--product <productId>]")
  process.exit(1)
}
const OUT = join(process.cwd(), "scripts/output/new-templates")
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)

/** Fixture copy per template: the topic it was written for and the caption fields a model would return. */
function fixtures(product: ProductRow | null): { topic: string; caption: Partial<GeneratedCaption> }[] {
  const name = product?.name ?? "our chinos"
  return [
    {
      topic: `how to style the ${name}`,
      caption: {
        suggested_template: "listicle_cover",
        caption_text: `Three easy ways to wear the ${name}:\n1. Tuck in a crisp white tee\n2. Roll the hem once\n3. Finish with white sneakers\nShop now`,
        listicle_title: "ways to wear them",
        listicle_items: ["Tuck in a crisp white tee", "Roll the hem once", "Finish with white sneakers"],
        post_script_line: "pick your favourite",
      },
    },
    {
      topic: `Diwali drop: the ${name}`,
      caption: { suggested_template: "festive_poster", festive_greeting: "Happy Diwali", festive_line: "light up the festive fits" },
    },
    {
      // A placeholder, labelled as one -- no real review exists for this render.
      topic: `"A real customer review goes here" -- placeholder`,
      caption: { suggested_template: "review_card", review_quote: "A real customer review goes here", review_author: null },
    },
  ]
}

async function main() {
  const { finishPostTemplates, postTemplateContext } = await import("@/lib/ai/post-template-rules")
  const { initialPostDesign } = await import("@/lib/design/post-design-fields")
  const { renderPostDesign } = await import("@/lib/image/post-design")
  const { pickBrandPhotos, PHOTO_KINDS_FOR } = await import("@/lib/brand-photos")
  const { isCatalogueShot, candidSceneDirection } = await import("@/lib/ai/catalogue-photos")
  const { generatePostImage } = await import("@/lib/ai/post-image-pipeline")
  const { resolveColorThemes } = await import("@/lib/design/color-themes")
  const { detectSubjects } = await import("@/lib/image/subject-boxes")
  const sharp = (await import("sharp")).default

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const { data: brand } = await db.from("brands").select("*").eq("id", brandId).single<BrandRow>()
  if (!brand) throw new Error(`brand ${brandId} not found`)
  const { data: product } = productId ? await db.from("products").select("*").eq("id", productId).eq("brand_id", brandId).maybeSingle<ProductRow>() : { data: null }
  // Read-only: picked, never marked used.
  const library = await pickBrandPhotos(db, brand, { productId: product?.id ?? null, kinds: PHOTO_KINDS_FOR.post, count: 6 })
  const photos = library.length ? library.map((p) => ({ url: p.url, source: "brand photo" })) : (product?.image_urls ?? []).map((url) => ({ url, source: "product photo" }))

  const dir = join(OUT, slug(brand.name))
  mkdirSync(dir, { recursive: true })
  const log: Record<string, unknown>[] = []
  const thumbs: Buffer[] = []
  for (const [i, f] of fixtures(product).entries()) {
    const ctx = await postTemplateContext(f.topic)
    const checked = finishPostTemplates({ caption_text: "", hashtags: [], cta: "", character_count: 0, ...f.caption } as GeneratedCaption, ctx)
    const design = initialPostDesign(checked.suggested_template, { ...checked, fallbackWords: [f.topic] }, 21 + i * 97)
    if (!design) throw new Error(`${f.caption.suggested_template}: no design`)
    const pick = photos[(i + 3) % Math.max(1, photos.length)] ?? null
    // All three are lifestyle posts: a catalogue photo becomes the product
    // reference for a candid scene (its subject found once); if that fails, a cutout.
    let photo: { url: string; source: string } | null = pick
    let boxes: Awaited<ReturnType<typeof detectSubjects>> | null = null
    if (pick && await isCatalogueShot(pick.url)) {
      const scene = await generatePostImage({
        imagePrompt: candidSceneDirection(i + 1), productImageUrl: pick.url, brandNiche: brand.niche, targetAudience: brand.target_audience,
        template: "bold_statement", colorTheme: resolveColorThemes(brand)[0]!, logoUrl: null, plan: "pro", isInternalUnlimitedUser: true, quality: "low", aspectRatio: "4:5",
      }).catch((err: unknown) => ({ success: false as const, error: err instanceof Error ? err.message : String(err), attempts: [] }))
      if (scene.success) {
        const url = `data:${scene.mimeType};base64,${scene.buffer.toString("base64")}`
        boxes = await detectSubjects(url, scene.buffer)
        photo = { url, source: `candid scene from the ${pick.source}` }
      } else photo = { url: pick.url, source: `${pick.source} as a cutout (scene failed: ${scene.error.slice(0, 90)})` }
    }
    const jpg = await renderPostDesign(brand, photo?.url ?? null, design, "4:5", boxes)
    writeFileSync(join(dir, `${design.template}.jpg`), jpg)
    thumbs.push(await sharp(jpg).resize(432, 540).jpeg({ quality: 85 }).toBuffer())
    log.push({ asked: f.caption.suggested_template, rendered: design.template, topic: f.topic, badge: design.badge ?? null, big_words: design.big_words, script_line: design.script_line, quote: design.quote ?? null, background: photo?.source ?? "palette" })
    console.log(`  ${f.caption.suggested_template} -> ${design.template}${design.badge ? ` [${design.badge}]` : ""}`)
  }
  await sharp({ create: { width: thumbs.length * 442 - 10, height: 540, channels: 3, background: "#ffffff" } })
    .composite(thumbs.map((b, i) => ({ input: b, left: i * 442, top: 0 }))).jpeg({ quality: 85 }).toFile(join(dir, "sheet.jpg"))
  writeFileSync(join(dir, "copy.json"), JSON.stringify({ brand: brand.name, note: "fixture copy checked by lib/ai/post-template-rules.ts; the review is a labelled placeholder", renders: log }, null, 2))
  console.log(`\nWritten to ${dir}`)
}

main().catch((err) => {
  console.error("[render-new-templates] failed:", err)
  process.exit(1)
})
