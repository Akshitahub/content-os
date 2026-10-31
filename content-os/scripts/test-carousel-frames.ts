// Checks lib/design/carousel-frames.ts and lib/design/post-design-fields.ts:
// frame order, word caps, no lists on a frame, the CTA label.
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

test("hook first, CTA last, middle alternates photo / type", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => carouselFrameFor(i, 5)), ["hook", "slide_photo", "slide_type", "slide_photo", "cta"])
  assert.deepEqual([0, 1].map((i) => carouselFrameFor(i, 2)), ["hook", "cta"])
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

test("CTA label falls back to the brand's phrase", () => {
  const out = finalizeCarouselFrames([{ headline: "a" }, { headline: "Bring it home" }], { ctaPhrase: "Shop now", seedBase: 1 })
  assert.equal(out[1]!.cta, "Shop now")
})

test("post design: model words, else the overlay text; null for other templates", () => {
  assert.equal(initialPostDesign("bold_statement", { post_big_words: "Bday sale is here now", post_script_line: "our biggest one yet" }, 1)?.big_words, "Bday sale is here")
  assert.equal(initialPostDesign("quote_card", { fallbackWords: ["", "New launch"] }, 1)?.big_words, "New launch")
  assert.equal(initialPostDesign("hard_truth_checklist", { post_big_words: "x" }, 1), null)
  assert.equal(initialPostDesign("minimal", {}, 1), null)
  assert.equal(clampPostDesign({ template: "minimal", big_words: "a b c d e", script_line: "1 2 3 4 5 6 7", seed: 3 }).script_line, "1 2 3 4 5 6")
})

console.log(`\n${passed} passed`)
