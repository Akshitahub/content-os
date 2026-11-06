// Checks lib/design/carousel-frames.ts and lib/design/post-design-fields.ts:
// frame order, word caps, no lists on a frame, the CTA label -- and the
// compositor: no unplanned panel, never a cut subject.
//   npx tsx scripts/test-carousel-frames.ts
import assert from "node:assert/strict"
import { carouselFrameFor, finalizeCarouselFrames, CAROUSEL_BODY_MAX, CAROUSEL_BIG_WORDS_MAX } from "@/lib/design/carousel-frames"
import { initialPostDesign, clampPostDesign } from "@/lib/design/post-design-fields"

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`ok - ${name}`)
}
const words = (s: unknown) => (String(s ?? "").match(/\S+/g) ?? []).length

test("hook first, CTA last, the middle follows each slide's layout", () => {
  const layouts = ["full", "full", "type", "split", "full"] as const
  assert.deepEqual(layouts.map((l, i) => carouselFrameFor(i, 5, l)), ["hook", "slide_photo", "slide_type", "slide_photo", "cta"])
  assert.deepEqual([0, 1].map((i) => carouselFrameFor(i, 2, "full")), ["hook", "cta"])
  // Frames come from the content, not the index: no contrast -> full / type alternating.
  const out = finalizeCarouselFrames(Array.from({ length: 5 }, (_, i) => ({ role: i === 0 ? "hook" : i === 4 ? "cta" : "tip", headline: `Point ${i}` })), { seedBase: 1 })
  assert.deepEqual(out.map((s) => s.frame), ["hook", "slide_photo", "slide_type", "slide_photo", "cta"])
})

test("every slide: <= 4 big words, <= 12 body words, no points", () => {
  const out = finalizeCarouselFrames([
    { type: "cover", headline: "Your checkout is quietly losing the sale every day", subtext: "Where shoppers drop off and what to fix first today" },
    { type: "content", headline: "Why shoppers leave", points: ["A shipping cost they only see at the very final step of the checkout", "b"] },
    { type: "content", big_words: "Fix three things", body: "Show shipping on the product page, cut checkout to address and payment only" },
    { type: "cta", headline: "Full cost upfront", cta: "Book a free checkout audit with our team today" },
  ], { seedBase: 1 })
  for (const s of out) {
    assert.ok(words(s.headline) >= 1 && words(s.headline) <= CAROUSEL_BIG_WORDS_MAX, `big words: ${s.headline}`)
    assert.ok(words(s.subtext) <= CAROUSEL_BODY_MAX, `body: ${s.subtext}`)
    assert.deepEqual(s.points, [])
  }
  assert.equal(out[1]!.subtext, "A shipping cost they only see at the very final step")
  assert.equal(out[2]!.headline, "Fix three things")
  assert.ok(words(out[3]!.cta) <= 5)
  assert.equal(out[0]!.brand_mark, true)
  assert.equal(out[1]!.brand_mark, false)
})

test("a clamp never ends on a dangling joiner", () => {
  const [s] = finalizeCarouselFrames([{ headline: "Light it and the room", subtext: "x" }, { headline: "b" }], { seedBase: 1 })
  assert.equal(s!.headline, "Light it")
})

test("a cut lands on the phrase break, never mid-phrase", () => {
  const [, cta] = finalizeCarouselFrames([{ headline: "a" }, { headline: "Pick the look, own it" }], { seedBase: 1 })
  assert.equal(cta!.headline, "Pick the look")
})

test("CTA label falls back to the brand's phrase", () => {
  const out = finalizeCarouselFrames([{ headline: "a" }, { headline: "Bring it home" }], { ctaPhrase: "Shop now", seedBase: 1 })
  assert.equal(out[1]!.cta, "Shop now")
})

test("post design: model words, else the overlay text; null for other templates", () => {
  assert.equal(initialPostDesign("bold_statement", { post_big_words: "Bday sale is here now and it is big", post_script_line: "our biggest one yet" }, 1)?.big_words, "Bday sale is here now and it")
  assert.equal(initialPostDesign("quote_card", { fallbackWords: ["", "New launch"] }, 1)?.big_words, "New launch")
  assert.equal(initialPostDesign("hard_truth_checklist", { post_big_words: "x" }, 1), null)
  assert.equal(initialPostDesign("minimal", {}, 1), null)
  assert.equal(clampPostDesign({ template: "minimal", big_words: "a b c d e", script_line: "1 2 3 4 5 6 7", seed: 3 }).script_line, "1 2 3 4 5 6")
})

// The compositor: no unplanned panel, and a subject is never cut.
async function renderTests() {
  const sharp = (await import("sharp")).default
  const { renderFrameLayers, FEED_CANVAS } = await import("@/lib/image/story-frame-compositor")
  const { resolveBrandPalette } = await import("@/lib/design/color-themes")
  const palette = resolveBrandPalette({ primary_color: "#1f4d3a", color_palette: ["#e9dcc6"], brand_brain: null, vibe: null } as never)
  // Heels on the left, a sneaker on the right: together they span the frame,
  // so there's no free region beside them for the words.
  const photo = `data:image/png;base64,${(await sharp(Buffer.from(`<svg width="1200" height="1600" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="1600" fill="#c9c2b6"/><rect x="60" y="120" width="500" height="1360" fill="#7a2e3a"/><rect x="640" y="120" width="500" height="1360" fill="#2e3a7a"/></svg>`)).png().toBuffer()).toString("base64")}`
  const boxes = [
    { x: 0.05, y: 0.075, w: 0.417, h: 0.85, label: "product" as const },
    { x: 0.533, y: 0.075, w: 0.417, h: 0.85, label: "product" as const },
  ]
  const slide = (layout_hint: "full" | "split") => ({ frame: "slide_photo" as const, big_words: "Heels or sneakers", body: "One outfit, two moods", seed: 4, background_image_url: photo, subject_boxes: boxes, layout_hint, palette, font_id: "anton" as const, brand_name: "SOLE", photo_treatment: "full" as const })

  const full = await renderFrameLayers(slide("full"), FEED_CANVAS)
  assert.ok(full.layout === "full" || full.layout === "free", `subjects spanning the frame, hint full: layout ${full.layout}, expected full-bleed`)
  // Full-bleed: the text region is the whole canvas, not a panel beside the photo.
  assert.deepEqual(full.region, { x0: 0, y0: 0, x1: FEED_CANVAS.w, y1: FEED_CANVAS.h })
  passed++
  console.log("ok - subjects spanning the frame + layout_hint full -> full-bleed, no panel or band")

  // A planned split: the photo side shows both subjects whole (fitted, not cut).
  const split = await renderFrameLayers(slide("split"), FEED_CANVAS)
  assert.equal(split.layout, "split")
  assert.equal(split.subjects.length, 2)
  // Each subject keeps its shape -- a cut one comes out narrower or shorter than its box.
  const srcAspect = (b: (typeof boxes)[number]) => (b.w * 1200) / (b.h * 1600)
  const m = Math.round(0.04 * FEED_CANVAS.w)
  split.subjects.forEach((r, i) => {
    const aspect = (r.x1 - r.x0 - 2 * m) / (r.y1 - r.y0 - 2 * m)
    assert.ok(Math.abs(aspect - srcAspect(boxes[i]!)) < 0.06, `subject ${i + 1} cut: aspect ${aspect.toFixed(3)} vs ${srcAspect(boxes[i]!).toFixed(3)}`)
  })
  passed++
  console.log("ok - a planned split fits its photo so every subject stays whole")
}

renderTests().then(() => console.log(`\n${passed} passed`), (err) => { console.error(err); process.exit(1) })
