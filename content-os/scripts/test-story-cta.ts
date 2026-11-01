// The story's CTA frame shows the product (lib/ai/story-frames.ts,
// lib/ai/story-slide-background.ts): its button names the product ("Shop the
// linen shirt"), its subject comes from the picked product or the story's
// own subject, and its photo prompt asks for the whole product -- never a
// close crop of a collar.
//   npx tsx scripts/test-story-cta.ts
import assert from "node:assert/strict"
import { ctaLabelNaming, finalizeStoryFrames, shortProductName, type StoryFrameContext } from "@/lib/ai/story-frames"
import { ctaProductLine } from "@/lib/ai/story-slide-background"

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`ok - ${name}`)
}

const ctx = (productName: string | null): StoryFrameContext => ({
  topic: "How to style pure linen so it doesn't look wrinkled by noon",
  calloutSource: "", hasProduct: !!productName, productName, numberSource: "", ctaPhrase: "Shop now", topicCore: null,
})

test("the button names what it sells", () => {
  assert.equal(ctaLabelNaming("Shop now", "linen shirt"), "Shop the linen shirt")
  assert.equal(ctaLabelNaming("Grab yours", "linen shirt"), "Grab the linen shirt")
  assert.equal(ctaLabelNaming("Link in bio", "linen shirt"), "Shop the linen shirt")
  assert.equal(ctaLabelNaming("Shop linen shirts", "linen shirt"), "Shop linen shirts")
  assert.equal(ctaLabelNaming("Shop now", null), "Shop now")
})

test("a product's short name for the button", () => {
  assert.equal(shortProductName("Olive Straight Fit Chinos"), "olive chinos")
  assert.equal(shortProductName("Linen Shirt"), "linen shirt")
  assert.equal(shortProductName(null), null)
})

test("no product: the story's own subject names the cta", () => {
  const out = finalizeStoryFrames([
    { frame: "hook", big_words: "Crisp by noon" },
    { frame: "hook", big_words: "Steam, don't iron" },
    { frame: "cta", big_words: "Stay crisp", subject: "linen shirt", cta_label: "Shop now" },
  ], ctx(null))
  const cta = out[2]!
  assert.equal(cta.cta_subject, "linen shirt")
  assert.equal(cta.cta_label, "Shop the linen shirt")
})

test("a picked product names the cta, whatever the model said", () => {
  const out = finalizeStoryFrames([{ frame: "hook", big_words: "Olive, three ways" }, { frame: "cta", big_words: "Your pick", subject: "pants", cta_label: "Shop now" }], ctx("Olive Straight Fit Chinos"))
  assert.equal(out[1]!.cta_subject, "olive chinos")
  assert.equal(out[1]!.cta_label, "Shop the olive chinos")
})

test("the cta photo shows the whole product, never a close crop", () => {
  const line = ctaProductLine("linen shirt")
  assert.match(line, /the whole linen shirt, fully in frame and recognisable/)
  assert.match(line, /never a close crop of a detail, a collar, a neckline/)
  assert.equal(ctaProductLine(null), "")
})

console.log(`\n${passed} passed`)
