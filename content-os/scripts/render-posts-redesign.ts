// Renders designed feed posts (lib/image/post-design.ts) and a framed
// carousel (lib/design/carousel-frames.ts) end to end: the real Full Post
// caption call and the real carousel generator for the copy, the brand's own
// photos first, the real compositor. Per brand: one post per rebuilt
// template (bold_statement, product_focus, quote_card) and one 5-slide
// carousel. Output under scripts/output/posts-redesign/<brand>/.
//
//   npx tsx scripts/render-posts-redesign.ts --brand <brandId> [--product <productId>] [--topic "new launch"]
//   npx tsx scripts/render-posts-redesign.ts --sample [--photos <dir>]
//   ... --from-copy   (re-render each brand's saved copy.json, no model call --
//                      also how hand-written copy is rendered when the text
//                      model is out of tokens; copy_source says which)
//
// --brand reads a real brand READ-ONLY: nothing is saved or marked used.
// Photos: the brand's photo library first; with none, the picked product's
// own photos (labelled "product photo" in copy.json). Nothing is generated
// here -- a slide or post without a photo renders on the brand palette.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import type { BrandRow, ProductRow } from "@/types/database"
import type { SubjectBox } from "@/lib/image/subject-boxes"

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
const brandIds = arg("--brand")
const productId = arg("--product")[0] ?? null
const SAMPLE = process.argv.includes("--sample")
const FROM_COPY = process.argv.includes("--from-copy")
const photosDir = arg("--photos")[0]
const TOPIC = arg("--topic")[0] ?? "new launch"
// --no-scenes: skip the candid-scene generation for catalogue photos (cutouts only).
const SCENES = !process.argv.includes("--no-scenes")
if (!brandIds.length && !SAMPLE) {
  console.error("usage: npx tsx scripts/render-posts-redesign.ts --brand <brandId> [--product <id>] [--topic t]\n       npx tsx scripts/render-posts-redesign.ts --sample [--photos <dir>]")
  process.exit(1)
}
const OUT = join(process.cwd(), "scripts/output/posts-redesign")
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)
const POST_TEMPLATES = ["bold_statement", "product_focus", "quote_card"] as const

interface Photo { url: string; source: string }
interface BrandCase { brand: BrandRow; product: ProductRow | null; photos: Photo[] }
interface SavedCopy {
  /** Who wrote it: "model" (the real calls) or a note on hand-written copy. */
  copy_source?: string
  post: { big_words: string; script_line: string; caption: string }
  carousel: Record<string, unknown>[]
}

function sampleCase(): BrandCase {
  const photos = photosDir && existsSync(photosDir)
    ? readdirSync(photosDir).filter((f) => /\.(jpe?g|png)$/i.test(f)).map((f) => ({ url: `data:image/jpeg;base64,${readFileSync(join(photosDir, f)).toString("base64")}`, source: `sample photo ${f}` }))
    : []
  return {
    brand: { id: "sample-wick", user_id: "sample", name: "Wick & Ember", niche: "handmade scented candles", description: "Small-batch soy candles hand-poured in Pune, scented with Indian florals like mogra and champa.", tone_of_voice: "warm, playful", target_audience: "young urban Indian women, 22-35", instagram_handle: "wickandember", primary_color: "#b4532a", color_palette: ["#f3e6d3"], cta_phrase: "Shop now", brand_brain: null, vibe: null, logo_url: null, website_url: null } as unknown as BrandRow,
    product: { id: "sample-glow", brand_id: "sample-wick", name: "Mogra Glow", description: "Hand-poured soy wax candle with mogra essential oil and a cotton wick, 40 hour burn time.", price: 899, key_benefits: ["40 hour burn", "soy wax", "cotton wick"], image_urls: [] } as unknown as ProductRow,
    photos,
  }
}

async function withRateLimitRetry<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call()
    } catch (err) {
      const status = (err as { status?: number }).status
      if (status !== 429 || attempt >= 5) throw err
      console.log(`  rate limited -- waiting 30s (attempt ${attempt})`)
      await new Promise((r) => setTimeout(r, 30_000))
    }
  }
}

