// No grey placeholder boxes, ever (lib/image/story-frame-compositor.ts
// composeType): every rendered carousel slide -- with no photo at all, or
// with only the product photo to show as a detail -- has no large flat area
// in a colour outside the brand palette. Big numerals only in a listicle, equal to
// the item's position.
//   npx tsx scripts/test-carousel-type-slides.ts
import assert from "node:assert/strict"
import sharp from "sharp"
import { finalizeCarouselFrames, isListicle } from "@/lib/design/carousel-frames"
import { listItemNumeral, typeBandColor } from "@/lib/image/story-frame-compositor"
import { renderCarouselFrames, type CarouselFrameSlide } from "@/lib/image/carousel-frames"
import { NEUTRAL_PALETTE, type BrandPalette } from "@/lib/design/color-themes"

let passed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`ok - ${name}`)
}

type RGB = [number, number, number]
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB
const dist = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const chroma = (c: RGB) => Math.max(...c) - Math.min(...c)
/**
 * Distance from c to the nearest palette colour, or to a blend of two where
 * one is a real colour (a palette gradient). A blend of two neutrals -- the
 * grey between near-black and off-white -- is NOT the palette: that is the
 * placeholder card this test exists to catch.
 */
function paletteDistance(c: RGB, palette: RGB[]): number {
  let best = Math.min(...palette.map((p) => dist(c, p)))
  for (const a of palette) {
    for (const b of palette) {
      if (chroma(a) < 40 && chroma(b) < 40) continue
      const ab: RGB = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2
      const t = len2 ? Math.max(0, Math.min(1, ((c[0] - a[0]) * ab[0] + (c[1] - a[1]) * ab[1] + (c[2] - a[2]) * ab[2]) / len2)) : 0
      best = Math.min(best, dist(c, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]))
    }
  }
  return best
}

/** Flat areas (10px cells matching all four neighbours) covering over 5% of the slide, with their colour. */
async function largeFlatAreas(jpg: Buffer): Promise<{ color: RGB; share: number }[]> {
  const W = 108, H = 135
  const { data } = await sharp(jpg).resize(W, H, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const at = (x: number, y: number): RGB => [data[(y * W + x) * 3]!, data[(y * W + x) * 3 + 1]!, data[(y * W + x) * 3 + 2]!]
  const groups = new Map<string, { sum: RGB; n: number }>()
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const c = at(x, y)
      const flat = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].every((d) => Math.max(...d.map((v, k) => Math.abs(v - c[k]!))) <= 6)
      if (!flat) continue
      const key = c.map((v) => Math.round(v / 20)).join(",")
      const g = groups.get(key) ?? { sum: [0, 0, 0], n: 0 }
      g.sum = [g.sum[0] + c[0], g.sum[1] + c[1], g.sum[2] + c[2]]
      g.n++
      groups.set(key, g)
    }
  }
  return [...groups.values()].filter((g) => g.n / (W * H) > 0.05).map((g) => ({ color: g.sum.map((v) => v / g.n) as RGB, share: g.n / (W * H) }))
}

async function checkPalette(slides: CarouselFrameSlide[], palette: BrandPalette, label: string) {
  const rendered = await renderCarouselFrames(slides, { name: "SNITCH", palette, fontId: "anton" })
  if (process.env.DUMP_DIR) for (const [i, r] of rendered.entries()) await sharp(r.jpg).toFile(`${process.env.DUMP_DIR}/${label}-${i + 1}-${r.layout}.jpg`)
  const colours = [palette.deep, palette.base, palette.accent, palette.pop].map(hex)
  for (const [i, r] of rendered.entries()) {
    for (const area of await largeFlatAreas(r.jpg)) {
      const d = paletteDistance(area.color, colours)
      assert.ok(d <= 30, `${label} slide ${i + 1} (${r.layout}): ${(area.share * 100).toFixed(0)}% flat rgb(${area.color.map(Math.round).join(",")}) is ${d.toFixed(0)} from the palette`)
    }
  }
  return rendered
}

