// The provider-agnostic Instagram read layer (lib/social/instagram-source.ts)
// for direct (Meta) connections, against stubbed Graph responses: posts come
// back in the Zernio item shape, insights in Zernio's response shape,
// follower totals are rebuilt from daily gains, engagement matches by the
// published media id only, and tokens never leave the request.
//   npx tsx scripts/test-instagram-source.ts
import assert from "node:assert/strict"

let passed = 0
async function test(name: string, fn: () => Promise<void> | void) {
  await fn()
  passed++
  console.log(`ok - ${name}`)
}

const TOKEN = "IGAA-secret-token"
const calls: string[] = []
const logged: string[] = []
for (const k of ["log", "error"] as const) {
  const orig = console[k]
  console[k] = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); if (k === "log") orig(...args) }
}

globalThis.fetch = (async (input: string | URL) => {
  const url = new URL(String(input))
  calls.push(url.pathname + url.search)
  const p = url.pathname
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  if (p.endsWith("/ig1/media")) {
    return json({ data: [
      { id: "m1", caption: "Weekend sorted.", media_type: "IMAGE", media_product_type: "FEED", media_url: "https://cdn/m1.jpg", permalink: "https://instagram.com/p/m1", timestamp: "2026-11-03T10:00:00+0000", like_count: 12, comments_count: 3 },
      { id: "m2", caption: "Two looks", media_type: "CAROUSEL_ALBUM", media_product_type: "FEED", permalink: "https://instagram.com/p/m2", timestamp: "2026-11-01T10:00:00+0000", like_count: 5, comments_count: 0, children: { data: [{ id: "c1", media_type: "IMAGE", media_url: "https://cdn/c1.jpg" }, { id: "c2", media_type: "VIDEO", media_url: "https://cdn/c2.mp4" }] } },
    ] })
  }
  if (p.endsWith("/m1/insights")) return json({ data: [{ name: "reach", values: [{ value: 300 }] }, { name: "saved", values: [{ value: 4 }] }, { name: "shares", values: [{ value: 2 }] }, { name: "views", values: [{ value: 520 }] }] })
  // A metric set the media refuses: falls back to reach alone.
  if (p.endsWith("/m2/insights")) return url.searchParams.get("metric") === "reach" ? json({ data: [{ name: "reach", values: [{ value: 90 }] }] }) : json({ error: { message: "unsupported metric", code: 100 } }, 400)
  if (p.endsWith("/ig1/insights")) {
    const metric = url.searchParams.get("metric")
    if (metric === "reach") return json({ data: [{ name: "reach", period: "day", values: [{ value: 100, end_time: "2026-11-01T07:00:00+0000" }, { value: 150, end_time: "2026-11-02T07:00:00+0000" }] }] })
    if (metric === "follower_count") return json({ data: [{ name: "follower_count", period: "day", values: [{ value: 5, end_time: "2026-11-01T07:00:00+0000" }, { value: 3, end_time: "2026-11-02T07:00:00+0000" }, { value: 2, end_time: "2026-11-03T07:00:00+0000" }] }] })
    return json({ data: [{ name: "accounts_engaged", total_value: { value: 40 } }, { name: "total_interactions", total_value: { value: 61 } }] })
  }
  if (p.endsWith("/ig1") && url.searchParams.get("fields") === "followers_count") return json({ followers_count: 1010 })
  if (p.endsWith("/ig1/tags")) return json({ error: { message: "Unsupported get request", code: 100, access_token: TOKEN } }, 400)
  return json({ error: { message: `unexpected ${p}` } }, 404)
}) as typeof fetch

