// Checks the critic (lib/ai/critic.ts + lib/design/critic-scores.ts) without
// a real vision call: the weighted overall and its cap, parsing, the saved
// verdict, calibration loading, and critiquePost against a simulated
// response (and a failing one -> null, so callers behave as before).
//   npx tsx scripts/test-critic.ts
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import type { BrandRow } from "@/types/database"

let passed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`ok - ${name}`)
}

const all = (n: number, over: Record<string, number> = {}) => Object.fromEntries(
  ["stops_scroll", "speaks_to_buyer", "one_message", "image_copy_agree", "craft", "real_indian", "reason_to_act"].map((id) => [id, { score: over[id] ?? n, reason: `${id} reason` }]),
) as never

async function main() {
  process.env.OPENAI_API_KEY ||= "test-key"
  const { criticOverall, toSavedCritic, CRITIC_PASS } = await import("@/lib/design/critic-scores")
  const { parseCriticResponse, loadReferencePosts, critiquePost, buildCriticPrompt } = await import("@/lib/ai/critic")
  const { getOpenAIClient } = await import("@/lib/ai/models")

  await test("overall is the weighted average", () => {
    assert.equal(criticOverall(all(8)), 8)
    // stops_scroll weighs 2 of 9.5: 10 there and 6 elsewhere = (20 + 6*7.5) / 9.5 = 6.8
    assert.equal(criticOverall(all(6, { stops_scroll: 10 })), 6.8)
  })

  await test("a failing image/copy agreement or craft caps the overall at 6", () => {
    assert.equal(criticOverall(all(9, { image_copy_agree: 4 })), 6)
    assert.equal(criticOverall(all(9, { craft: 3 })), 6)
    assert.equal(criticOverall(all(9, { real_indian: 3 })) > 6, true)
  })

  await test("parses scores, clamps to 1-10, rejects a missing criterion", () => {
    const ok = parseCriticResponse(JSON.stringify({ scores: all(7, { craft: 14 }), top_fix: "Bigger words" }))
    assert.equal(ok?.scores.craft.score, 10)
    assert.equal(ok?.top_fix, "Bigger words")
    const missing = JSON.parse(JSON.stringify({ scores: all(7) })) as { scores: Record<string, unknown> }
    delete missing.scores.craft
    assert.equal(parseCriticResponse(JSON.stringify(missing)), null)
    assert.equal(parseCriticResponse("not json"), null)
    // No top_fix -> the weakest criterion's reason.
    assert.match(parseCriticResponse(JSON.stringify({ scores: all(7, { reason_to_act: 3 }) }))!.top_fix, /Reason to act/)
  })

  await test("saved verdict: needs approval below the bar, worst reasons first", () => {
    const saved = toSavedCritic({ scores: all(9, { craft: 4, reason_to_act: 6 }), overall: 6, top_fix: "Fix the crop" }, { candidates: 3, regenerated: true })
    assert.equal(saved.needs_approval, true)
    assert.match(saved.reasons[0]!, /^Craft 4\/10/)
    assert.match(saved.reasons[1]!, /^Reason to act 6\/10/)
    assert.equal(saved.reasons.length, 2)
    assert.equal(toSavedCritic({ scores: all(CRITIC_PASS), overall: CRITIC_PASS, top_fix: "" }).needs_approval, false)
  })

  await test("calibration: up to 3 examples with an image and scores", () => {
    const dir = mkdtempSync(join(tmpdir(), "refs-"))
    writeFileSync(join(dir, "a.jpg"), Buffer.from([0xff, 0xd8, 0xff]))
    for (const n of ["a", "b", "c", "d"]) writeFileSync(join(dir, `${n}.json`), JSON.stringify({ image: n === "a" ? "a.jpg" : "https://example.com/x.jpg", hook: n, scores: { craft: 7 } }))
    writeFileSync(join(dir, "e.json"), JSON.stringify({ hook: "no image" }))
    const refs = loadReferencePosts(dir)
    assert.equal(refs.length, 3)
    assert.match(refs[0]!.imageUrl, /^data:image\/jpeg;base64,/)
    assert.equal(loadReferencePosts(join(dir, "missing")).length, 0)
  })

  const brand = { id: "b", name: "SNITCH", niche: "menswear", description: "Fashion for young Indian men", tone_of_voice: "bold" } as unknown as BrandRow
  await test("the prompt names every criterion", () => {
    const prompt = buildCriticPrompt(brand, "post")
    for (const id of ["stops_scroll", "speaks_to_buyer", "one_message", "image_copy_agree", "craft", "real_indian", "reason_to_act"]) assert.ok(prompt.includes(`"${id}"`), id)
  })

  const client = getOpenAIClient()
  const create = client.chat.completions.create
  await test("critiquePost on a simulated vision response", async () => {
    let sentImage = ""
    ;(client.chat.completions as unknown as { create: unknown }).create = async (req: { messages: { content: unknown }[] }) => {
      const parts = req.messages[1]!.content as { type: string; image_url?: { url: string } }[]
      sentImage = parts.find((p) => p.type === "image_url")?.image_url?.url ?? ""
      return { choices: [{ message: { content: JSON.stringify({ scores: all(7, { stops_scroll: 9 }), top_fix: "Show the chinos worn outdoors" }) } }], usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 } }
    }
    const r = await critiquePost(brand, { imageUrl: "https://example.com/post.jpg", caption: "c", hook: "h", format: "post" }, "test")
    assert.equal(sentImage, "https://example.com/post.jpg")
    assert.equal(r?.overall, criticOverall(all(7, { stops_scroll: 9 })))
    assert.equal(r?.passed, false)
    assert.equal(r?.top_fix, "Show the chinos worn outdoors")
  })

  await test("critiquePost returns null when the call fails (no credits)", async () => {
    ;(client.chat.completions as unknown as { create: unknown }).create = async () => { throw Object.assign(new Error("429 insufficient_quota"), { status: 429 }) }
    assert.equal(await critiquePost(brand, { imageUrl: "https://example.com/p.jpg", caption: "", hook: "", format: "post" }, "test"), null)
  })
  ;(client.chat.completions as unknown as { create: unknown }).create = create

  console.log(`\n${passed} passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
