// The phone-photos link (lib/photo-link-token.ts): it names one brand, can't
// be altered to name another, and stops working after 7 days.
//   npx tsx scripts/test-photo-link-token.ts
import assert from "node:assert/strict"

process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-key"

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`ok - ${name}`)
}

async function main() {
  const { createPhotoLinkToken, verifyPhotoLinkToken, PHOTO_LINK_DAYS } = await import("@/lib/photo-link-token")
  const brand = "a4e3270a-0284-4122-bbe0-46fd1be3ff6a"
  const other = "130d6580-f9f8-48f1-9b02-afbe33aae7b6"
  const now = Date.UTC(2026, 10, 1)
  const { token } = createPhotoLinkToken(brand, now)

  test("a fresh link names its brand", () => {
    assert.equal(verifyPhotoLinkToken(token, now)?.brandId, brand)
  })
  test("swapping in another brand's id breaks it", () => {
    assert.equal(verifyPhotoLinkToken(token.replace(brand, other), now), null)
    assert.equal(verifyPhotoLinkToken(`${token}x`, now), null)
    assert.equal(verifyPhotoLinkToken("nonsense", now), null)
  })
  test(`it works for ${PHOTO_LINK_DAYS} days, then stops`, () => {
    assert.ok(verifyPhotoLinkToken(token, now + (PHOTO_LINK_DAYS * 86_400 - 60) * 1000))
    assert.equal(verifyPhotoLinkToken(token, now + (PHOTO_LINK_DAYS * 86_400 + 60) * 1000), null)
  })
  test("two links get separate photo counts", () => {
    const second = createPhotoLinkToken(brand, now + 1000).token
    assert.notEqual(verifyPhotoLinkToken(token, now)!.linkId, verifyPhotoLinkToken(second, now)!.linkId)
  })
  console.log(`\n${passed} passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
