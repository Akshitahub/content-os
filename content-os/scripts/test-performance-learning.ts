// The attribution maths behind learning from real results
// (lib/ai/performance-learning.ts), on fixture posts: saves and shares
// outweigh likes, performance is per account reached and relative to the
// brand's own median, and only a value with 4+ posts and a 25%+ gap
// becomes a lesson -- in plain words, with numbers counted from the posts.
//   npx tsx scripts/test-performance-learning.ts
import assert from "node:assert/strict"
import {
  attributeFindings, exploresThisSlot, findingRule, findingScope, relativePerformance, timeSlot, weightedEngagement,
  MIN_ITEMS, type PostedItem,
} from "@/lib/ai/performance-learning"

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`ok - ${name}`)
}

const post = (id: string, e: Partial<PostedItem>, attrs: PostedItem["attrs"] = {}): PostedItem => ({
  id, likes: 0, comments: 0, saves: 0, shares: 0, reach: null, attrs, ...e,
})

test("saves and shares weigh more than likes", () => {
  assert.ok(weightedEngagement({ likes: 0, comments: 0, saves: 10, shares: 0 }) > weightedEngagement({ likes: 25, comments: 0, saves: 0, shares: 0 }))
  assert.equal(weightedEngagement({ likes: 10, comments: 5, saves: 2, shares: 1 }), 10 + 10 + 6 + 3)
})

test("performance is relative to the brand's own median, per account reached", () => {
  // Same engagement, but b reached half as many accounts -> twice the performance.
  const rel = relativePerformance([
    post("a", { likes: 100, reach: 1000 }), post("b", { likes: 100, reach: 500 }), post("c", { likes: 100, reach: 1000 }),
  ])
  assert.equal(rel.get("a"), 1)
  assert.equal(rel.get("b"), 2)
  // Without reach on most items, raw scores are compared.
  const raw = relativePerformance([post("a", { likes: 10 }), post("b", { likes: 30 }), post("c", { likes: 20 }), post("d", { likes: 20, reach: 50 })])
  assert.equal(raw.get("b"), 1.5)
})

// 16 posts: the review card layout gets about twice the saves; reels and
// carousels the same; evenings slightly better (under 25% -- no lesson).
const fixture: PostedItem[] = [
  ...Array.from({ length: 5 }, (_, i) => post(`rc${i}`, { likes: 40, saves: 20, shares: 6, reach: 1000 }, { template: "review_card", format: "post", time_slot: i % 2 ? "evening" : "morning" })),
  ...Array.from({ length: 7 }, (_, i) => post(`bs${i}`, { likes: 40, saves: 6, shares: 2, reach: 1000 }, { template: "bold_statement", format: "post", time_slot: i % 2 ? "evening" : "morning" })),
  ...Array.from({ length: 2 }, (_, i) => post(`mn${i}`, { likes: 40, saves: 1, shares: 0, reach: 1000 }, { template: "minimal", format: "post", time_slot: "night" })),
  ...Array.from({ length: 2 }, (_, i) => post(`cr${i}`, { likes: 44, saves: 6, shares: 2, reach: 1000 }, { format: "carousel", time_slot: "evening" })),
]

test(`fixture has enough posts to learn (${MIN_ITEMS}+)`, () => {
  assert.ok(fixture.length >= MIN_ITEMS)
})

test("only a 4+ post value with a 25%+ gap becomes a lesson", () => {
  const findings = attributeFindings(fixture)
  const keys = findings.map((f) => `${f.attribute}:${f.value}:${f.kind}`)
  assert.ok(keys.includes("template:review_card:do"), keys.join(", "))
  // minimal is clearly worse but has only 2 posts -> no lesson.
  assert.ok(!keys.some((k) => k.startsWith("template:minimal")))
  // bold_statement is the brand's typical post -> no gap -> no lesson.
  assert.ok(!keys.some((k) => k.startsWith("template:bold_statement")))
  // A value every post shares (none here) or a small gap -> nothing for time slots.
  assert.ok(!keys.some((k) => k.startsWith("time_slot:")), keys.join(", "))
  const rc = findings.find((f) => f.value === "review_card")!
  assert.equal(rc.count, 5)
  assert.ok(rc.gap >= 0.25)
})

test("the lesson is plain words, its numbers counted from the posts", () => {
  const rc = attributeFindings(fixture).find((f) => f.value === "review_card")!
  const rule = findingRule(rc)
  assert.match(rule, /^Prefer the "review card" layout when it fits -- 5 of this brand's posts/)
  assert.match(rule, new RegExp(`${Math.round(rc.gap * 100)}% more saves, shares`))
  assert.equal(findingRule({ attribute: "photo_source", value: "ai", kind: "avoid", count: 6, gap: -0.4 }),
    "Use generated images less -- 6 of this brand's posts with generated images got 40% less saves, shares and engagement than its typical post.")
})

test("layouts reach the caption writer, hook types the hook writer, the rest are insights", () => {
  assert.equal(findingScope("template"), "caption")
  assert.equal(findingScope("hook_type"), "hook")
  assert.equal(findingScope("time_slot"), "insight")
})

test("about 70% of slots lean on what works, 30% explore", () => {
  const explored = Array.from({ length: 30 }, (_, i) => exploresThisSlot(i)).filter(Boolean).length
  assert.equal(explored, 9)
})

test("time slots are IST", () => {
  assert.equal(timeSlot("19:30", null), "evening")
  // 03:00 UTC = 08:30 IST.
  assert.equal(timeSlot(null, "2026-10-01T03:00:00Z"), "morning")
  assert.equal(timeSlot(null, null), null)
})

console.log(`\n${passed} passed`)