const SLIDES: CarouselFrameSlide[] = [
  { frame: "hook", headline: "Linen by noon", subtext: "Stay crisp all day", seed: 3, brand_mark: true, layout_hint: "full" },
  { frame: "slide_photo", headline: "Hang it to dry", subtext: "Never tumble dry pure linen shirts", seed: 5, layout_hint: "split" },
  { frame: "slide_type", headline: "Mist, then smooth", subtext: "A light mist relaxes the creases before you leave", seed: 7, layout_hint: "type" },
  { frame: "slide_photo", headline: "Size up once", subtext: "Room to move means fewer folds", seed: 9, layout_hint: "full" },
  { frame: "cta", headline: "Crisp till 6pm", cta: "Shop the linen", seed: 11, brand_mark: true, layout_hint: "full" },
]

async function main() {
  await test("only listicles number their items, and the numeral is the item's position", () => {
    const raw = [{ headline: "3 ways to wear olive" }, { headline: "White tee" }, { headline: "Navy blazer" }, { headline: "Loafers" }, { headline: "Shop" }]
    const list = finalizeCarouselFrames(raw, { seedBase: 1, listicle: true })
    assert.deepEqual(list.map((s) => s.list_index), [null, 1, 2, 3, null])
    assert.deepEqual(list.map((s) => listItemNumeral({ list_index: s.list_index as number | null })), [null, "01", "02", "03", null])
    const plain = finalizeCarouselFrames(raw, { seedBase: 1 })
    assert.ok(plain.every((s) => s.list_index == null && listItemNumeral({ list_index: s.list_index as null }) === null))
    assert.ok(isListicle("ways") && isListicle("mini_guide"))
    assert.ok(!isListicle("mistake_fix") && !isListicle("myth_truth") && !isListicle(undefined))
  })

  await test("the band is the brand's pop colour when ink reads on it -- never a slate box for a neutral brand", () => {
    assert.equal(typeBandColor(NEUTRAL_PALETTE).fill, NEUTRAL_PALETTE.pop)
  })

  await test("the check itself catches a grey placeholder card", async () => {
    const card = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: NEUTRAL_PALETTE.base } })
      .composite([{ input: await sharp({ create: { width: 960, height: 520, channels: 3, background: "#808080" } }).png().toBuffer(), left: 60, top: 760 }]).jpeg().toBuffer()
    const areas = await largeFlatAreas(card)
    const colours = [NEUTRAL_PALETTE.deep, NEUTRAL_PALETTE.base, NEUTRAL_PALETTE.accent, NEUTRAL_PALETTE.pop].map(hex)
    assert.ok(areas.some((a) => paletteDistance(a.color, colours) > 30), "a #808080 card should be flagged")
  })

  await test("no photo anywhere: every slide stays in the palette", async () => {
    const rendered = await checkPalette(SLIDES, NEUTRAL_PALETTE, "neutral")
    // Photo-led middle slides with no photo are type-led too, never a bare gradient.
    assert.deepEqual(rendered.slice(1, 4).map((r) => r.layout), ["type", "type", "type"])
    await checkPalette(SLIDES, { deep: "#2b1d3a", base: "#fbf6ee", accent: "#7a4bc2", pop: "#f2b33d", source: "brand_colors" }, "violet")
  })

  await test("a type slide with only the product photo shows a detail of it, still in the palette", async () => {
    // A stand-in product photo: noisy olive fabric on a light studio floor.
    const noise = await sharp({ create: { width: 800, height: 1000, channels: 3, background: "#000000", noise: { type: "gaussian", mean: 110, sigma: 40 } } as never }).png().toBuffer()
    const product = await sharp({ create: { width: 800, height: 1000, channels: 3, background: "#e9e6df" } })
      .composite([{ input: await sharp(noise).resize(400, 700).tint("#6b7a3c").toBuffer(), left: 200, top: 200 }]).jpeg().toBuffer()
    const url = `data:image/jpeg;base64,${product.toString("base64")}`
    const slides = SLIDES.map((s, i) => (i === 2 ? { ...s, detail_image_url: url } : s))
    const rendered = await checkPalette(slides, NEUTRAL_PALETTE, "detail")
    assert.equal(rendered[2]!.layout, "type")
  })

  console.log(`\n${passed} passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
