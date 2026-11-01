// The Editorial graphic shows the actual product (lib/ai/post-image-pipeline.ts):
// the post's product as the reference photo shows it, or -- with no product --
// the topic's own subject in its real colour and material; a sentence about
// a person keeps the garment it names; the reference wrapper asks for a
// drawing of THAT product, not a photograph.
//   npx tsx scripts/test-editorial-subject.ts
import assert from "node:assert/strict"
import { EDITORIAL_GRAPHIC_STYLE, editorialCore, editorialSubjectLine, wrapForEditorialReference } from "@/lib/ai/post-image-pipeline"

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`ok - ${name}`)
}

test("no product: the topic's own subject, in its real colour and material", () => {
  const line = editorialSubjectLine({ hasReference: false, topic: "How to style pure linen so it doesn't look wrinkled by noon" })
  assert.match(line, /"How to style pure linen so it doesn't look wrinkled by noon"/)
  assert.match(line, /real colour and material/)
  assert.match(line, /never to the subject/)
})

test("a product: that product exactly as the reference shows it, never recoloured", () => {
  const line = editorialSubjectLine({ productName: "White Pure Linen Shirt", hasReference: true, topic: "linen" })
  assert.match(line, /the White Pure Linen Shirt exactly as the reference photo shows it/)
  assert.match(line, /never recoloured to the palette/)
})

test("a person sentence keeps the garment it names", () => {
  const core = editorialCore("A man wearing a white pure-linen shirt walks to work. Morning light on the street.", false)
  assert.match(core, /a white pure-linen shirt, shown on its own/)
  assert.doesNotMatch(core, /\bman\b/)
})

test("the palette is for the background, the subject keeps its colours", () => {
  assert.match(EDITORIAL_GRAPHIC_STYLE, /the subject itself keeps its own real colours/)
})

test("the reference wrapper draws THAT product, not a photo of a different one", () => {
  const w = wrapForEditorialReference("a flat graphic")
  assert.match(w, /Draw THAT product -- the same colour, material and silhouette/)
  assert.match(w, /Not a photograph and not a different product or colourway/)
})

console.log(`\n${passed} passed`)