async function main() {
  const key = (await import("node:crypto")).randomBytes(32).toString("base64")
  process.env.SOCIAL_TOKEN_KEY = key
  const { encryptToken } = await import("@/lib/social/token-crypto")
  const src = await import("@/lib/social/instagram-source")
  const enc = encryptToken(TOKEN)
  assert.ok(enc.ok)

  const source = src.instagramSourceFor({ provider: "meta", ig_business_account_id: "ig1", access_token: enc.value, zernio_account_id: null })
  await test("a meta row reads Meta with the decrypted token; a zernio row stays Zernio", () => {
    assert.deepEqual(source, { kind: "meta", igUserId: "ig1", token: TOKEN })
    assert.deepEqual(src.instagramSourceFor({ provider: "zernio", ig_business_account_id: null, access_token: null, zernio_account_id: "z1" }), { kind: "zernio", accountId: "z1" })
    assert.deepEqual(src.instagramSourceFor({ ig_business_account_id: null, access_token: null, zernio_account_id: "z1" }), { kind: "zernio", accountId: "z1" })
    assert.equal(src.instagramSourceFor({ provider: "meta", ig_business_account_id: "ig1", access_token: "garbage", zernio_account_id: null }), null)
    assert.equal(src.instagramSourceFor({ provider: "zernio", ig_business_account_id: null, access_token: null, zernio_account_id: null }), null)
  })

  await test("posts come back in the Zernio item shape, with the media id and image URLs", async () => {
    const res = await src.listInstagramPosts(source!, 25)
    assert.ok(res.ok)
    const [m1, m2] = res.items
    assert.deepEqual(m1!.analytics, { likes: 12, comments: 3, reach: 300, saves: 4, shares: 2, impressions: 520 })
    assert.equal(m1!.content, "Weekend sorted.")
    assert.equal(m1!.platformPostUrl, "https://instagram.com/p/m1")
    assert.equal(m1!.igMediaId, "m1")
    assert.equal(m1!.mediaUrl, "https://cdn/m1.jpg")
    assert.equal(m2!.analytics!.reach, 90)
    assert.equal(m2!.analytics!.saves, undefined)
    assert.deepEqual(m2!.children, [{ mediaType: "IMAGE", mediaUrl: "https://cdn/c1.jpg" }, { mediaType: "VIDEO", mediaUrl: "https://cdn/c2.mp4" }])
  })

  await test("account insights land in the shapes instagram-insights.ts reads", async () => {
    const { getAccountInsights } = await import("@/lib/social/instagram-insights")
    const r = await getAccountInsights(source!)
    assert.ok(r.success)
    assert.deepEqual(r.data.reach, { available: true, value: { total: 250, series: [{ date: "2026-11-01", value: 100 }, { date: "2026-11-02", value: 150 }] }, note: null })
    assert.deepEqual(r.data.engagement, { available: true, value: { totalInteractions: 61, accountsEngaged: 40 }, note: null })
    // Daily gains 5, 3, 2 ending at today's 1010 -> totals 1005, 1008, 1010.
    assert.deepEqual(r.data.followerGrowth.value, { netChange: 5, series: [{ date: "2026-11-01", value: 1005 }, { date: "2026-11-02", value: 1008 }, { date: "2026-11-03", value: 1010 }] })
    assert.equal(r.data.media[0]!.id, "m1")
    assert.equal(r.data.media[0]!.media_url, "https://cdn/m1.jpg")
  })

  await test("engagement for a meta row matches by ig_media_id only -- never by caption", async () => {
    const { syncEngagementForBrand } = await import("@/lib/social/engagement-sync")
    const entries = [
      { id: "e1", caption_text: "something else entirely", updated_at: "2026-10-20T00:00:00Z", platform_specific_data: { ig_media_id: "m1" } },
      // Same caption and time as m2, but no media id: a Zernio-style guess must not happen.
      { id: "e2", caption_text: "Two looks", updated_at: "2026-11-01T10:00:00Z", platform_specific_data: {} },
    ]
    const upserts: Record<string, unknown>[] = []
    const chain = (result: unknown) => {
      const c: Record<string, unknown> = {}
      for (const m of ["select", "eq", "gte", "in"]) c[m] = () => c
      c.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res)
      c.upsert = (row: Record<string, unknown>) => { upserts.push(row); return Promise.resolve({ error: null }) }
      return c
    }
    const db = { from: (t: string) => chain(t === "calendar_entries" ? { data: entries, error: null } : { data: [], error: null }) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await syncEngagementForBrand(db as any, "b1", source!)
    assert.deepEqual(r, { matched: 1, refreshed: 0, unmatched: 1, errors: [] })
    assert.equal(upserts[0]!.calendar_entry_id, "e1")
    assert.equal(upserts[0]!.like_count, 12)
    assert.equal(upserts[0]!.saves, 4)
    assert.equal(upserts[0]!.impressions, 520)
  })

  await test("a refused /tags call is an error result, not a throw", async () => {
    const r = await src.instagramTaggedMedia(source as Extract<typeof source, { kind: "meta" }> & object)
    assert.equal(r.ok, false)
  })

  await test("the token never appears in a log line", () => {
    assert.ok(calls.some((c) => c.includes("access_token=")), "requests carry the token")
    assert.ok(logged.length > 0)
    for (const line of logged) assert.ok(!line.includes(TOKEN), `token logged: ${line.slice(0, 120)}`)
  })

  console.log(`\n${passed} passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
