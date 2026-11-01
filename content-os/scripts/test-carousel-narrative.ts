// Carousels people swipe and save (lib/ai/quality-gate.ts carouselSlideIssues):
// slide words that say nothing ("Style it", "Yours next") fail, a slide that
// names its point passes, and the cover's number must be the real count of
// the points the middle slides deliver.
//   npx tsx scripts/test-carousel-narrative.ts
import assert from "node:assert/strict"

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`ok - ${name}`)
}

async function main() {
  const { carouselSlideIssues } = await import("@/lib/ai/quality-gate")
  const slide = (big_words: string, type = "content") => ({ type, big_words, headline: big_words })

  test("generic slide words fail; a concrete point passes", () => {
    const issues = carouselSlideIssues({
      slides: [slide("Olive chinos, 3 ways", "cover"), slide("Olive + white tee"), slide("Roll the hem once"), slide("Style it")],
      cta_slide: { big_words: "Yours next", cta: "Shop the chinos" },
    }, "how to style olive chinos")
    const vague = issues.filter((i) => i.check === "vague_headline").map((i) => i.item)
    assert.deepEqual(vague, [3, 4])
  })

  test("the cover's number is the real count of middle slides", () => {
    const three = { slides: [slide("5 ways to wear olive", "cover"), slide("Olive + white tee"), slide("Roll the hem once"), slide("Loafers, no socks")] }
    const claims = carouselSlideIssues(three, "how to style olive chinos").filter((i) => i.check === "unsupported_claim")
    assert.equal(claims.length, 1)
    assert.match(claims[0]!.fix_hint, /\b3\b/)
    const right = { slides: [slide("3 ways to wear olive", "cover"), slide("Olive + white tee"), slide("Roll the hem once"), slide("Loafers, no socks")] }
    assert.equal(carouselSlideIssues(right, "how to style olive chinos").filter((i) => i.check === "unsupported_claim").length, 0)
  })

  test("a number from the topic itself is fine", () => {
    const d = { slides: [slide("Crisp till 6pm", "cover"), slide("Steam it, don't iron"), slide("Size up once")] }
    assert.equal(carouselSlideIssues(d, "linen that stays crisp till 6pm").filter((i) => i.check === "unsupported_claim").length, 0)
  })

  const { mergeRepaired } = await import("@/lib/ai/quality-gate")
  test("a gate repair that returns only the changed fields keeps the rest", () => {
    const original = { slides: [{ headline: "Linen by noon", big_words: "Linen by noon" }, { headline: "Steam, don't iron", big_words: "Steam, don't iron", subtext: "Two minutes of steam beats a hot iron" }] }
    const repaired = { slides: [{}, { subtext: "Steam relaxes the fibres without pressing in creases", big_words: "", headline: null }] }
    const merged = mergeRepaired("carousel", original, repaired, new Set([1])) as typeof original
    assert.equal(merged.slides[1]!.big_words, "Steam, don't iron")
    assert.equal(merged.slides[1]!.subtext, "Steam relaxes the fibres without pressing in creases")
    assert.equal(merged.slides[0]!.big_words, "Linen by noon")
  })

  console.log(`\n${passed} passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
