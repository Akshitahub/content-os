// End-to-end renders for one brand and one topic, through the real
// pipeline: the Full Post caption call (quality gate included), the image
// pipeline in both looks (Real photo / Editorial graphic), the subject
// found once per image (lib/image/subject-boxes.ts), the designed post, the
// critic's score -- plus one carousel and one story on the same topic.
// Output under scripts/output/linen/<brand>/ with copy.json (copy, scores).
//
//   npx tsx scripts/render-linen.ts --brand <brandId> [--topic "..."]
//
// Reads the brand READ-ONLY; nothing is saved to the database.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import type { BrandRow } from "@/types/database"
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
const TOPIC = arg("--topic")[0] ?? "How to style pure linen so it doesn't look wrinkled by noon"
// --only post|carousel|story: re-render one part, keeping the others in copy.json.
const ONLY = arg("--only")[0] ?? null
const wants = (part: string) => !ONLY || ONLY === part
if (!brandId) {
  console.error('usage: npx tsx scripts/render-linen.ts --brand <brandId> [--topic "..."]')
  process.exit(1)
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)

async function main() {
  const { generatePostCopy } = await import("@/lib/ai/post-copy")
  const { generatePostImage } = await import("@/lib/ai/post-image-pipeline")
  const { generateCarouselWithRetry } = await import("@/lib/ai/carousel-generator")
  const { finishGeneratedCarousel } = await import("@/lib/ai/carousel-postprocess")
  const { generateCarouselSlideBackground } = await import("@/lib/ai/carousel-slide-background")
  const { requestStorySequence } = await import("@/lib/ai/story-sequence-generator")
  const { finalizeStoryFrames, storyFrameContext } = await import("@/lib/ai/story-frames")
  const { generateStorySlideBackground } = await import("@/lib/ai/story-slide-background")
  const { renderStorySlides } = await import("@/lib/image/story-compositor")
  const { renderPostDesign } = await import("@/lib/image/post-design")
  const { renderCarouselFrame } = await import("@/lib/image/carousel-frames")
  const { initialPostDesign } = await import("@/lib/design/post-design-fields")
  const { carouselFrameNeedsPhoto } = await import("@/lib/design/carousel-frames")
  const { detectSubjects } = await import("@/lib/image/subject-boxes")
  const { critiquePost } = await import("@/lib/ai/critic")
  const { resolveBrandPalette, resolveColorThemes, autoPickColorTheme } = await import("@/lib/design/color-themes")
  const { resolveTypography } = await import("@/lib/design/fonts")
  const { frameLogo } = await import("@/lib/design/logo-settings")
  const { getISTDateString } = await import("@/lib/utils/ist")
  const sharp = (await import("sharp")).default

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const { data: brand } = await db.from("brands").select("*").eq("id", brandId).single<BrandRow>()
  if (!brand) throw new Error(`brand ${brandId} not found`)
  const dir = join(process.cwd(), "scripts/output/linen", slug(brand.name))
  mkdirSync(dir, { recursive: true })
  const palette = resolveBrandPalette(brand)
  const typography = resolveTypography(brand)
  const logPath = join(dir, "copy.json")
  const log: Record<string, unknown> = ONLY && existsSync(logPath) ? JSON.parse(readFileSync(logPath, "utf-8")) : { brand: brand.name, topic: TOPIC }
  const dataUrl = (buf: Buffer, mime = "image/png") => `data:${mime};base64,${buf.toString("base64")}`

  // ── Full Post: the caption once, the image in both looks ─────────────
  if (wants("post")) {
  console.log("caption…")
  const { caption: c, hook } = await generatePostCopy(brand, { platform: "instagram", additionalContext: `${TOPIC} (a quick tip)`, postDate: getISTDateString() })
  const caption = c.data as GeneratedCaption
  log.post = { hook: hook.hooks[0]?.hook_text, post_big_words: caption.post_big_words, post_script_line: caption.post_script_line, template: caption.suggested_template, gate: c.gate?.counts, caption: caption.caption_text }
  const posts: Record<string, unknown>[] = []
  for (const [label, visualStyle] of [["real-photo", "studio_scene"], ["editorial-graphic", "editorial_graphic"]] as const) {
    console.log(`post image (${label})…`)
    const img = await generatePostImage({
      imagePrompt: caption.image_prompt ?? TOPIC, visualBrief: caption.visual ?? undefined, brandNiche: brand.niche, targetAudience: brand.target_audience,
      template: "bold_statement", colorTheme: autoPickColorTheme(resolveColorThemes(brand), caption.suggested_color_theme_id), logoUrl: null,
      plan: "pro", isInternalUnlimitedUser: true, aspectRatio: "4:5", visualStyle, userBrief: TOPIC, quality: "medium",
    })
    if (!img.success) { posts.push({ look: label, error: img.error }); continue }
    const url = dataUrl(img.buffer, img.mimeType)
    const boxes = await detectSubjects(url, img.buffer)
    const design = initialPostDesign(caption.suggested_template ?? "bold_statement", { ...caption, fallbackWords: [caption.suggested_overlay_text, hook.hooks[0]?.hook_text] }, 7)
    const jpg = await renderPostDesign(brand, url, design ?? { template: "bold_statement", big_words: hook.hooks[0]?.hook_text ?? TOPIC, script_line: "", seed: 7 }, "4:5", boxes)
    writeFileSync(join(dir, `post-${label}.jpg`), jpg)
    const score = await critiquePost(brand, { imageUrl: dataUrl(jpg, "image/jpeg"), caption: caption.caption_text, hook: hook.hooks[0]?.hook_text ?? "", format: "post" }, `linen ${label}`)
    posts.push({ look: label, design, subjects: boxes.length, critic: score ? { overall: score.overall, top_fix: score.top_fix } : null })
    console.log(`  ${label}: score ${score?.overall ?? "n/a"}`)
  }
  log.posts = posts
  }

  // ── Carousel: 5 slides, photo-led slides on generated scenes ─────────
  if (wants("carousel")) try {
    console.log("carousel…")
    const gen = await generateCarouselWithRetry(brand, TOPIC, 5, "instagram", undefined, [])
    const finished = finishGeneratedCarousel(gen.data as Record<string, unknown>, brand, { realHandle: brand.instagram_handle ? `@${brand.instagram_handle}` : undefined })
    const slides = finished.slides.slice(0, 5)
    const slideLog: Record<string, unknown>[] = []
    const thumbs: Buffer[] = []
    for (const [i, s] of slides.entries()) {
      let url: string | null = null, boxes = null
      if (carouselFrameNeedsPhoto(s.frame)) {
        const role = i === 0 ? "hook" : i === slides.length - 1 ? "cta" : "body"
        const bg = await generateCarouselSlideBackground({ brand, plan: "pro", isInternalUnlimitedUser: true, role, visualBrief: s.visual as never, quality: "low" })
        if (bg.success) { url = dataUrl(bg.buffer, bg.mimeType); boxes = await detectSubjects(url, bg.buffer) }
      }
      const jpg = await renderCarouselFrame({ frame: s.frame as never, headline: String(s.headline ?? ""), subtext: (s.subtext as string | null) ?? null, cta: (s.cta as string | null) ?? null, image_url: url, seed: s.seed as number, brand_mark: s.brand_mark as boolean, font_id: s.font_id as string, subject_boxes: boxes },
        { name: brand.name, ...frameLogo(brand), palette, fontId: typography.heading })
      writeFileSync(join(dir, `carousel-${i + 1}-${s.frame}.jpg`), jpg)
      thumbs.push(await sharp(jpg).resize(432, 540).jpeg({ quality: 85 }).toBuffer())
      slideLog.push({ slide: i + 1, frame: s.frame, headline: s.headline, line: s.subtext, background: url ? "generated" : "brand colour" })
    }
    await sharp({ create: { width: thumbs.length * 442 - 10, height: 540, channels: 3, background: "#ffffff" } }).composite(thumbs.map((b, i) => ({ input: b, left: i * 442, top: 0 }))).jpeg({ quality: 85 }).toFile(join(dir, "carousel-sheet.jpg"))
    const cover = readFileSync(join(dir, `carousel-1-${slides[0]!.frame}.jpg`))
    const score = await critiquePost(brand, { imageUrl: dataUrl(cover, "image/jpeg"), caption: String(finished.coverHook ?? ""), hook: String(slides[0]!.headline ?? ""), format: "carousel" }, "linen carousel")
    log.carousel = { slides: slideLog, gate: gen.gate?.counts, critic: score ? { overall: score.overall, top_fix: score.top_fix } : null }
  } catch (err) {
    log.carousel = { error: err instanceof Error ? err.message : String(err) }
    console.error("carousel failed:", err instanceof Error ? err.message : err)
  }

  // ── Story: 3 frames ──────────────────────────────────────────────────
  if (wants("story")) try {
    console.log("story…")
    const { raw } = await requestStorySequence(brand, TOPIC, 3, undefined, [], [], undefined, null)
    const stories = finalizeStoryFrames(((JSON.parse(raw) as { stories?: Record<string, unknown>[] }).stories ?? []).slice(0, 3), storyFrameContext(brand, null, TOPIC))
    const slides: Record<string, unknown>[] = []
    for (const [i, s] of stories.entries()) {
      const role = i === 0 ? "hook" : i === stories.length - 1 ? "cta" : "body"
      const bg = await generateStorySlideBackground({ brand, plan: "pro", isInternalUnlimitedUser: true, role, quality: "low", visualBrief: s.visual as never })
      const url = bg.success ? dataUrl(bg.buffer) : null
      const boxes = bg.success ? await detectSubjects(url!, bg.buffer) : null
      slides.push({ ...s, background_image_url: url, subject_boxes: boxes, palette, font_id: typography.heading, brand_name: brand.name, ...frameLogo(brand) })
    }
    const rendered = await renderStorySlides(slides as never)
    rendered.forEach((r, i) => writeFileSync(join(dir, `story-${i + 1}-${String(slides[i]!.frame)}.jpg`), r.png))
    log.story = { frames: stories.map((s) => ({ frame: s.frame, big_words: s.big_words, script_line: s.script_line, cta_label: s.cta_label })) }
  } catch (err) {
    log.story = { error: err instanceof Error ? err.message : String(err) }
    console.error("story failed:", err instanceof Error ? err.message : err)
  }

  writeFileSync(logPath, JSON.stringify(log, null, 2))
  console.log(`\nWritten to ${dir}`)
}

main().catch((err) => {
  console.error("[render-linen] failed:", err)
  process.exit(1)
})
