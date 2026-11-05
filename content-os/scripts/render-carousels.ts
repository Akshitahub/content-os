// Carousels end to end for one brand: the real generator (payoff plan +
// gate), each photo-led slide's photo generated for that slide's point and
// checked against its words (lib/ai/slide-photo-check.ts), the product's
// real photo as the reference when the topic is about it, and the whole
// carousel in one design system (lib/image/carousel-frames.ts
// renderCarouselFrames). Output under scripts/output/carousels/<topic>/.
//
//   npx tsx scripts/render-carousels.ts --brand <brandId> [--product <id>] --topic "how to style olive chinos" [--topic "..."]
//
// Reads the brand READ-ONLY; nothing is saved to the database.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import type { BrandRow, ProductRow } from "@/types/database"

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
const topics = arg("--topic")
if (!brandId || topics.length === 0) {
  console.error('usage: npx tsx scripts/render-carousels.ts --brand <brandId> [--product <id>] --topic "..." [--topic "..."]')
  process.exit(1)
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48)
const words = (s: string): string[] => s.toLowerCase().match(/[a-z]+/g) ?? []

async function main() {
  const { generateCarouselWithRetry } = await import("@/lib/ai/carousel-generator")
  const { finishGeneratedCarousel } = await import("@/lib/ai/carousel-postprocess")
  const { generateCheckedSlide, photoMissesPoint } = await import("@/lib/ai/slide-photo-check")
  const { renderCarouselFrames } = await import("@/lib/image/carousel-frames")
  const { carouselFrameNeedsPhoto } = await import("@/lib/design/carousel-frames")
  const { candidSceneDirection, isCatalogueShot } = await import("@/lib/ai/catalogue-photos")
  const { detectSubjects } = await import("@/lib/image/subject-boxes")
  const { critiquePost } = await import("@/lib/ai/critic")
  const { resolveBrandPalette } = await import("@/lib/design/color-themes")
  const { resolveTypography } = await import("@/lib/design/fonts")
  const { frameLogo } = await import("@/lib/design/logo-settings")
  const sharp = (await import("sharp")).default

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const { data: brand } = await db.from("brands").select("*").eq("id", brandId).single<BrandRow>()
  if (!brand) throw new Error(`brand ${brandId} not found`)
  const { data: product } = productId ? await db.from("products").select("*").eq("id", productId).eq("brand_id", brandId).maybeSingle<ProductRow>() : { data: null }
  const palette = resolveBrandPalette(brand)
  const typography = resolveTypography(brand)

  for (const topic of topics) {
    const dir = join(process.cwd(), "scripts/output/carousels", slug(topic))
    mkdirSync(dir, { recursive: true })
    console.log(`\n=== ${topic} ===`)
    // The product is the reference only when the topic is about it.
    const aboutProduct = !!product && words(product.name).some((w) => w.length > 3 && words(topic).includes(w))
    const productPhoto = aboutProduct ? (product!.image_urls ?? []).find(Boolean) ?? null : null
    const gen = await generateCarouselWithRetry(brand, topic, 5, "instagram", undefined, [])
    const data = gen.data as Record<string, unknown>
    const finished = finishGeneratedCarousel(data, brand, { realHandle: brand.instagram_handle ? `@${brand.instagram_handle}` : undefined })
    const slides = finished.slides
    const slideLog: Record<string, unknown>[] = []
    const frames: Parameters<typeof renderCarouselFrames>[0] = []
    for (const [i, s] of slides.entries()) {
      let url: string | null = null
      let boxes = null
      let agree: number | undefined
      if (carouselFrameNeedsPhoto(s.frame)) {
        const role = i === 0 ? "hook" : i === slides.length - 1 ? "cta" : "body"
        const ref = productPhoto && await isCatalogueShot(productPhoto) ? productPhoto : null
        const bg = await generateCheckedSlide({
          brand, plan: "pro", isInternalUnlimitedUser: true, role, quality: "low",
          visualBrief: ref ? undefined : s.visual as never,
          productImageUrl: ref,
          customPrompt: ref ? `${candidSceneDirection(i)}. This slide's point: ${s.headline} -- ${s.subtext ?? ""}` : undefined,
        }, { headline: String(s.headline ?? ""), body: (s.subtext as string | null) ?? null, productName: aboutProduct ? product!.name : null }, `carousel ${slug(topic)} slide ${i + 1}`)
        if (bg.success && photoMissesPoint(bg.agree, i, slides.length)) {
          // Doesn't show the point even after the retry: type-led over a
          // detail of the product photo, as in production.
          s.frame = "slide_type"
          s.layout_hint = "type"
          s.detail_image_url = productPhoto
          agree = bg.agree
        } else if (bg.success) {
          url = `data:${bg.mimeType};base64,${bg.buffer.toString("base64")}`
          boxes = await detectSubjects(url, bg.buffer)
          agree = bg.agree
        }
      }
      frames.push({ frame: s.frame as never, headline: String(s.headline ?? ""), subtext: (s.subtext as string | null) ?? null, cta: (s.cta as string | null) ?? null, image_url: url, seed: s.seed as number, brand_mark: s.brand_mark as boolean, font_id: s.font_id as string, subject_boxes: boxes, layout_hint: s.layout_hint as never, list_index: (s.list_index as number | null) ?? null, detail_image_url: (s.detail_image_url as string | null) ?? null })
      slideLog.push({ slide: i + 1, frame: s.frame, layout_hint: s.layout_hint, list_index: s.list_index ?? null, big_words: s.headline, line: s.subtext, photo: url ? "generated for this slide" : s.detail_image_url ? "detail of the product photo" : "brand-colour band", photo_agrees: agree ?? null })
    }
    const rendered = await renderCarouselFrames(frames, { name: brand.name, ...frameLogo(brand), palette, fontId: typography.heading })
    const thumbs: Buffer[] = []
    for (const [i, r] of rendered.entries()) {
      writeFileSync(join(dir, `slide-${i + 1}-${r.layout}.jpg`), r.jpg)
      thumbs.push(await sharp(r.jpg).resize(432, 540).jpeg({ quality: 85 }).toBuffer())
      slideLog[i]!.layout = r.layout
    }
    await sharp({ create: { width: thumbs.length * 442 - 10, height: 540, channels: 3, background: "#ffffff" } }).composite(thumbs.map((b, i) => ({ input: b, left: i * 442, top: 0 }))).jpeg({ quality: 85 }).toFile(join(dir, "sheet.jpg"))
    const cover = await critiquePost(brand, { imageUrl: `data:image/jpeg;base64,${rendered[0]!.jpg.toString("base64")}`, caption: String(finished.coverHook ?? ""), hook: String(slides[0]!.headline ?? ""), format: "carousel" }, `carousel ${slug(topic)}`)
    const plan = data.narrative_plan as Record<string, unknown> | undefined
    writeFileSync(join(dir, "copy.json"), JSON.stringify({ brand: brand.name, topic, payoff_type: plan?.payoff_type ?? null, payoff: plan?.payoff ?? null, gate: gen.gate?.counts ?? null, cover_critic: cover ? { overall: cover.overall, top_fix: cover.top_fix } : null, slides: slideLog }, null, 2))
    console.log(`  payoff: ${plan?.payoff_type} -- ${plan?.payoff}`)
    console.log(`  ${slideLog.map((s) => `${s.layout}${s.photo_agrees != null ? `(agree ${s.photo_agrees})` : ""}`).join(" -> ")}; cover ${cover?.overall ?? "n/a"}`)
  }
}

main().catch((err) => {
  console.error("[render-carousels] failed:", err)
  process.exit(1)
})
