// Checks lib/ai/copy-quality.ts without a real model call: score parsing,
// the rewrite guard (content-quality cleanup, no new numbers), and the pass
// itself on stubbed Groq calls (below 8 -> one rewrite, the better kept).
//   npx tsx scripts/test-copy-quality.ts
import assert from "node:assert/strict"

let passed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`ok - ${name}`)
}

async function main() {
  process.env.GROQ_API_KEY ||= "test-key"
  const { parseCopyScore, acceptRewrite, copyQualityPass, COPY_CRITERIA } = await import("@/lib/ai/copy-quality")
  const { MODELS, getTextClientFor } = await import("@/lib/ai/models")
  const scores = (n: number) => Object.fromEntries(COPY_CRITERIA.map((c) => [c.id, n]))

  await test("parses the score: the average of the five, with reasons; incomplete = null", () => {
    assert.deepEqual(parseCopyScore(JSON.stringify({ scores: { ...scores(8), sounds_human: 3 }, reasons: ["reads like AI"] })), { overall: 7, reasons: ["reads like AI"] })
    assert.equal(parseCopyScore(JSON.stringify({ scores: { stops_scroll: 9 } })), null)
    assert.equal(parseCopyScore("nope"), null)
  })

  await test("the rewrite guard: same keys, cleaned, never a new number", () => {
    assert.deepEqual(acceptRewrite({ caption_text: "Our chai, 250g" }, JSON.stringify({ caption_text: "Our chai ✓ in a 250g tin" })), { caption_text: "Our chai  in a 250g tin".replace("  ", " ") })
    assert.equal(acceptRewrite({ caption_text: "Our chai" }, JSON.stringify({ caption_text: "Our chai, now 20% off" })), null)
    assert.equal(acceptRewrite({ headline: "a", primary_text: "b" }, JSON.stringify({ headline: "a2" })), null)
  })

  const client = getTextClientFor(MODELS.scoring)
  const create = client.chat.completions.create
  const brand = { id: "b", name: "Chai Co", niche: "tea", description: "Masala chai", tone_of_voice: "warm" } as never
  const stub = (replies: unknown[]) => {
    const queue = [...replies]
    ;(client.chat.completions as unknown as { create: unknown }).create = async () => ({ choices: [{ message: { content: JSON.stringify(queue.shift()) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
  }
  const apply = (c: { caption_text: string }, f: Record<string, string>) => ({ ...c, caption_text: f.caption_text ?? c.caption_text })

  await test("8+ -> kept as is, no rewrite", async () => {
    stub([{ scores: scores(9) }])
    const r = await copyQualityPass({ brand, kind: "caption", item: { caption_text: "Good" }, fields: { caption_text: "Good" }, apply, label: "t" })
    assert.equal(r.rewritten, false)
    assert.equal(r.score, 9)
  })

  await test("below 8 -> one rewrite; a better-scoring rewrite is kept, a worse one isn't", async () => {
    stub([{ scores: scores(6), reasons: ["weak first line"] }, { caption_text: "Better" }, { scores: scores(8) }])
    const better = await copyQualityPass({ brand, kind: "caption", item: { caption_text: "Meh" }, fields: { caption_text: "Meh" }, apply, label: "t" })
    assert.equal(better.item.caption_text, "Better")
    stub([{ scores: scores(6) }, { caption_text: "Worse" }, { scores: scores(5) }])
    const worse = await copyQualityPass({ brand, kind: "caption", item: { caption_text: "Meh" }, fields: { caption_text: "Meh" }, apply, label: "t" })
    assert.equal(worse.item.caption_text, "Meh")
  })

  await test("a failing scorer keeps the original", async () => {
    ;(client.chat.completions as unknown as { create: unknown }).create = async () => { throw new Error("down") }
    const r = await copyQualityPass({ brand, kind: "caption", item: { caption_text: "Meh" }, fields: { caption_text: "Meh" }, apply, label: "t" })
    assert.equal(r.item.caption_text, "Meh")
  })
  ;(client.chat.completions as unknown as { create: unknown }).create = create

  console.log(`\n${passed} passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
