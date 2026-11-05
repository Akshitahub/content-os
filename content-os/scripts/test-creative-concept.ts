// Checks lib/ai/creative-concept.ts without a real model call: parsing
// (clamped self-scores, word caps, malformed concepts dropped), the weighted
// pick, and that the writer carries the concept as its creative core.
//   npx tsx scripts/test-creative-concept.ts
import assert from "node:assert/strict"

let passed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`ok - ${name}`)
}

async function main() {
  process.env.GROQ_API_KEY ||= "test-key"
  const { parseConcepts, pickConcept } = await import("@/lib/ai/creative-concept")
  const { CRITIC_CRITERIA } = await import("@/lib/design/critic-scores")
  const scores = (n: number) => Object.fromEntries(CRITIC_CRITERIA.map((c) => [c.id, n]))

  await test("parses concepts, clamps scores, caps words, drops malformed ones", () => {
    const raw = JSON.stringify({ concepts: [
      { story: Array(60).fill("word").join(" "), hook: "a hook", emotion: "curiosity", device: "Reveal", self_scores: { ...scores(7), craft: 14 } },
      { hook: "no story" },
      { story: "A mother catches her toddler mid-spill and laughs", hook: "h", emotion: "recognition", device: "relatable moment", self_scores: scores(9) },
    ] })
    const concepts = parseConcepts(raw)
    assert.equal(concepts.length, 2)
    assert.equal(concepts[0]!.story.split(" ").length, 40)
    assert.equal(concepts[0]!.self_scores.craft, 10)
    assert.equal(concepts[0]!.device, "reveal")
    assert.equal(parseConcepts("not json").length, 0)
  })

  await test("picks the highest weighted self-score", () => {
    const concepts = parseConcepts(JSON.stringify({ concepts: [
      { story: "a", self_scores: scores(6) },
      { story: "b", self_scores: scores(8) },
      { story: "c", self_scores: scores(7) },
    ] }))
    assert.equal(pickConcept(concepts)?.story, "b")
    assert.equal(pickConcept([]), null)
  })

  await test("missing self-scores default to 5", () => {
    const [c] = parseConcepts(JSON.stringify({ concepts: [{ story: "x" }] }))
    assert.equal(c!.score, 5)
  })

  console.log(`\n${passed} passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
