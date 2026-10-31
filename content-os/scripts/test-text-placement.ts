// Text never sits on the subject (lib/image/story-frame-compositor.ts +
// lib/image/subject-boxes.ts): every frame kind, on the story and the feed
// canvas, over synthetic photos -- a tall model on a studio background, a
// small product, a wide subject, a busy scene with given boxes, a scene left
// to the local detector. Fails if any visible glyph pixel of the text layer
// (text, the badge, the pill, the mark -- rendered without its soft glow)
// falls inside a subject box, or outside Instagram's safe area: the 3:4
// profile-grid crop of a 4:5 post (34px a side) and a story's top / bottom
// 250px under Instagram's own UI.
//   npx tsx scripts/test-text-placement.ts
import assert from "node:assert/strict"
import sharp from "sharp"

let passed = 0
async function test(name: string, fn: () => Promise<void>) {
  await fn()
  passed++
  console.log(`ok - ${name}`)
}

const W = 1200, H = 1600
/** A studio shot: flat background, dark rectangles as the subject (fractions). */
async function studio(rects: { x: number; y: number; w: number; h: number }[], bg = "#f2f2f0"): Promise<string> {
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="${bg}"/>${rects.map((r) => `<rect x="${r.x * W}" y="${r.y * H}" width="${r.w * W}" height="${r.h * H}" rx="40" fill="#4a5a3a"/>`).join("")}</svg>`
  return `data:image/png;base64,${(await sharp(Buffer.from(svg)).png().toBuffer()).toString("base64")}`
}
/** A busy scene: noise everywhere, a sharper block where the subject is. */
async function scene(subject?: { x: number; y: number; w: number; h: number }): Promise<string> {
  const data = Buffer.alloc(W * H * 3)
  let seed = 7
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3
      const inSub = subject && x >= subject.x * W && x < (subject.x + subject.w) * W && y >= subject.y * H && y < (subject.y + subject.h) * H
      const v = inSub ? ((x / 48 | 0) + (y / 48 | 0)) % 2 ? 230 : 20 : 110 + Math.round(rnd() * 30)
      data[i] = v; data[i + 1] = v; data[i + 2] = Math.min(255, v + 10)
    }
  }
  return `data:image/png;base64,${(await sharp(data, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer()).toString("base64")}`
}

async function main() {
  const { renderFrameLayers, rectsIntersect, fitHeadline, STORY_CANVAS, FEED_CANVAS } = await import("@/lib/image/story-frame-compositor")
  const { getFont } = await import("@/lib/image/post-compositor")
  const { resolveBrandPalette } = await import("@/lib/design/color-themes")
  const palette = resolveBrandPalette({ primary_color: "#1f4d3a", color_palette: ["#e9dcc6"], brand_brain: null, vibe: null } as never)

  /** Visible text-layer pixels inside any subject box. */
  async function overlap(overlay: Buffer, subjects: { x0: number; y0: number; x1: number; y1: number }[]): Promise<number> {
    const { data, info } = await sharp(overlay).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let hits = 0
    for (const r of subjects) {
      for (let y = Math.max(0, r.y0); y < Math.min(info.height, r.y1); y++) {
        for (let x = Math.max(0, r.x0); x < Math.min(info.width, r.x1); x++) if (data[(y * info.width + x) * 4 + 3]! > 60) hits++
      }
    }
    return hits
  }
  /** Visible text-layer pixels outside the safe rectangle. */
  async function outsideSafe(overlay: Buffer, safe: { x0: number; y0: number; x1: number; y1: number }): Promise<number> {
    const { data, info } = await sharp(overlay).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let hits = 0
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if ((x >= safe.x0 && x < safe.x1 && y >= safe.y0 && y < safe.y1)) continue
        if (data[(y * info.width + x) * 4 + 3]! > 60) hits++
      }
    }
    return hits
  }
  async function visible(overlay: Buffer): Promise<number> {
    const { data } = await sharp(overlay).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let n = 0
    for (let i = 3; i < data.length; i += 4) if (data[i]! > 60) n++
    return n
  }

  const frames = [
    { frame: "hook", big_words: "Just dropped", script_line: "the olive straight fit chinos", tape: true, brand_mark: true },
    { frame: "offer", big_words: "Bday sale", badge: "30% OFF", script_line: "this weekend only" },
    { frame: "product", big_words: "Olive chinos", callouts: ["straight fit", "soft cotton twill"] },
    { frame: "proof", quote: "best chinos I have ever owned honestly" },
    { frame: "cta", big_words: "Yours next", cta_label: "Shop the chinos", script_line: "new in the drop", brand_mark: true },
    { frame: "post_bold", big_words: "Happy Diwali", script_line: "from all of us" },
    { frame: "post_product", big_words: "Olive chinos", script_line: "new in" },
    { frame: "post_quote", big_words: "Style it", script_line: "three easy ways" },
    { frame: "post_minimal", big_words: "New launch", script_line: "olive straight fit" },
    { frame: "post_listicle", big_words: "ways to wear them", badge: "3", script_line: "pick one" },
    { frame: "post_festive", big_words: "Happy Diwali", badge: "Diwali", script_line: "light up the festive fits", tape: true },
    { frame: "post_review", quote: "best chinos I have ever owned", script_line: "Rahul" },
    { frame: "slide_photo", big_words: "Straight fit", body: "Not skinny, not baggy, just a clean line from hip to hem" },
  ] as const

  const photos = {
    "tall model, studio": await studio([{ x: 0.36, y: 0.06, w: 0.28, h: 0.92 }]),
    "small product, studio": await studio([{ x: 0.38, y: 0.62, w: 0.24, h: 0.26 }]),
    "wide subject, studio": await studio([{ x: 0.05, y: 0.42, w: 0.9, h: 0.22 }]),
    "busy scene, detected": await scene({ x: 0.3, y: 0.25, w: 0.4, h: 0.5 }),
  }
  // Studio shots are cut out onto the brand colour by default (catalogue
  // photography); "full" keeps them full-bleed to exercise the split / band layouts.
  const cutoutPhoto = { name: "tall model, studio, cut out", url: photos["tall model, studio"] }
  const given = { url: await scene(), boxes: [{ x: 0.5, y: 0.1, w: 0.18, h: 0.14, label: "face" as const }, { x: 0.42, y: 0.24, w: 0.34, h: 0.4, label: "torso" as const }, { x: 0.44, y: 0.62, w: 0.3, h: 0.16, label: "hips" as const }] }

  const layouts = new Set<string>()
  for (const [cvName, cv] of [["story", STORY_CANVAS], ["feed", FEED_CANVAS]] as const) {
    for (const [photoName, url] of [...Object.entries(photos), ["busy scene, given face/torso/hips boxes", given.url] as const, [cutoutPhoto.name, cutoutPhoto.url] as const]) {
      await test(`${cvName}: ${photoName} -- no text on the subject in any frame`, async () => {
        for (const [i, f] of frames.entries()) {
          const treatment = photoName === cutoutPhoto.name ? {} : { photo_treatment: "full" }
          const layers = await renderFrameLayers({ ...f, seed: 11 + i * 31, palette, brand_name: "SNITCH", background_image_url: url, ...treatment, ...(url === given.url ? { subject_boxes: given.boxes } : {}) } as never, cv, { plain: true })
          layouts.add(layers.layout)
          assert.ok(layers.subjects.length > 0, `${f.frame}: no subject found`)
          assert.ok(!layers.subjects.some((s) => rectsIntersect(s, layers.region)), `${f.frame}: the text region overlaps the subject`)
          assert.ok(await visible(layers.overlay) > 500, `${f.frame}: nothing drawn`)
          const hits = await overlap(layers.overlay, layers.subjects)
          assert.equal(hits, 0, `${f.frame} (${layers.layout}): ${hits} text pixels on the subject`)
          const safe = cvName === "story" ? { x0: 34, y0: 250, x1: cv.w - 34, y1: cv.h - 250 } : { x0: 34, y0: 24, x1: cv.w - 34, y1: cv.h - 24 }
          const out = await outsideSafe(layers.overlay, safe)
          assert.equal(out, 0, `${f.frame} (${layers.layout}): ${out} text pixels outside the safe area`)
        }
      })
    }
  }

  await test("a tall subject with no room beside it gets the split layout, a wide one the band", async () => {
    assert.ok(layouts.has("split"), [...layouts].join(","))
    assert.ok(layouts.has("band") || layouts.has("free"), [...layouts].join(","))
    assert.ok(layouts.has("cutout"), [...layouts].join(","))
  })

  await test("headline: at most 3 lines, balanced, sized to fill", async () => {
    const font = await getFont("anton")
    const fit = fitHeadline(font, "anton", "Linen that stays crisp till 6pm", 900, 600)
    assert.ok(fit.lines.length >= 1 && fit.lines.length <= 3, fit.lines.join(" / "))
    const widths = fit.lines.map((l) => font.layout(l).advanceWidth)
    if (fit.lines.length > 1) assert.ok(Math.min(...widths) / Math.max(...widths) > 0.45, `unbalanced: ${fit.lines.join(" / ")}`)
    const long = fitHeadline(font, "anton", "one two three four five six seven eight nine", 900, 600)
    assert.ok(long.lines.length <= 3)
    assert.ok(fitHeadline(font, "anton", "Bday sale", 900, 600).size > fitHeadline(font, "anton", "Bday sale", 450, 600).size)
  })

  await test("text aligns to its region: left region left, right region right", async () => {
    const left = await renderFrameLayers({ frame: "post_bold", big_words: "Crisp till 6pm", seed: 4, palette, background_image_url: photos["tall model, studio"], photo_treatment: "full", subject_boxes: [{ x: 0.58, y: 0.05, w: 0.38, h: 0.9, label: "person" }] } as never, FEED_CANVAS)
    assert.equal(left.region.x0, 0)
    const right = await renderFrameLayers({ frame: "post_bold", big_words: "Crisp till 6pm", seed: 4, palette, background_image_url: photos["tall model, studio"], photo_treatment: "full", subject_boxes: [{ x: 0.04, y: 0.05, w: 0.38, h: 0.9, label: "person" }] } as never, FEED_CANVAS)
    assert.equal(right.region.x1, FEED_CANVAS.w)
    // Leftmost / rightmost glyph pixels hug the region's own edge.
    const edges = async (png: Buffer) => {
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      let lo = info.width, hi = 0
      for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * 4 + 3]! > 60) { lo = Math.min(lo, x); hi = Math.max(hi, x) }
      return { lo, hi }
    }
    assert.ok((await edges(left.overlay)).lo < left.region.x0 + 90)
    assert.ok((await edges(right.overlay)).hi > right.region.x1 - 90)
  })

  await test("no photo: the whole canvas, as before", async () => {
    const layers = await renderFrameLayers({ frame: "hook", big_words: "Bday sale", seed: 3, palette } as never, FEED_CANVAS)
    assert.equal(layers.layout, "full")
  })

  console.log(`\n${passed} passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
