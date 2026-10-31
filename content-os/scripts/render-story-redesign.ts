// Renders story-frame sequences (lib/ai/story-frames.ts + lib/image/
// story-frame-compositor.ts) end to end: the real story copy call, the
// frame rules, the brand's own photos first, an AI photo for a frame
// without one, the real compositor. For each brand: "Bday sale" and
// "new launch", 3 and 5 frames. Output (frames + a contact sheet + the
// frames' copy) under scripts/output/story-redesign/<brand>/.
//
//   npx tsx scripts/render-story-redesign.ts --brand <brandId> [--brand <brandId>] [--product <productId>] [--no-ai]
//   npx tsx scripts/render-story-redesign.ts --sample [--photos <dir>] [--no-ai]
//   ... [--only <brand name part>] [--topic "Bday sale"] [--count 3]   (one set)
//   ... --from-copy   (re-render each set's saved copy.json, no model call)
//
// --brand reads real brands READ-ONLY: photos are picked, never marked used,
// and nothing is saved. --sample uses two built-in brands with no database
// (the first takes its "brand photos" from --photos). --no-ai skips image
// generation: a frame without a brand photo renders on the brand palette.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs"
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
const brandIds = arg("--brand")
const productId = arg("--product")[0] ?? null
const SAMPLE = process.argv.includes("--sample")
const NO_AI = process.argv.includes("--no-ai")
// --from-copy: re-render a set's saved copy.json (no text model call) -- the
// copy goes through the current frame rules and compositor again.
const FROM_COPY = process.argv.includes("--from-copy")
const photosDir = arg("--photos")[0]
if (!brandIds.length && !SAMPLE) {
  console.error("usage: npx tsx scripts/render-story-redesign.ts --brand <brandId> [--brand <brandId>] [--product <id>] [--no-ai]\n       npx tsx scripts/render-story-redesign.ts --sample [--photos <dir>] [--no-ai]")
  process.exit(1)
}

// --topic / --count render just one set (saves the text model's daily budget).
const TOPICS = arg("--topic").length ? arg("--topic") : ["Bday sale", "new launch"]
const COUNTS = arg("--count").length ? arg("--count").map(Number) : [3, 5]
const onlyBrand = arg("--only")[0]?.toLowerCase()
const OUT = join(process.cwd(), "scripts/output/story-redesign")
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)

interface BrandCase { brand: BrandRow; product: ProductRow | null; photos: { id: string; url: string }[] }

function sampleCases(): BrandCase[] {
  const photos = photosDir && existsSync(photosDir)
    ? readdirSync(photosDir).filter((f) => /\.(jpe?g|png)$/i.test(f)).map((f, i) => ({ id: `sample-${i}`, url: `data:image/jpeg;base64,${readFileSync(join(photosDir, f)).toString("base64")}` }))
    : []
  const base = { user_id: "sample", brand_brain: null, vibe: null, target_audience: "young urban Indian women, 22-35", logo_url: null, website_url: null } as Partial<BrandRow>
  return [
    {
      brand: { ...base, id: "sample-wick", name: "Wick & Ember", niche: "handmade scented candles", description: "Small-batch soy candles hand-poured in Pune, scented with Indian florals like mogra and champa.", tone_of_voice: "warm, playful", instagram_handle: "wickandember", primary_color: "#b4532a", color_palette: ["#f3e6d3"], cta_phrase: "Shop now" } as unknown as BrandRow,
      product: { id: "sample-glow", brand_id: "sample-wick", name: "Mogra Glow", description: "Hand-poured soy wax candle with mogra essential oil and a cotton wick, 40 hour burn time.", price: 899, key_benefits: ["40 hour burn", "soy wax", "cotton wick"], image_urls: [] } as unknown as ProductRow,
      photos,
    },
    {
      brand: { ...base, id: "sample-kaapi", name: "Kaapi Theory", niche: "specialty filter coffee", description: "South Indian filter coffee blends roasted in small batches in Chikmagalur.", tone_of_voice: "confident, witty", instagram_handle: "kaapitheory", primary_color: "#1f4d3a", color_palette: ["#e9dcc6"], cta_phrase: "Order now" } as unknown as BrandRow,
      product: null,
      photos: [],
    },
  ]
}