async function main() {
  const { generatePostCopy } = await import("@/lib/ai/post-copy")
  const { generateCarouselWithRetry } = await import("@/lib/ai/carousel-generator")
  const { finishGeneratedCarousel } = await import("@/lib/ai/carousel-postprocess")
  const { renderPostDesign } = await import("@/lib/image/post-design")
  const { isCatalogueShot, isLifestyleTemplate, candidSceneDirection } = await import("@/lib/ai/catalogue-photos")
  const { generatePostImage } = await import("@/lib/ai/post-image-pipeline")
  const { detectSubjects } = await import("@/lib/image/subject-boxes")
  const { resolveColorThemes } = await import("@/lib/design/color-themes")
  const { renderCarouselFrame } = await import("@/lib/image/carousel-frames")
  const { carouselFrameNeedsPhoto, finalizeCarouselFrames } = await import("@/lib/design/carousel-frames")
  const { initialPostDesign } = await import("@/lib/design/post-design-fields")
  const { pickBrandPhotos, PHOTO_KINDS_FOR } = await import("@/lib/brand-photos")
  const { resolveBrandPalette } = await import("@/lib/design/color-themes")
  const { resolveTypography } = await import("@/lib/design/fonts")
  const sharp = (await import("sharp")).default

  const cases: BrandCase[] = []
  if (SAMPLE) cases.push(sampleCase())
  else {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
    for (const id of brandIds) {
      const { data: brand } = await db.from("brands").select("*").eq("id", id).single<BrandRow>()
      if (!brand) throw new Error(`brand ${id} not found`)
      const { data: product } = productId ? await db.from("products").select("*").eq("id", productId).eq("brand_id", id).maybeSingle<ProductRow>() : { data: null }
      // Read-only: picked, never marked used.
      const library = await pickBrandPhotos(db, brand, { productId: product?.id ?? null, kinds: PHOTO_KINDS_FOR.post, count: 10 })
      const photos: Photo[] = library.length > 0
        ? library.map((p) => ({ url: p.url, source: "brand photo" }))
        : (product?.image_urls ?? []).map((url) => ({ url, source: "product photo" }))
      cases.push({ brand, product, photos })
    }
  }

  for (const { brand, product, photos } of cases) {
    const dir = join(OUT, slug(brand.name))
    mkdirSync(dir, { recursive: true })
    console.log(`\n=== ${brand.name}: ${photos.length} photo(s)${product ? `, product "${product.name}"` : ""} ===`)
    const palette = resolveBrandPalette(brand)
    const typography = resolveTypography(brand)
    /**
     * A catalogue photo where a scene is wanted (lifestyle posts, photo-led
     * slides): the real candid scene with the photo as the product reference
     * (lib/ai/catalogue-photos.ts); if that can't be made, the photo itself --
     * drawn as a cutout. Returns the background and what it is.
     */
    const sceneOr = async (photo: Photo | null, seed: number): Promise<{ url: string | null; source: string; boxes?: SubjectBox[] }> => {
      if (!photo) return { url: null, source: "palette" }
      if (!SCENES || !(await isCatalogueShot(photo.url))) return { url: photo.url, source: photo.source }
      const scene = await generatePostImage({
        imagePrompt: candidSceneDirection(seed), productImageUrl: photo.url, brandNiche: brand.niche, targetAudience: brand.target_audience,
        template: "bold_statement", colorTheme: resolveColorThemes(brand)[0]!, logoUrl: null, plan: "pro", isInternalUnlimitedUser: true, quality: "low", aspectRatio: "4:5",
      }).catch((err: unknown) => ({ success: false as const, error: err instanceof Error ? err.message : String(err), attempts: [] }))
      if (scene.success) {
        // Like production: the subject found once, right after generation.
        const url = `data:${scene.mimeType};base64,${scene.buffer.toString("base64")}`
        return { url, source: `candid scene from the ${photo.source}`, boxes: await detectSubjects(url, scene.buffer) }
      }
      return { url: photo.url, source: `${photo.source} as a cutout (scene failed: ${scene.error.slice(0, 90)})` }
    }

    let copy: SavedCopy
    if (FROM_COPY) {
      // Saved (or hand-written) copy goes through the frame rules again.
      copy = JSON.parse(readFileSync(join(dir, "copy.json"), "utf-8")) as SavedCopy
      copy.carousel = finalizeCarouselFrames(copy.carousel, { ctaPhrase: (brand as BrandRow & { cta_phrase?: string | null }).cta_phrase, seedBase: 7 })
    } else {
      const topic = product ? `${TOPIC}: ${product.name}` : TOPIC
      const { caption, hook } = await withRateLimitRetry(() => generatePostCopy(brand, { product, platform: "instagram", additionalContext: topic }))
      const c = caption.data as { post_big_words?: string; post_script_line?: string; suggested_overlay_text?: string; caption_text: string }
      const design = initialPostDesign("bold_statement", { post_big_words: c.post_big_words, post_script_line: c.post_script_line, fallbackWords: [c.suggested_overlay_text, hook.hooks[0]?.hook_text] }, 1)
      const gen = await withRateLimitRetry(() => generateCarouselWithRetry(brand, topic, 5, "instagram", undefined, []))
      const finished = finishGeneratedCarousel(gen.data as Record<string, unknown>, brand, { realHandle: brand.instagram_handle ? `@${brand.instagram_handle}` : undefined })
      copy = {
        copy_source: "model",
        post: { big_words: design?.big_words ?? "", script_line: design?.script_line ?? "", caption: c.caption_text },
        carousel: finished.slides.slice(0, 5).map((s) => ({ frame: s.frame, headline: s.headline, subtext: s.subtext, cta: s.cta, seed: s.seed, tape: s.tape, brand_mark: s.brand_mark, font_id: s.font_id })),
      }
    }

    // Posts: one per rebuilt template, each on its own photo.
    const thumbs: Buffer[] = []
    const postLog: Record<string, unknown>[] = []
    for (const [i, template] of POST_TEMPLATES.entries()) {
      const pick = photos[i % Math.max(1, photos.length)] ?? null
      // A product post shows the product (a cutout); the others want a scene.
      const photo: { url: string | null; source: string; boxes?: SubjectBox[] } = isLifestyleTemplate(template) ? await sceneOr(pick, i) : { url: pick?.url ?? null, source: pick ? `${pick.source}${await isCatalogueShot(pick.url) ? " as a cutout" : ""}` : "palette" }
      const jpg = await renderPostDesign(brand, photo.url, { template, big_words: copy.post.big_words, script_line: copy.post.script_line, seed: 11 + i * 101 }, "4:5", photo.boxes)
      writeFileSync(join(dir, `post-${template}.jpg`), jpg)
      thumbs.push(await sharp(jpg).resize(432, 540).jpeg({ quality: 85 }).toBuffer())
      postLog.push({ template, background: photo.source })
    }

    // Carousel: photo-led slides take the next unused photo -- no repeats.
    let next = 0
    const slideLog: Record<string, unknown>[] = []
    const slideThumbs: Buffer[] = []
    for (const [i, s] of copy.carousel.entries()) {
      // One source photo per slide, never repeated in the carousel.
      const photo = carouselFrameNeedsPhoto(s.frame) && next < photos.length ? await sceneOr(photos[next++]!, i) : null
      const jpg = await renderCarouselFrame({
        frame: s.frame as never, headline: String(s.headline ?? ""), subtext: (s.subtext as string | null) ?? null, cta: (s.cta as string | null) ?? null,
        image_url: photo?.url ?? null, subject_boxes: photo?.boxes ?? null, seed: s.seed as number, tape: s.tape as boolean, brand_mark: s.brand_mark as boolean, font_id: s.font_id as string,
      }, { name: brand.name, logo_url: brand.logo_url, palette, fontId: typography.heading })
      writeFileSync(join(dir, `carousel-${i + 1}-${s.frame}.jpg`), jpg)
      slideThumbs.push(await sharp(jpg).resize(432, 540).jpeg({ quality: 85 }).toBuffer())
      slideLog.push({ slide: i + 1, frame: s.frame, big_words: s.headline, line: s.subtext, cta: s.cta, background: photo?.source ?? (s.frame === "slide_type" ? "brand colour (type-led)" : "palette") })
    }

    const sheet = async (imgs: Buffer[], file: string) => sharp({ create: { width: imgs.length * 442 - 10, height: 540, channels: 3, background: "#ffffff" } })
      .composite(imgs.map((b, i) => ({ input: b, left: i * 442, top: 0 }))).jpeg({ quality: 85 }).toFile(join(dir, file))
    await sheet(thumbs, "posts-sheet.jpg")
    await sheet(slideThumbs, "carousel-sheet.jpg")
    writeFileSync(join(dir, "copy.json"), JSON.stringify({ ...copy, renders: { posts: postLog, carousel: slideLog } }, null, 2))
    console.log(`  posts: ${postLog.map((p) => `${p.template}[${p.background}]`).join(", ")}`)
    console.log(`  carousel: ${slideLog.map((s) => `${s.frame}[${String(s.background).split(" ")[0]}]`).join(" -> ")}`)
  }
  console.log(`\nWritten to ${OUT}`)
}

main().catch((err) => {
  console.error("[render-posts-redesign] failed:", err)
  process.exit(1)
})
