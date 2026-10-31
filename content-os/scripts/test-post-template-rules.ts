// Checks lib/ai/post-template-rules.ts: listicle_cover's number is the real
// item count, festive_poster only for a real occasion, review_card only for
// review text the user gave -- anything else falls back to bold_statement.
//   npx tsx scripts/test-post-template-rules.ts
import assert from "node:assert/strict"
import type { GeneratedCaption } from "@/types/app"

let passed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`ok - ${name}`)
}

async function main() {
  const { finishPostTemplates, occasionNamedIn, postTemplateContext, postTemplatePromptBlock } = await import("@/lib/ai/post-template-rules")
  const { availablePostTemplates } = await import("@/lib/design/post-templates")
  const { initialPostDesign } = await import("@/lib/design/post-design-fields")
  const cap = (c: Partial<GeneratedCaption>): GeneratedCaption => ({ caption_text: "", hashtags: [], cta: "", character_count: 0, ...c } as GeneratedCaption)

  const listCaption = "Three easy ways to wear olive chinos:\n1. Tuck in a white tee\n2. Roll the hem once\n3. Pair with white sneakers\nShop now 👇"

  await test("listicle: the number is the count of items really in the caption", () => {
    const out = finishPostTemplates(cap({ suggested_template: "listicle_cover", caption_text: listCaption, listicle_title: "7 ways to wear chinos", listicle_items: ["Tuck in a white tee", "Roll the hem once", "Pair with white sneakers", "Wear with a blazer to weddings"] }), { topic: "", occasion: null, reviews: [] })
    assert.equal(out.suggested_template, "listicle_cover")
    assert.equal(out.listicle_count, 3) // the blazer item isn't in the caption
    assert.equal(out.listicle_title, "ways to wear chinos") // the model's "7" is dropped
  })

  await test("listicle: fewer than 3 real items -> bold_statement", () => {
    const out = finishPostTemplates(cap({ suggested_template: "listicle_cover", caption_text: listCaption, listicle_title: "ways", listicle_items: ["Tuck in a white tee", "Something not listed at all here"] }), { topic: "", occasion: null, reviews: [] })
    assert.equal(out.suggested_template, "bold_statement")
    assert.equal(out.listicle_items, undefined)
  })

  await test("festive: only with a real occasion; the occasion name is ours", () => {
    const none = finishPostTemplates(cap({ suggested_template: "festive_poster", festive_greeting: "Happy Diwali", festive_occasion: "Diwali" }), { topic: "new launch", occasion: null, reviews: [] })
    assert.equal(none.suggested_template, "bold_statement")
    const yes = finishPostTemplates(cap({ suggested_template: "festive_poster", festive_greeting: "Happy Diwali from us", festive_occasion: "Holi", festive_line: "50% off everything tonight" }), { topic: "Diwali post", occasion: "Diwali", reviews: [] })
    assert.equal(yes.suggested_template, "festive_poster")
    assert.equal(yes.festive_occasion, "Diwali")
    assert.equal(yes.festive_line, null) // a discount the topic never gave
  })

  await test("occasion: named in the topic, whole words only", () => {
    assert.equal(occasionNamedIn("Diwali sale on chinos"), "Diwali")
    assert.equal(occasionNamedIn("holiday sale"), null)
  })

  await test("occasion: from the topic without touching the date tables", async () => {
    const ctx = await postTemplateContext("Diwali drop, \"best chinos I've ever owned\" says Rahul")
    assert.equal(ctx.occasion, "Diwali")
    assert.deepEqual(ctx.reviews, ["best chinos I've ever owned"])
  })

  await test("review: only the user's own words, never a reworded or invented one", () => {
    const ctx = { topic: '"best chinos I have ever owned" -- Rahul', occasion: null, reviews: ["best chinos I have ever owned"] }
    const ok = finishPostTemplates(cap({ suggested_template: "review_card", review_quote: "Best chinos I have ever owned", review_author: "Rahul" }), ctx)
    assert.equal(ok.suggested_template, "review_card")
    assert.equal(ok.review_quote, "best chinos I have ever owned")
    assert.equal(ok.review_author, "Rahul")
    const invented = finishPostTemplates(cap({ suggested_template: "review_card", review_quote: "These chinos changed my life", review_author: "Priya" }), ctx)
    assert.equal(invented.suggested_template, "bold_statement")
    const noAuthor = finishPostTemplates(cap({ suggested_template: "review_card", review_quote: "best chinos I have ever owned", review_author: "Priya" }), ctx)
    assert.equal(noAuthor.review_author, null)
  })

  await test("other templates lose stray fields", () => {
    const out = finishPostTemplates(cap({ suggested_template: "quote_card", listicle_count: 5, review_quote: "x" }), undefined)
    assert.equal(out.suggested_template, "quote_card")
    assert.equal(out.listicle_count, undefined)
    assert.equal(out.review_quote, undefined)
  })

  await test("offered only when the data exists", () => {
    const ids = (o: Parameters<typeof availablePostTemplates>[0]) => availablePostTemplates(o).map((t) => t.id)
    assert.ok(!ids({ hasProductPhoto: false }).includes("festive_poster"))
    assert.ok(!ids({ hasProductPhoto: false }).includes("review_card"))
    assert.ok(!ids({ hasProductPhoto: false }).includes("listicle_cover"))
    assert.ok(ids({ hasProductPhoto: false, hasOccasion: true, hasReview: true, canCheckList: true }).includes("review_card"))
    const block = postTemplatePromptBlock({ topic: "x", occasion: null, reviews: [] })
    assert.ok(!block.fields.includes("festive_greeting") && !block.fields.includes("review_quote"))
  })

  await test("design: the badge is the checked count / occasion; missing data -> the bold look", () => {
    const items = ["Tuck in a white tee", "Roll the hem once", "Pair with white sneakers"]
    const listicle = initialPostDesign("listicle_cover", { listicle_title: "ways to wear chinos", listicle_count: 3, listicle_items: items }, 1)
    assert.equal(listicle?.badge, "3")
    assert.deepEqual(listicle?.items, items)
    // The number only with its list on the image: no items -> not a listicle.
    assert.equal(initialPostDesign("listicle_cover", { listicle_title: "ways to wear chinos", listicle_count: 3, post_big_words: "Chino tips" }, 1)?.template, "bold_statement")
    assert.equal(initialPostDesign("festive_poster", { festive_occasion: "Diwali", festive_greeting: "Happy Diwali" }, 1)?.badge, "Diwali")
    assert.equal(initialPostDesign("listicle_cover", { post_big_words: "New launch" }, 1)?.template, "bold_statement")
    assert.equal(initialPostDesign("review_card", { review_quote: "best chinos I have ever owned" }, 1)?.quote, "best chinos I have ever owned")
  })

  console.log(`\n${passed} passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
