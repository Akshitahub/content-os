// Specific headlines (lib/ai/quality-gate.ts headlineTopicIssues) and the
// flat editorial graphic (lib/ai/post-image-pipeline.ts editorialCore):
// a headline that drops the topic's subject fails the gate; an editorial
// prompt loses its photo language and -- unless asked -- its people.
//   npx tsx scripts/test-headline-editorial.ts
import assert from "node:assert/strict"

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`ok - ${name}`)
}

async function main() {
  const { topicKeyTerms, headlineTopicIssues } = await import("@/lib/ai/quality-gate")
  const { editorialCore, asksForPeople, EDITORIAL_GRAPHIC_STYLE } = await import("@/lib/ai/post-image-pipeline")
  const { initialPostDesign, POST_BIG_WORDS_MAX } = await import("@/lib/design/post-design-fields")
  const topic = "How to style pure linen so it doesn't look wrinkled by noon"

  test("the topic's key terms are its subject, not its filler", () => {
    const terms = topicKeyTerms(topic)
    assert.ok(terms.includes("linen"), terms.join(","))
    assert.ok(terms.some((t) => t.startsWith("wrinkl")), terms.join(","))
    for (const filler of ["how", "style", "look", "doesn't", "doesnt"]) assert.ok(!terms.includes(filler), filler)
  })

  test("the real result's headlines fail; a specific one passes", () => {
    for (const vague of ["shirt styling tips", "small tweaks matter"]) {
      const issues = headlineTopicIssues("post", { post_big_words: vague }, topic)
      assert.equal(issues.length, 1, vague)
      assert.equal(issues[0]!.check, "vague_headline")
      assert.match(issues[0]!.fix_hint, /linen/)
    }
    assert.equal(headlineTopicIssues("post", { post_big_words: "Linen that stays crisp till 6pm" }, topic).length, 0)
    assert.equal(headlineTopicIssues("post", { post_big_words: "No more wrinkles by noon" }, topic).length, 0)
  })

  test("carousel covers and story openers are checked too; no topic = no check", () => {
    assert.equal(headlineTopicIssues("carousel", { slides: [{ headline: "Shirt tips" }] }, topic).length, 1)
    assert.equal(headlineTopicIssues("story", { stories: [{ big_words: "Linen, sorted" }] }, topic).length, 0)
    assert.equal(headlineTopicIssues("post", { post_big_words: "anything" }, null).length, 0)
  })

  test("a specific post headline fits whole (up to 7 words)", () => {
    assert.equal(POST_BIG_WORDS_MAX, 7)
    assert.equal(initialPostDesign("bold_statement", { post_big_words: "Linen that stays crisp till 6pm" }, 1)?.big_words, "Linen that stays crisp till 6pm")
  })

  const brief = "A candid phone photo of a young Indian man in a pale linen shirt at a cafe table. He rolls one sleeve. A linen shirt folded beside a steamer on a wooden table, shallow depth of field."
  test("editorial graphic: no photo language, no people unless asked", () => {
    const core = editorialCore(brief, false)
    assert.doesNotMatch(core, /\b(man|he|candid|phone photo|depth of field)\b/i)
    assert.match(core, /linen shirt folded beside a steamer/i)
    assert.match(editorialCore(brief, true), /young Indian man/)
    assert.match(EDITORIAL_GRAPHIC_STYLE, /not a photograph/)
  })

  test("people only when the user's brief asks for them", () => {
    assert.equal(asksForPeople(topic), false)
    assert.equal(asksForPeople("linen shirt worn by a model at a wedding"), true)
  })

  console.log(`\n${passed} passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
