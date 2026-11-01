// Learning from the client's edits (lib/ai/edit-learning.ts), on fixture
// edits and an in-memory database: touch-ups are dropped, real rewrites are
// kept, every 5 of them make ONE decision (the model call stubbed) that
// lands as an 'edits' lesson through applyLessonDecision, and the prompt
// shows the before / after pairs.
//   npx tsx scripts/test-edit-learning.ts
import assert from "node:assert/strict"
import { changeRatio, distillPendingEdits, editsDistillInput, isMeaningfulEdit, recordContentEdits, slideTextEdits, EDITS_PER_LESSON } from "@/lib/ai/edit-learning"
import { buildDistillPrompt, type DistillInput, type LessonDecision } from "@/lib/ai/brand-brain"

// No real model call here: recordContentEdits' own distil attempt fails
// fast without keys, and the tests pass a stub where it matters.
delete process.env.GROQ_API_KEY
delete process.env.OPENAI_API_KEY

let passed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`ok - ${name}`)
}

// ─── A tiny in-memory Supabase: just the calls edit-learning makes. ───────
type Row = Record<string, unknown>
function fakeDb() {
  const tables: Record<string, Row[]> = { content_edits: [], brand_lessons: [] }
  let seq = 0
  function from(name: string) {
    const rows = (tables[name] ??= [])
    const filters: ((r: Row) => boolean)[] = []
    let op: "select" | "update" | "insert" = "select"
    let patch: Row = {}
    let limit = Infinity
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
      is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), q),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), q),
      order: () => q,
      limit: (n: number) => ((limit = n), q),
      update: (p: Row) => ((op = "update"), (patch = p), q),
      insert: (r: Row | Row[]) => {
        for (const row of Array.isArray(r) ? r : [r]) rows.push({ id: `id${++seq}`, created_at: seq, ...row })
        return Promise.resolve({ data: null, error: null })
      },
      then: (resolve: (v: { data: Row[]; error: null }) => void) => {
        const hit = rows.filter((r) => filters.every((f) => f(r))).slice(0, limit)
        if (op === "update") for (const r of hit) Object.assign(r, patch)
        resolve({ data: hit.map((r) => ({ ...r })), error: null })
      },
    }
    return q
  }
  return { tables, from }
}

const edit = (before: string, after: string) => ({ brandId: "b1", userId: "u1", surface: "calendar" as const, field: "caption" as const, before, after })

// Fixture: the owner keeps cutting the emoji-heavy opener and adding a question.
const REWRITES = [
  ["🔥🔥 Big news!! Our linen shirts are here. Shop now.", "Linen that stays crisp till 6pm. Which colour are you picking?"],
  ["✨✨ Amazing chinos for every mood ✨ Grab yours!", "Olive chinos, three ways. Which one is you?"],
  ["😍😍 You NEED this tote in your life!!!", "A tote that fits a laptop and lunch. What would you carry?"],
  ["🚀 Level up your wardrobe today with our tees 🚀", "Heavyweight tees that keep their shape. Tried one yet?"],
  ["💯💯 Best sneakers ever, trust us!!", "White sneakers that go with everything. Your go-to pair?"],
] as const

async function main() {
  await test("a touch-up is not a rewrite; a real rewrite is", () => {
    assert.ok(changeRatio("Linen that stays crisp.", "Linen that stays crisp!") < 0.15)
    assert.ok(!isMeaningfulEdit("Shop the linen edit now", "Shop the linen edit now!"))
    assert.ok(isMeaningfulEdit(REWRITES[0][0], REWRITES[0][1]))
    assert.equal(changeRatio("a b c d", "a b c d"), 0)
    assert.equal(changeRatio("a b", "c d"), 1)
  })

  await test("slide saves yield only the headlines that changed", () => {
    const before = [{ headline: "Style it", image_url: "x" }, { headline: "Roll the hem" }, { big_words: "Shop" }]
    const after = [{ headline: "Olive + white tee", image_url: "y" }, { headline: "Roll the hem" }, { big_words: "Shop the chinos" }]
    assert.deepEqual(slideTextEdits(before, after), [{ before: "Style it", after: "Olive + white tee" }, { before: "Shop", after: "Shop the chinos" }])
  })

  await test("the distill prompt shows the before / after pairs and asks for a shared pattern", () => {
    const input = editsDistillInput("b1", REWRITES.slice(0, 2).map(([b, a]) => ({ field: "caption" as const, before_text: b, after_text: a })))
    const prompt = buildDistillPrompt(input, [])
    assert.match(prompt, /rewrote these 2 AI-written items/)
    assert.match(prompt, /BEFORE: """🔥🔥 Big news/)
    assert.match(prompt, /AFTER: {2}"""Linen that stays crisp/)
    assert.match(prompt, /seen in at least 2 of them/)
    assert.equal(input.scope, "caption")
  })

  await test(`every ${EDITS_PER_LESSON} real rewrites make one 'edits' lesson; touch-ups never count`, async () => {
    const db = fakeDb()
    const calls: DistillInput[] = []
    const decide = async (_db: unknown, input: DistillInput) => {
      calls.push(input)
      const decision: LessonDecision = { action: "create", kind: "avoid", rule: "Skip stacked emojis and hype openers; open with the product's concrete benefit and end on a question.", scope: "caption" }
      return { decision, existing: [] }
    }
    // A touch-up and four rewrites: stored 4, not enough yet.
    assert.equal(await recordContentEdits(db, [edit("Shop the linen edit now", "Shop the linen edit now!")]), 0)
    for (const [b, a] of REWRITES.slice(0, 4)) await recordContentEdits(db, [edit(b, a)])
    assert.equal(db.tables.content_edits!.length, 4)
    assert.equal(await distillPendingEdits(db, "b1", decide), "waiting")
    // The fifth: one decision, one lesson, all five marked used.
    await recordContentEdits(db, [edit(REWRITES[4][0], REWRITES[4][1])])
    assert.equal(await distillPendingEdits(db, "b1", decide), "distilled")
    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.edits!.length, 5)
    const lessons = db.tables.brand_lessons!
    assert.equal(lessons.length, 1)
    assert.equal(lessons[0]!.source, "edits")
    assert.equal(lessons[0]!.kind, "avoid")
    assert.ok(db.tables.content_edits!.every((e) => e.distilled_at))
    // Nothing pending -> no second call.
    assert.equal(await distillPendingEdits(db, "b1", decide), "waiting")
    assert.equal(calls.length, 1)
  })

  await test("a failed model call releases the edits for the next try", async () => {
    const db = fakeDb()
    for (const [b, a] of REWRITES) await recordContentEdits(db, [edit(b, a)])
    // recordContentEdits already tried with the real model (no key here -> failed) -- reset.
    for (const e of db.tables.content_edits!) e.distilled_at = null
    assert.equal(await distillPendingEdits(db, "b1", async () => null), "failed")
    assert.ok(db.tables.content_edits!.every((e) => !e.distilled_at))
  })

  console.log(`\n${passed} passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
