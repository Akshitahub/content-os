// The carousel design system (lib/design/carousel-frames.ts +
// lib/image/carousel-frames.ts renderCarouselFrames): the layout plan never
// runs the same layout three slides in a row, the batch renderer keeps it
// that way even when full-bleed slides fall back to splits, and a slide
// never gets a photo whose photo-fit score is under 4.
//   npx tsx scripts/test-carousel-design.ts
import assert from "node:assert/strict"
import sharp from "sharp"

let passed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`ok - ${name}`)
}

async function main() {
  const { carouselLayoutFor, hasLayoutRun, finalizeCarouselFrames } = await import("@/lib/design/carousel-frames")
  const { renderCarouselFrames } = await import("@/lib/image/carousel-frames")
  const { pickFittingPhoto, MIN_PHOTO_FIT } = await import("@/lib/ai/photo-fit")
  const { resolveBrandPalette } = await import("@/lib/design/color-themes")
  const palette = resolveBrandPalette({ primary_color: "#1f4d3a", color_palette: ["#e9dcc6"], brand_brain: null, vibe: null } as never)

  await test("the plan: three layouts, never the same three slides in a row", () => {
    for (let n = 2; n <= 10; n++) {
      const plan = Array.from({ length: n }, (_, i) => carouselLayoutFor(i, n))
      assert.ok(!hasLayoutRun(plan), `${n}: ${plan.join(",")}`)
      if (n >= 5) assert.deepEqual([...new Set(plan)].sort(), ["full", "split", "type"])
    }
    assert.equal(hasLayoutRun(["split", "split", "split"]), true)
    assert.equal(hasLayoutRun(["split", "type", "split"]), false)
  })

  await test("finalize stamps the layout on every slide", () => {
    const slides = finalizeCarouselFrames(Array.from({ length: 5 }, (_, i) => ({ headline: `Point ${i}`, subtext: "a line" })), { seedBase: 1 })
    assert.deepEqual(slides.map((s) => s.layout_hint), ["full", "split", "type", "full", "full"])
  })

  await test("the batch keeps the rhythm when full-bleed slides fall back to splits", async () => {
    // A full-height person on every photo: full-bleed can't fit text, so each would split.
    const tall = `data:image/png;base64,${(await sharp(Buffer.from(`<svg width="1200" height="1600" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="1600" fill="#9fb3c8"/><rect x="380" y="60" width="440" height="1520" fill="#2d3a4a"/></svg>`)).png().toBuffer()).toString("base64")}`
    const box = [{ x: 0.3, y: 0.03, w: 0.4, h: 0.95, label: "person" as const }]
    const frames = ["hook", "slide_photo", "slide_photo", "slide_photo", "slide_photo", "cta"] as const
    const out = await renderCarouselFrames(frames.map((frame, i) => ({
      frame, headline: ["Olive chinos, 3 ways", "Olive + white tee", "Roll the hem once", "Loafers, no socks", "Navy on olive", "Shop the chinos"][i]!,
      subtext: frame === "cta" ? "new in" : "One clear line for this slide", cta: frame === "cta" ? "Shop now" : null,
      image_url: tall, subject_boxes: box, seed: 3 + i, layout_hint: "full",
    })), { name: "SNITCH", palette, fontId: "anton" })
    const layouts = out.map((o) => o.layout)
    assert.ok(!hasLayoutRun(layouts), layouts.join(","))
    assert.ok(layouts.includes("type"), layouts.join(","))
  })

  await test("the cover always gets its swipe cue, even when crowded", async () => {
    // The olive cover: the person fills the left half, the headline, script
    // line and logo the right -- the counter used to take the last free
    // corner and the swipe cue was dropped.
    const left = `data:image/png;base64,${(await sharp(Buffer.from(`<svg width="1200" height="1500" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="1500" fill="#b9b2a5"/><rect x="60" y="40" width="560" height="1440" fill="#4a5a3a"/></svg>`)).png().toBuffer()).toString("base64")}`
    const cover = (image_url: string | null) => ({ frame: "hook" as const, headline: "Olive chinos", subtext: "Swipe for easy combos", image_url, subject_boxes: image_url ? [{ x: 0.05, y: 0.02, w: 0.47, h: 0.96, label: "person" as const }] : null, seed: 5, brand_mark: true, layout_hint: "full" as const })
    const rest = [
      { frame: "slide_photo" as const, headline: "White shirt", subtext: "a line", seed: 6, layout_hint: "split" as const },
      { frame: "cta" as const, headline: "Choose a look", cta: "Shop olive chinos", seed: 7, brand_mark: true, layout_hint: "full" as const },
    ]
    for (const img of [left, null]) {
      const [first] = await renderCarouselFrames([cover(img), ...rest], { name: "SNITCH", palette, fontId: "anton" })
      assert.ok(first!.labels.includes("swipe"), `${img ? "photo" : "no photo"} cover: ${first!.labels.join(",") || "no labels"}`)
    }
  })

  await test(`a photo is assigned only at photo-fit ${MIN_PHOTO_FIT}+`, () => {
    const candidates = [{ id: "a" }, { id: "b" }]
    assert.equal(pickFittingPhoto([{ id: "a", fit: 3, reason: "" }, { id: "b", fit: 2, reason: "" }], candidates).photo, null)
    assert.equal(pickFittingPhoto([{ id: "a", fit: 3, reason: "" }, { id: "b", fit: MIN_PHOTO_FIT, reason: "" }], candidates).photo?.id, "b")
  })

  console.log(`\n${passed} passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
