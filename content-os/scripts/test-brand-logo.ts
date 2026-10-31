// The brand logo (lib/image/logo-upload.ts + the frame compositor's
// placeMark): a JPG's plain background is removed, a contrast variant is
// made, an SVG is rasterised; on a frame the logo is ~8% of the width, in
// an empty corner clear of the subject and the text, in the chosen corner
// when it's free, and not drawn when the brand turned it off.
//   npx tsx scripts/test-brand-logo.ts
import assert from "node:assert/strict"
import sharp from "sharp"

let passed = 0
async function test(name: string, fn: () => Promise<void>) {
  await fn()
  passed++
  console.log(`ok - ${name}`)
}

/** Bounding box of pixels that differ between two overlays. */
async function diffBox(a: Buffer, b: Buffer) {
  const A = await sharp(a).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const B = await sharp(b).ensureAlpha().raw().toBuffer()
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1
  for (let y = 0; y < A.info.height; y++) for (let x = 0; x < A.info.width; x++) {
    const i = (y * A.info.width + x) * 4
    if (Math.abs(A.data[i + 3]! - B[i + 3]!) > 40) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 }
}

async function main() {
  const { processLogo } = await import("@/lib/image/logo-upload")
  const { renderFrameLayers, rectsIntersect, FEED_CANVAS } = await import("@/lib/image/story-frame-compositor")

  // A dark wordmark on a white JPG.
  const jpg = await sharp(Buffer.from(`<svg width="600" height="240" xmlns="http://www.w3.org/2000/svg"><rect width="600" height="240" fill="#ffffff"/><rect x="60" y="70" width="480" height="100" rx="20" fill="#1b1b1b"/></svg>`)).jpeg().toBuffer()
  const logo = await processLogo(jpg, "image/jpeg")

  await test("a JPG's plain background is removed and the margins trimmed", async () => {
    assert.equal(logo.backgroundRemoved, true)
    const meta = await sharp(logo.main).metadata()
    assert.equal(meta.hasAlpha, true)
    assert.ok(meta.width! < 560 && meta.height! < 140, `${meta.width}x${meta.height}`)
  })

  await test("a dark logo reads on light, not dark; its variant is white", async () => {
    assert.equal(logo.readsOnLight, true)
    assert.equal(logo.readsOnDark, false)
    const { data } = await sharp(logo.variant).raw().toBuffer({ resolveWithObject: true })
    let white = 0, n = 0
    for (let i = 0; i < data.length; i += 4) if (data[i + 3]! > 128) { n++; if (data[i]! > 240) white++ }
    assert.ok(n > 0 && white / n > 0.95)
  })

  await test("an SVG logo is rasterised (never kept as SVG)", async () => {
    const svg = Buffer.from(`<svg width="300" height="100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40" fill="#e04020"/></svg>`)
    const out = await processLogo(svg, "image/svg+xml")
    assert.equal((await sharp(out.main).metadata()).format, "png")
  })

  // A frame: a model on the right, so the text and logo go left.
  const photo = `data:image/png;base64,${(await sharp(Buffer.from(`<svg width="1200" height="1600" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="1600" fill="#cfd8dc"/><rect x="700" y="100" width="420" height="1450" fill="#37474f"/></svg>`)).png().toBuffer()).toString("base64")}`
  const logoUrl = `data:image/png;base64,${logo.main.toString("base64")}`
  const variantUrl = `data:image/png;base64,${logo.variant.toString("base64")}`
  const slide = { frame: "post_bold", big_words: "Crisp till 6pm", script_line: "linen that behaves", seed: 3, brand_name: "SNITCH", background_image_url: photo, photo_treatment: "full", subject_boxes: [{ x: 0.58, y: 0.06, w: 0.36, h: 0.9, label: "person" }], logo_url: logoUrl, logo_variant_url: variantUrl }
  const without = await renderFrameLayers({ ...slide, show_logo: false } as never, FEED_CANVAS, { plain: true })

  await test("the logo: ~8% of the width, in an empty corner, off the subject and the text", async () => {
    const withLogo = await renderFrameLayers(slide as never, FEED_CANVAS, { plain: true })
    const box = await diffBox(withLogo.overlay, without.overlay)
    assert.ok(box, "no logo drawn")
    const w = box!.x1 - box!.x0 + 1
    assert.ok(w >= FEED_CANVAS.w * 0.05 && w <= FEED_CANVAS.w * 0.17, `logo width ${w}`)
    const r = { x0: box!.x0, y0: box!.y0, x1: box!.x1 + 1, y1: box!.y1 + 1 }
    assert.ok(!withLogo.subjects.some((s) => rectsIntersect(r, s)), "logo on the subject")
    // The text layer without the logo has nothing under the logo's box.
    const { data, info } = await sharp(without.overlay).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let under = 0
    for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) if (data[(y * info.width + x) * 4 + 3]! > 40) under++
    assert.equal(under, 0, "logo over text")
  })

  await test("a chosen corner is used when it's free; off = no logo", async () => {
    const tl = await renderFrameLayers({ ...slide, logo_position: "top-left" } as never, FEED_CANVAS, { plain: true })
    const bl = await renderFrameLayers({ ...slide, logo_position: "bottom-left" } as never, FEED_CANVAS, { plain: true })
    const a = await diffBox(tl.overlay, without.overlay)
    const b = await diffBox(bl.overlay, without.overlay)
    // Whichever of the two is free is honoured; a taken corner falls back to another free one.
    assert.ok(a && b)
    assert.ok(a!.y0 < FEED_CANVAS.h / 2 || b!.y0 > FEED_CANVAS.h / 2)
    assert.equal(await diffBox(without.overlay, without.overlay), null)
  })

  console.log(`\n${passed} passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
