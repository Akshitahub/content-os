// Dev-only, fully offline check of lib/ai/fact-guard.ts's allow/deny
// rules -- no model calls, no network, no database. Run manually:
// `npx tsx scripts/test-fact-guard.ts`. Exits non-zero if any case fails.
//
// NOT reachable in production: a standalone script, never served by
// Next.js. The NODE_ENV guard is defense-in-depth only, same as
// scripts/test-creative-stages.ts.
import { buildFactSource, findUnsupportedClaims, guardCopy, stripUnsupportedClaims, factRetryTimeoutMs } from "@/lib/ai/fact-guard"

if (process.env.NODE_ENV === "production") {
  console.error("[test-fact-guard] refusing to run with NODE_ENV=production -- this is a dev-only check.")
  process.exit(1)
}

const facts = buildFactSource({
  brand: {
    name: "Sunlit Skincare",
    description: "Clean beauty for Indian skin. 100% vegan formulas. Free shipping on orders above ₹499. 7-day easy returns.",
    instagram_handle: "sunlit24",
  },
  product: {
    name: "Sunlit Shield SPF 50 PA++++ Sunscreen",
    description: "Lightweight gel sunscreen with 10% niacinamide",
    price: 799,
    key_benefits: ["No white cast", "Lasts 8 hours"],
    ingredients: "niacinamide, zinc oxide",
  },
  brief: ["Diwali sale: 20% off everything till 31 Oct. Over 5k happy customers."],
})

type Case = {
  name: string
  text: string
  /** Exact list of claims expected to be flagged (order-sensitive). */
  flagged: string[]
  /** Substrings that must survive stripping (real facts / allowed patterns). */
  keeps?: string[]
  /** Substrings that must be gone after stripping (invented claims). */
  removes?: string[]
}

const cases: Case[] = [
  // ── invented claims: must be flagged and stripped ──
  { name: "invented percentage stat", text: "73% of women skip SPF. Here's why that matters.", flagged: ["73%"], removes: ["73%"], keeps: ["Here's why that matters."] },
  { name: "invented customer count", text: "Loved by 10,000+ customers. Try it today.", flagged: ["10,000+"], removes: ["10,000"] },
  { name: "invented duration claim", text: "Visible glow in 2 weeks.", flagged: ["2 weeks"], removes: ["2 weeks", " in."], keeps: ["Visible glow"] },
  { name: "invented multiplier", text: "Absorbs 3x faster than regular creams.", flagged: ["3x"], removes: ["3x"] },
  { name: "invented ratio", text: "9 out of 10 dermatologists agree.", flagged: ["9 out of 10"], removes: ["9 out of 10"] },
  { name: "invented price", text: "Now just Rs. 349 for the travel size. Grab it.", flagged: ["Rs. 349"], removes: ["Rs. 349"] },
  { name: "invented founding year", text: "Trusted since 2015. Made for you.", flagged: ["2015"], removes: ["since 2015"], keeps: ["Made for you."] },
  { name: "invented big count", text: "Recommended by 250 dermatologists.", flagged: ["250"], removes: ["250"] },
  // ── real facts: must be kept ──
  { name: "real price ₹799", text: "Get Sunlit Shield for just ₹799.", flagged: [], keeps: ["₹799"] },
  { name: "brief offer 20% off Diwali", text: "Diwali offer: 20% off everything this week.", flagged: [], keeps: ["20% off"] },
  { name: "SPF 50 from product name", text: "SPF 50 PA++++ protection, no white cast.", flagged: [], keeps: ["SPF 50"] },
  { name: "brand policy numbers", text: "Free shipping above ₹499 and 7-day easy returns. 100% vegan.", flagged: [], keeps: ["₹499", "7-day", "100%"] },
  { name: "benefit duration from facts", text: "Lasts 8 hours on humid days.", flagged: [], keeps: ["8 hours"] },
  { name: "magnitude matches brief (5k == 5000)", text: "Join 5000 happy customers.", flagged: [], keeps: ["5000"] },
  { name: "ingredient percentage from description", text: "With 10% niacinamide for even tone.", flagged: [], keeps: ["10%"] },
  // ── allowed non-claim patterns ──
  { name: "24/7 and 24x7", text: "Support 24/7. Chat with us 24x7.", flagged: [], keeps: ["24/7", "24x7"] },
  { name: "campaign year", text: "Your Diwali 2026 glow-up starts here.", flagged: [], keeps: ["2026"] },
  { name: "dates", text: "Sale ends 31 Oct. Restock on Nov 5th and 15/11/2026.", flagged: [], keeps: ["31 Oct", "Nov 5th", "15/11/2026"] },
  { name: "phone number", text: "Call +91 98765 43210 or 1800-123-4567.", flagged: [], keeps: ["98765 43210", "1800-123-4567"] },
  { name: "handles, hashtags, email, url", text: "Follow @sunlit2026 #Top100 or mail care123@sunlit.in, sunlit.in/offer2026", flagged: [], keeps: ["@sunlit2026", "#Top100"] },
  { name: "2-in-1 and small counts", text: "A 2-in-1 cleanser. 3 steps to brighter skin.", flagged: [], keeps: ["2-in-1", "3 steps"] },
  // ── edge cases ──
  { name: "partially supported ratio (only 10 is a fact)", text: "6 in 10 users repurchase.", flagged: ["6 in 10"], removes: ["6 in 10"] },
  // KNOWN LIMITATION, asserted so it's visible: matching is by number,
  // not by meaning -- 100 is a fact here ("100% vegan"), so "SPF 100"
  // passes even though the product is SPF 50.
  { name: "limitation: fact number reused in another claim", text: "SPF 100 protection all day.", flagged: [], keeps: ["SPF 100"] },
  { name: "one-line hook strips to claim-only removal", text: "40% fewer breakouts", flagged: ["40%"], keeps: ["fewer breakouts"], removes: ["40%"] },
  { name: "one-word leftover becomes empty", text: "in 2 weeks", flagged: ["2 weeks"] },
  { name: "decimal not split mid-number", text: "Results 2.5x faster. It works.", flagged: ["2.5x"], keeps: ["It works."] },
]

