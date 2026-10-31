// Catalogue photos (lib/ai/catalogue-photos.ts, the frame compositor's cutout
// layout, lib/ai/photo-fit.ts's weekly cap): a studio shot is detected, never
// drawn full-bleed (a cutout on the brand colour instead, its white shirt
// intact), scene directions are real Indian settings, and a post can reuse a
// photo at most twice a week.
//   npx tsx scripts/test-catalogue-photos.ts
import assert from "node:assert/strict"
import sharp from "sharp"

let passed = 0
async function test(name: string, fn: () => Promise<void> | void) {
  await fn()
  passed++
  console.log(`ok - ${name}`)
}

const W = 1200, H = 1600
/** A catalogue shot: a light backdrop with a gentle falloff, a "model" with a near-white shirt and olive trousers. */
async function studioShot(): Promise<Buffer> {
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="v" cx="0.5" cy="0.45" r="0.8"><stop offset="0%" stop-color="#f3f3f3"/><stop offset="100%" stop-color="#e2e2e2"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#v)"/>
<rect x="430" y="120" width="340" height="560" rx="60" fill="#d9dbd6" stroke="#9a9c96" stroke-width="10"/>
<rect x="450" y="660" width="300" height="880" rx="30" fill="#5d6a3e"/></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}
async function sceneShot(): Promise<Buffer> {
  // A street: sky, buildings of different colours, a road, a person -- structure all the way to the edges.
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#7fb3e6"/><stop offset="100%" stop-color="#f2d6a2"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#s)"/>
<rect x="0" y="300" width="300" height="900" fill="#b5523b"/><rect x="300" y="420" width="260" height="780" fill="#e8c547"/><rect x="560" y="250" width="320" height="950" fill="#3d6b8c"/><rect x="880" y="380" width="320" height="820" fill="#7a4e8c"/>
<rect x="0" y="1200" width="${W}" height="400" fill="#5a5a5a"/><rect x="520" y="700" width="160" height="700" rx="50" fill="#2a2a2a"/></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

async function main() {
  const { plainBackgroundColor } = await import("@/lib/image/subject-boxes")
  const { renderFrameLayers, FEED_CANVAS, STORY_CANVAS } = await import("@/lib/image/story-frame-compositor")
  const { candidSceneDirection, CANDID_SETTINGS, isLifestyleTemplate } = await import("@/lib/ai/catalogue-photos")
  const { photosAtWeeklyCap, POST_WEEKLY_CAP } = await import("@/lib/ai/photo-fit")
  const { resolveBrandPalette } = await import("@/lib/design/color-themes")
  const palette = resolveBrandPalette({ primary_color: "#1f4d3a", color_palette: ["#e9dcc6"], brand_brain: null, vibe: null } as never)

  const studio = await studioShot()
  const studioUrl = `data:image/png;base64,${studio.toString("base64")}`

  await test("a studio shot is a catalogue shot; a scene isn't", async () => {
    assert.ok(await plainBackgroundColor(studio))
    assert.equal(await plainBackgroundColor(await sceneShot()), null)
  })

  for (const [name, cv] of [["feed", FEED_CANVAS], ["story", STORY_CANVAS]] as const) {
    await test(`${name}: a catalogue shot is a cutout on the brand colour, never full-bleed`, async () => {
      const layers = await renderFrameLayers({ frame: "post_bold", big_words: "New launch", script_line: "olive straight fit", seed: 5, palette, background_image_url: studioUrl } as never, cv)
      assert.equal(layers.layout, "cutout")
      // The canvas corner away from the subject is the brand colour, not the backdrop grey.
      const { data } = await sharp(layers.base).extract({ left: layers.subjects[0]!.x0 > cv.w / 2 ? 10 : cv.w - 30, top: 10, width: 20, height: 20 }).raw().toBuffer({ resolveWithObject: true })
      const avg = [0, 1, 2].map((c) => data.filter((_, i) => i % 3 === c).reduce((a, b) => a + b, 0) / (data.length / 3))
      const base = [1, 3, 5].map((i) => parseInt(palette.base.slice(i, i + 2), 16))
      assert.ok(avg.every((v, c) => Math.abs(v - base[c]!) < 40), `corner ${avg.map(Math.round)} vs base ${base}`)
      // The near-white shirt survives the cutout: the subject's upper middle is opaque, not the brand colour.
      const sub = layers.subjects[0]!
      const shirt = await sharp(layers.base).extract({ left: Math.round((sub.x0 + sub.x1) / 2) - 10, top: Math.round(sub.y0 + (sub.y1 - sub.y0) * 0.2), width: 20, height: 20 }).raw().toBuffer()
      const shirtAvg = shirt.reduce((a, b) => a + b, 0) / shirt.length
      assert.ok(Math.abs(shirtAvg - 0xd9) < 30, `shirt ${Math.round(shirtAvg)}`)
    })
  }

  await test("a 'full' treatment keeps the photo full-bleed (opt-out)", async () => {
    const layers = await renderFrameLayers({ frame: "post_bold", big_words: "New launch", seed: 5, palette, background_image_url: studioUrl, photo_treatment: "full" } as never, FEED_CANVAS)
    assert.notEqual(layers.layout, "cutout")
  })

  await test("scene directions are real Indian settings, with the product worn or used", () => {
    const all = CANDID_SETTINGS.map((_, i) => candidSceneDirection(i))
    assert.equal(new Set(all).size, CANDID_SETTINGS.length)
    for (const d of all) assert.match(d, /Indian person wearing or using the exact product from the reference photo/)
    assert.ok(all.some((d) => /street/.test(d)) && all.some((d) => /cafe/.test(d)) && all.some((d) => /college/.test(d)) && all.some((d) => /metro/.test(d)))
  })

  await test("product posts keep the cutout; everything else is a lifestyle post", () => {
    assert.equal(isLifestyleTemplate("product_focus"), false)
    assert.equal(isLifestyleTemplate("annotated_product"), false)
    assert.equal(isLifestyleTemplate("bold_statement"), true)
    assert.equal(isLifestyleTemplate(null), true)
  })

  await test(`a post reuses a photo at most ${POST_WEEKLY_CAP}x per 7 days (carousel / story uses don't count)`, async () => {
    const rows = [
      { meta: { photo_id: "a", format: "post" } }, { meta: { photo_id: "a", format: "post" } },
      { meta: { photo_id: "b", format: "post" } },
      { meta: { photo_id: "c", format: "story" } }, { meta: { photo_id: "c", format: "carousel" } }, { meta: { photo_id: "c", format: "post" } },
    ]
    let filters: unknown[] = []
    const q = { select: () => q, eq: (...a: unknown[]) => { filters.push(a); return q }, gte: (...a: unknown[]) => { filters.push(a); return q }, limit: async () => ({ data: rows, error: null }) }
    const db = { from: (t: string) => { filters = [t]; return q } }
    assert.deepEqual(await photosAtWeeklyCap(db, "brand-1"), ["a"])
    assert.deepEqual(filters.slice(0, 3), ["content_events", ["brand_id", "brand-1"], ["event", "photo_used"]])
    const broken = { from: () => ({ select: () => { throw new Error("no table") } }) }
    assert.deepEqual(await photosAtWeeklyCap(broken, "brand-1"), [])
  })

  console.log(`\n${passed} passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
