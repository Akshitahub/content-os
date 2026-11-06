// Stored-token encryption (lib/social/token-crypto.ts): a token comes back
// as it went in, a changed byte or the wrong key fails, and a missing or
// malformed key is an error, not a throw.
//   npx tsx scripts/test-token-crypto.ts
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { decryptToken, encryptToken } from "@/lib/social/token-crypto"

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`ok - ${name}`)
}

const key = randomBytes(32).toString("base64")
const otherKey = randomBytes(32).toString("base64")
const token = "IGAAT-example-long-lived-token_" + "x".repeat(180)

function encrypted(t = token, k = key): string {
  const r = encryptToken(t, k)
  assert.ok(r.ok, r.ok ? "" : r.error)
  return r.value
}

test("round trip: the token comes back unchanged", () => {
  const stored = encrypted()
  assert.match(stored, /^v1:[^:]+:[^:]+:[^:]+$/)
  assert.ok(!stored.includes(token))
  assert.deepEqual(decryptToken(stored, key), { ok: true, value: token })
  assert.deepEqual(decryptToken(encrypted("ünïcødé ✓"), key), { ok: true, value: "ünïcødé ✓" })
})

test("a fresh IV every time: the same token encrypts differently", () => {
  assert.notEqual(encrypted(), encrypted())
})

test("tampering is detected: ciphertext, tag or IV", () => {
  const [v, iv, tag, ct] = encrypted().split(":") as [string, string, string, string]
  const flip = (b64: string) => {
    const b = Buffer.from(b64, "base64")
    b[0] = b[0]! ^ 1
    return b.toString("base64")
  }
  for (const bad of [[v, iv, tag, flip(ct)], [v, iv, flip(tag), ct], [v, flip(iv), tag, ct]]) {
    const r = decryptToken(bad.join(":"), key)
    assert.equal(r.ok, false)
  }
  assert.equal(decryptToken(`v2:${iv}:${tag}:${ct}`, key).ok, false)
  assert.equal(decryptToken("plain-token", key).ok, false)
})

test("the wrong key fails", () => {
  const r = decryptToken(encrypted(), otherKey)
  assert.equal(r.ok, false)
  assert.ok(!r.ok && !r.error.includes(token))
})

test("a missing or malformed key is an error, not a throw", () => {
  const saved = process.env.SOCIAL_TOKEN_KEY
  delete process.env.SOCIAL_TOKEN_KEY
  assert.equal(encryptToken(token).ok, false)
  assert.equal(decryptToken(encrypted(), undefined).ok, false)
  assert.equal(encryptToken(token, Buffer.alloc(16).toString("base64")).ok, false)
  process.env.SOCIAL_TOKEN_KEY = key
  assert.deepEqual(decryptToken(encrypted(), undefined), { ok: true, value: token })
  if (saved === undefined) delete process.env.SOCIAL_TOKEN_KEY
  else process.env.SOCIAL_TOKEN_KEY = saved
})

console.log(`\n${passed} passed`)