// The text model's per-minute token limit can be smaller than one story
// request needs twice in a row: wait it out instead of failing the run.
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
  const { requestStorySequence } = await import("@/lib/ai/story-sequence-generator")
  const { finalizeStoryFrames, storyFrameContext } = await import("@/lib/ai/story-frames")
  const { renderStorySlides } = await import("@/lib/image/story-compositor")
  const { generateStorySlideBackground } = await import("@/lib/ai/story-slide-background")
  const { isCatalogueShot, candidSceneDirection } = await import("@/lib/ai/catalogue-photos")
  const { detectSubjects } = await import("@/lib/image/subject-boxes")
  const { pickBrandPhotos, PHOTO_KINDS_FOR } = await import("@/lib/brand-photos")
  const { resolveBrandPalette } = await import("@/lib/design/color-themes")
  const { resolveTypography } = await import("@/lib/design/fonts")
  const sharp = (await import("sharp")).default

  let cases: BrandCase[]
  if (SAMPLE) cases = sampleCases()
  else {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
    cases = []
    for (const id of brandIds) {
      const { data: brand } = await db.from("brands").select("*").eq("id", id).single<BrandRow>()
      if (!brand) throw new Error(`brand ${id} not found`)
      const { data: product } = productId ? await db.from("products").select("*").eq("id", productId).eq("brand_id", id).maybeSingle<ProductRow>() : { data: null }
      // Read-only: picked, never marked used.
      const library = await pickBrandPhotos(db, brand, { productId: product?.id ?? null, kinds: PHOTO_KINDS_FOR.story, count: 10 })
      // No photo library: the product's own photos (catalogue shots are drawn as cutouts).
      const photos = library.length ? library : (product?.image_urls ?? []).map((url, i) => ({ id: `product-${i}`, url }))
      cases.push({ brand, product, photos })
    }
  }

  for (const { brand, product, photos } of cases.filter((c) => !onlyBrand || c.brand.name.toLowerCase().includes(onlyBrand))) {
    console.log(`\n=== ${brand.name}: ${photos.length} brand photo(s)${product ? `, product "${product.name}"` : ""} ===`)
    const palette = resolveBrandPalette(brand)
    const fontId = resolveTypography(brand).heading
    for (const topic of TOPICS) {
      for (const count of COUNTS) {
        const dir = join(OUT, slug(brand.name), `${slug(topic)}-${count}`)
        mkdirSync(dir, { recursive: true })
        const started = Date.now()
        let stories: Record<string, unknown>[]
        if (FROM_COPY) {
          const saved = JSON.parse(readFileSync(join(dir, "copy.json"), "utf-8")) as { frames: Record<string, unknown>[] }
          const asStories = saved.frames.map((f) => ({ frame: f.kind, big_words: f.big_words, script_line: f.script_line, badge: f.badge, callouts: f.callouts, quote: f.quote, cta_label: f.cta_label, ...(typeof f.seed === "number" ? { seed: f.seed } : {}) }))
          stories = finalizeStoryFrames(asStories, storyFrameContext(brand, product, topic))
        } else {
          const { raw } = await withRateLimitRetry(() => requestStorySequence(brand, topic, count, undefined, [], [], undefined, product))
          const data = JSON.parse(raw) as { stories?: Record<string, unknown>[] }
          stories = (data.stories ?? []).slice(0, count)
        }
        // Brand photos first, one per frame, never repeated in the sequence.
        const slides = await Promise.all(stories.map(async (s, i) => {
          const photo = photos[i] ?? null
          let url: string | null = photo?.url ?? null
          let source = photo ? "brand photo" : "palette"
          let boxes: unknown = null
          const role = i === 0 ? "hook" : i === stories.length - 1 ? "cta" : "body"
          // A catalogue photo: a candid scene with it as the product
          // reference (lib/ai/catalogue-photos.ts), its subject found once;
          // if the scene fails, the photo itself (drawn as a cutout).
          if (url && !NO_AI && await isCatalogueShot(url)) {
            const bg = await generateStorySlideBackground({ brand, plan: "starter", isInternalUnlimitedUser: true, role, quality: "low", productImageUrl: url, userDirection: candidSceneDirection(i) })
            if (bg.success) {
              url = `data:image/png;base64,${bg.buffer.toString("base64")}`
              boxes = await detectSubjects(url, bg.buffer)
              source = "candid scene from the product photo"
            } else source = `product photo as a cutout (scene failed: ${bg.error.slice(0, 90)})`
          } else if (url && await isCatalogueShot(url)) source = "product photo as a cutout"
          if (!url && !NO_AI) {
            const bg = await generateStorySlideBackground({ brand, plan: "starter", isInternalUnlimitedUser: true, role, quality: "low", visualBrief: s.visual as never })
            if (bg.success) {
              url = `data:image/png;base64,${bg.buffer.toString("base64")}`
              source = "AI photo"
            } else source = `palette (AI photo failed: ${bg.error.slice(0, 120)})`
          }
          return { slide: { ...s, background_image_url: url, ...(boxes ? { subject_boxes: boxes } : {}), palette, font_id: fontId, brand_name: brand.name, logo_url: brand.logo_url ?? null } as Record<string, unknown>, source }
        }))
        const rendered = await renderStorySlides(slides.map((x) => x.slide) as never)
        const thumbs: Buffer[] = []
        rendered.forEach((r, i) => {
          writeFileSync(join(dir, `frame-${i + 1}-${slides[i]!.slide.frame}.jpg`), r.png)
        })
        for (const r of rendered) thumbs.push(await sharp(r.png).resize(360, 640).jpeg({ quality: 85 }).toBuffer())
        await sharp({ create: { width: thumbs.length * 370 - 10, height: 640, channels: 3, background: "#ffffff" } })
          .composite(thumbs.map((b, i) => ({ input: b, left: i * 370, top: 0 }))).jpeg({ quality: 85 }).toFile(join(dir, "sheet.jpg"))
        const copy = slides.map((x, i) => {
          const s = x.slide as Record<string, unknown>
          return { frame: i + 1, kind: s.frame, big_words: s.big_words, script_line: s.script_line, badge: s.badge, callouts: s.callouts, quote: s.quote, cta_label: s.cta_label, seed: s.seed, background: x.source }
        })
        writeFileSync(join(dir, "copy.json"), JSON.stringify({ brand: brand.name, topic, frames: copy }, null, 2))
        console.log(`  ${topic} x${count} (${Date.now() - started}ms): ${copy.map((c) => `${c.kind}[${c.background.split(" (")[0]}]`).join(" -> ")}`)
      }
    }
  }
  console.log(`\nWritten to ${OUT}`)
}

main().catch((err) => {
  console.error("[render-story-redesign] failed:", err)
  process.exit(1)
})
