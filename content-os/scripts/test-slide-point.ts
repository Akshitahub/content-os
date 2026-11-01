// Carousel points must be visible (lib/ai/slide-photo-check.ts,
// lib/ai/carousel-slide-background.ts, lib/ai/photo-fit.ts): a styling slide
// is generated with only the product taken from the reference and the
// headline's item in view, the per-slide check asks for that item, and a
// brand photo that doesn't show it can't fit.
//   npx tsx scripts/test-slide-point.ts
import assert from "node:assert/strict"
import { wrapForStyledReference } from "@/lib/ai/carousel-slide-background"
import { AGREE_MIN, buildPointCheckPrompt, photoMissesPoint, slidePoint } from "@/lib/ai/slide-photo-check"
import { buildPhotoFitPrompt } from "@/lib/ai/photo-fit"
import { REFERENCE_IMAGE_PEOPLE_GUARD } from "@/lib/ai/post-image-pipeline"

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`ok - ${name}`)
}

const copy = { headline: "White tee", body: "Olive chinos with a crisp white tee and white sneakers", productName: "Olive Straight Fit Chinos" }

test("the slide's point is its headline and line", () => {
  assert.deepEqual(slidePoint(copy), { show: "White tee -- Olive chinos with a crisp white tee and white sneakers", productName: "Olive Straight Fit Chinos" })
})

test("a styling slide takes only the product from the reference, and shows the named item", () => {
  const prompt = wrapForStyledReference("a sunny Mumbai street", slidePoint(copy))
  assert.match(prompt, /Reproduce ONLY the Olive Straight Fit Chinos exactly/)
  assert.match(prompt, /Do NOT copy anything else from the reference/)
  assert.match(prompt, /must clearly show, obvious at a glance: White tee/)
  assert.match(prompt, /never the reference photo's own outfit/)
  // The old guard kept the catalogue model's whole outfit -- not here.
  assert.ok(!prompt.includes(REFERENCE_IMAGE_PEOPLE_GUARD))
})

test("the per-slide check asks for the specific item the headline names", () => {
  const prompt = buildPointCheckPrompt(copy)
  assert.match(prompt, /HEADLINE: "White tee"/)
  assert.match(prompt, /a striped shirt instead of a white tee/)
  assert.match(prompt, /The Olive Straight Fit Chinos must be visible too/)
})

test("a brand photo that doesn't show the headline's item can't fit", () => {
  const prompt = buildPhotoFitPrompt({ brief: "the chinos styled for the weekend", copy: "White tee | Olive chinos with a crisp white tee", headline: "White tee" }, [{ description: "man in olive chinos and a striped shirt" }], "Olive Straight Fit Chinos")
  assert.match(prompt, /Headline: "White tee" -- the photo must show the specific item/)
  assert.match(prompt, /doesn't show the specific item the headline \/ copy names .* is never above 2/)
})

test(`a middle slide whose item still isn't shown (under ${AGREE_MIN}) goes type-led; cover and CTA keep their photo`, () => {
  assert.ok(photoMissesPoint(3, 2, 5))
  assert.ok(!photoMissesPoint(AGREE_MIN, 2, 5))
  assert.ok(!photoMissesPoint(2, 0, 5) && !photoMissesPoint(2, 4, 5))
  assert.ok(!photoMissesPoint(undefined, 2, 5))
})

console.log(`\n${passed} passed`)
