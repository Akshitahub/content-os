// Checks lib/ai/creative-concept.ts without a real model call: parsing, the
// scorer's weighted pick, the prompt review, and the whole stage (2 rounds,
// write -> review -> one rewrite) on stubbed Groq calls.
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
  const { parseConcepts, pickConcept, applyConceptScores, parsePromptReview, conceptImagePrompt } = await import("@/lib/ai/creative-concept")
  const { MODELS, getTextClientFor } = await import("@/lib/ai/models")
  const { CRITIC_CRITERIA } = await import("@/lib/design/critic-scores")
  const scores = (n: number) => Object.fromEntries(CRITIC_CRITERIA.map((c) => [c.id, n]))

  await test("parses concepts, caps words, drops malformed ones (unscored until the scorer runs)", () => {
    const raw = JSON.stringify({ concepts: [
      { story: Array(60).fill("word").join(" "), hook: "a hook", emotion: "curiosity", device: "Reveal" },
      { hook: "no story" },
      { story: "A mother catches her toddler mid-spill and laughs", hook: "h", emotion: "recognition", device: "relatable moment" },
    ] })
    const concepts = parseConcepts(raw)
    assert.equal(concepts.length, 2)
    assert.equal(concepts[0]!.story.split(" ").length, 40)
    assert.equal(concepts[0]!.device, "reveal")
    assert.equal(concepts[0]!.score, 5)
    assert.equal(parseConcepts("not json").length, 0)
  })

  await test("the scorer's JSON sets scores, the weighted prediction and reasons; the best is picked", () => {
    const concepts = parseConcepts(JSON.stringify({ concepts: [{ story: "a" }, { story: "b" }, { story: "c" }] }))
    const scored = applyConceptScores(concepts, JSON.stringify({ concepts: [
      { index: 1, scores: scores(6), reasons: ["static"] },
      { index: 2, scores: { ...scores(8), craft: 14 }, reasons: [] },
      { index: 3, scores: scores(7) },
    ] }))
    assert.equal(scored[1]!.scores.craft, 10)
    assert.deepEqual(scored[0]!.reasons, ["static"])
    assert.equal(pickConcept(scored)?.story, "b")
    assert.equal(pickConcept([]), null)
    // Unreadable scorer output leaves them unscored, never throws.
    assert.equal(applyConceptScores(concepts, "nope")[0]!.score, 5)
  })

  await test("the prompt review: pass / fail with problems; unreadable never blocks", () => {
    assert.deepEqual(parsePromptReview(JSON.stringify({ pass: false, problems: ["two subjects"] })), { pass: false, problems: ["two subjects"] })
    assert.equal(parsePromptReview(JSON.stringify({ pass: true })).pass, true)
    assert.equal(parsePromptReview("garbage").pass, true)
  })

  // The stage end to end on stubbed Groq calls: 2 rounds, then write -> review -> rewrite.
  const client = getTextClientFor(MODELS.creative)
  const create = client.chat.completions.create
  const calls: string[] = []
  const brand = { id: "b", name: "Chai Co", niche: "tea", description: "Masala chai blends", tone_of_voice: "warm" } as never
  await test("best below 8 -> a second round with the scorer's reasons; then the prompt is reviewed and rewritten once", async () => {
    let round = 0
    let writes = 0
    ;(client.chat.completions as unknown as { create: unknown }).create = async (req: { stage?: string; stream?: boolean; messages: { role: string; content: string }[] }) => {
      const system = req.messages[0]!.content
      const user = req.messages[1]!.content
      if (req.stream) {
        writes++
        calls.push(`write${/rejected the last draft/.test(user) ? "-rewrite" : ""}`)
        const text = writes === 1 ? "a generic product on a table" : "a grandmother pouring chai mid-laugh"
        return (async function* () { yield { choices: [{ delta: { content: text } }] } })()
      }
      const reply = (content: unknown) => ({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
      if (/You review an image-generation prompt/.test(system)) {
        calls.push("review")
        return reply({ pass: false, problems: ["nothing is happening"] })
      }
      if (/scoring IDEAS/.test(system)) {
        calls.push("score")
        const n = round === 1 ? 6 : 9
        return reply({ concepts: [1, 2, 3].map((index) => ({ index, scores: scores(index === 2 ? n : n - 1), reasons: ["too static"] })) })
      }
      round++
      calls.push(`concepts${/fell short/.test(user) ? "-with-feedback" : ""}`)
      return reply({ concepts: [1, 2, 3].map((i) => ({ story: `round ${round} idea ${i}`, hook: "h", emotion: "joy", device: "mid-action" })) })
    }
    const r = await conceptImagePrompt({ brand, input: { hook: "Chai that tastes like home", format: "post" }, flow: "post", label: "test" })
    assert.equal(r?.concept.story, "round 2 idea 2")
    assert.equal(r?.concept.score, 9)
    assert.equal(r?.prompt, "a grandmother pouring chai mid-laugh")
    assert.deepEqual(calls, ["concepts", "score", "concepts-with-feedback", "score", "write", "review", "write-rewrite"])
  })
  ;(client.chat.completions as unknown as { create: unknown }).create = create

  await test("in-scene text: only for a text device, <= 5 plain words, never a handle or URL", async () => {
    const one = (c: Record<string, unknown>, allow = true) => parseConcepts(JSON.stringify({ concepts: [{ story: "s", ...c }] }), allow)[0]!.in_scene_text
    assert.equal(one({ device: "in-scene text", in_scene_text: "Out for chai, back soon" }), "Out for chai, back soon")
    assert.equal(one({ device: "in-scene text", in_scene_text: "Out for chai, back at 5" }), null)
    assert.equal(one({ device: "in-scene text", in_scene_text: "Supercalifragilistic tea" }), null)
    assert.equal(one({ device: "direct address", in_scene_text: "Hi, you." }), "Hi, you.")
    assert.equal(one({ device: "reveal", in_scene_text: "Surprise" }), null)
    assert.equal(one({ device: "in-scene text", in_scene_text: "one two three four five six" }), null)
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

  console.log(`\n${passed} passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
