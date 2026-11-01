// Customer photos (UGC, migration 069): never picked until the creator said
// yes; with preferUgc a granted one leads; the caption credits the creator;
// the repost DM follows the brand's voice and promises nothing.
//   npx tsx scripts/test-ugc.ts
import assert from "node:assert/strict"
import type { BrandPhoto } from "@/lib/brand-photos"

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`ok - ${name}`)
}

const photo = (id: string, over: Partial<BrandPhoto> = {}): BrandPhoto => ({
  id, brand_id: "b", url: `https://x/${id}.jpg`, kind: "person", quality_ok: true, product_id: null, source: "upload",
  published_at: null, use_count: 0, last_used_at: null, description: "a person", ...over,
})

async function main() {
  const { rankPhotoCandidates } = await import("@/lib/brand-photos")
  const { withPhotoCredit } = await import("@/lib/photo-credit")
  const { repostRequestDm } = await import("@/lib/ugc-dm")
  const rows = [
    photo("own"),
    photo("asked", { source: "ugc", creator_handle: "riya", rights_status: "requested" }),
    photo("no", { source: "ugc", creator_handle: "sam", rights_status: "declined" }),
    photo("yes", { source: "ugc", creator_handle: "kabir", rights_status: "granted", use_count: 3 }),
  ]

  test("only granted customer photos are ever candidates", () => {
    const ids = rankPhotoCandidates(rows, { kinds: ["person"] }).map((p) => p.id)
    assert.deepEqual(ids.sort(), ["own", "yes"])
  })
  test("preferUgc puts a granted customer photo first", () => {
    assert.equal(rankPhotoCandidates(rows, { kinds: ["person"] })[0]!.id, "own")
    assert.equal(rankPhotoCandidates(rows, { kinds: ["person"], preferUgc: true })[0]!.id, "yes")
  })
  test("the caption credits the creator once; the brand's own photo adds nothing", () => {
    const once = withPhotoCredit("Weekend sorted.", rows[3])
    assert.equal(once, "Weekend sorted.\n\n📸 @kabir")
    assert.equal(withPhotoCredit(once, rows[3]), once)
    assert.equal(withPhotoCredit("Weekend sorted.", rows[0]), "Weekend sorted.")
  })
  test("the DM is Hinglish for a Hinglish voice, English otherwise, with no offer", () => {
    const hi = repostRequestDm({ name: "SNITCH", tone_of_voice: "Casual Hinglish, yaar-style" }, "@kabir")
    const en = repostRequestDm({ name: "SNITCH", tone_of_voice: "Confident and clean" }, "kabir")
    assert.match(hi, /Kya hum/)
    assert.match(en, /Could we repost/)
    for (const dm of [hi, en]) {
      assert.match(dm, /📸 @kabir/)
      assert.doesNotMatch(dm, /\d+%|discount|free|₹|offer/i)
    }
  })
  console.log(`\n${passed} passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
