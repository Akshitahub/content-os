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

  await test("in-scene text: only for a text device, <= 6 words, never a handle or URL", async () => {
    const one = (c: Record<string, unknown>, allow = true) => parseConcepts(JSON.stringify({ concepts: [{ story: "s", ...c }] }), allow)[0]!.in_scene_text
    assert.equal(one({ device: "in-scene text", in_scene_text: "Out for chai, back at 5" }), "Out for chai, back at 5")
    assert.equal(one({ device: "direct address", in_scene_text: "Hi, you." }), "Hi, you.")
    assert.equal(one({ device: "reveal", in_scene_text: "Surprise" }), null)
    assert.equal(one({ device: "in-scene text", in_scene_text: "one two three four five six seven" }), null)
    assert.equal(one({ device: "in-scene text", in_scene_text: "follow @brand" }), null)
    assert.equal(one({ device: "in-scene text", in_scene_text: "Sale" }, false), null)
    const { inSceneTextMatches } = await import("@/lib/ai/in-scene-text")
    assert.ok(inSceneTextMatches("Out for chai, back at 5", "OUT FOR CHAI back at 5!"))
    assert.ok(inSceneTextMatches("Hi you", "Mug says: hi, you. 250ml"))
    assert.ok(!inSceneTextMatches("Out for chai", "Out for chia"))
    assert.ok(!inSceneTextMatches("Hi", null))
  })

  await test("the text bans come off only for in-scene text; watermarks, handles, URLs and fake UI stay", async () => {
    const { withoutTextBans, POST_IMAGE_QUALITY_AND_NEGATIVE_GUARD, EDITORIAL_QUALITY_GUARD } = await import("@/lib/ai/post-image-pipeline")
    const relaxed = withoutTextBans(POST_IMAGE_QUALITY_AND_NEGATIVE_GUARD)
    assert.doesNotMatch(relaxed, /\bno text\b|illegible text/)
    for (const kept of ["no watermarks", "no usernames or @handles", "no URLs", "no fake app interface"]) assert.ok(relaxed.includes(kept), kept)
    assert.doesNotMatch(withoutTextBans(EDITORIAL_QUALITY_GUARD), /no text|no letters/)
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