let failures = 0
for (const c of cases) {
  const flagged = findUnsupportedClaims(c.text, facts)
  const stripped = stripUnsupportedClaims(c.text, facts)
  const problems: string[] = []
  if (JSON.stringify(flagged) !== JSON.stringify(c.flagged)) problems.push(`flagged ${JSON.stringify(flagged)}, expected ${JSON.stringify(c.flagged)}`)
  for (const k of c.keeps ?? []) if (!stripped.includes(k)) problems.push(`lost "${k}"`)
  for (const r of c.removes ?? []) if (stripped.includes(r)) problems.push(`kept "${r}"`)
  if (problems.length) failures++
  console.log(`${problems.length ? "FAIL" : "ok  "}  ${c.name.padEnd(48)} flagged=${JSON.stringify(flagged)}  ->  ${JSON.stringify(stripped)}${problems.length ? `   <-- ${problems.join("; ")}` : ""}`)
}

// guardCopy behaviour: retry fixes it / retry throws -> strip / no budget -> skip retry
async function guardChecks(): Promise<void> {
  const bad = { headline: "73% of buyers never return", body: "Real fix inside." }
  const fixed = { headline: "Most buyers never return", body: "Real fix inside." }
  const checks: [string, () => Promise<boolean>][] = [
    ["guardCopy: retry result used when clean", async () => JSON.stringify(await guardCopy({ stage: "test", data: bad, facts, normalTimeoutMs: 1000, retry: async () => fixed })) === JSON.stringify(fixed)],
    ["guardCopy: retry throws -> first result stripped", async () => (await guardCopy({ stage: "test", data: bad, facts, normalTimeoutMs: 1000, retry: async () => { throw new Error("boom") } })).headline === "of buyers never return"],
    ["guardCopy: no time budget -> retry skipped, stripped", async () => {
      let called = false
      const out = await guardCopy({ stage: "test", data: bad, facts, normalTimeoutMs: 1000, deadline: Date.now() + 2000, retry: async () => { called = true; return fixed } })
      return !called && !out.headline.includes("73%")
    }],
    ["factRetryTimeoutMs: capped to remaining budget", async () => { const t = factRetryTimeoutMs(Date.now() + 20_000, 40_000); return t !== null && t <= 17_000 && t > 15_000 }],
  ]
  for (const [name, fn] of checks) {
    const ok = await fn().catch(() => false)
    if (!ok) failures++
    console.log(`${ok ? "ok  " : "FAIL"}  ${name}`)
  }
}

guardChecks().then(() => {
  const total = cases.length + 4
  console.log(`\n[test-fact-guard] ${total - failures}/${total} passed`)
  if (failures > 0) process.exit(1)
})
