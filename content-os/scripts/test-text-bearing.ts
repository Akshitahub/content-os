/**
 * Dev-only check for lib/ai/visual-brief.ts findTextBearingSubject (no test
 * runner in this repo -- same pattern as scripts/test-text-contrast.ts).
 * Each case is a brief's must_show and the text-bearing object it should be
 * flagged for (null = passes). Exits non-zero on any mismatch.
 *
 *   npx tsx scripts/test-text-bearing.ts
 */
import { findTextBearingSubject } from "@/lib/ai/visual-brief"

if (process.env.NODE_ENV === "production") {
  console.error("[test-text-bearing] refusing to run with NODE_ENV=production -- this is a dev-only check.")
  process.exit(1)
}

type Case = { brief: string; expected: string | null; productReference?: boolean }

const CASES: Case[] = [
  // Verified false positives / negatives in the first version.
  { brief: "close-up of skin showing early signs of aging", expected: null },
  { brief: "a hand holding two vitamin tablets over a glass of water", expected: null },
  { brief: "a phone on the desk showing the brand's app, a blurred plant in the background", expected: "phone" },

  // Spec cases.
  { brief: "a tablet showing an auto-generated content calendar", expected: "tablet" },
  { brief: "a woman applying sunscreen on a beach", expected: null },
  { brief: "a laptop closed on a desk beside a cup of chai", expected: null },
  { brief: "a person smiling at their phone, screen out of focus", expected: null },
  { brief: "a phone displaying a checkout page", expected: "phone" },
  { brief: "a pharmacy shelf with medicine tablets", expected: null },
  { brief: "a street sign in Old Delhi", expected: "sign" },
  { brief: "an ayurvedic capsule bottle with its real label", expected: null, productReference: true },

  // Realistic D2C briefs (skincare, food, apparel, supplements).
  { brief: "a jar of vitamin C face cream on a marble counter, lid off, soft morning light", expected: null },
  { brief: "a serum bottle beside a printed ingredient label, close-up", expected: "label" },
  { brief: "a steaming cup of masala chai with whole spices scattered on a wooden table", expected: null },
  { brief: "a model in an oversized linen shirt walking past a shop sign in a busy market", expected: "sign" },
  { brief: "a supplement bottle spilling effervescent tablets into a glass of water", expected: null },
  { brief: "a tablet of handmade neem soap on a ceramic dish", expected: null },
  { brief: "a hand holding a protein shake, a phone propped up showing a workout app", expected: "phone" },
  { brief: "a phone lying face-down on a yoga mat next to a water bottle", expected: null },
  { brief: "a laptop on a desk, its screen dark, a kurta draped over the chair", expected: null },
  { brief: "a phone displaying an order confirmation, its screen slightly blurred", expected: "phone" },
  { brief: "a sign of quality: hand-stitched leather seams in close-up", expected: null },
]

let failures = 0
for (const c of CASES) {
  const got = findTextBearingSubject({ kind: "product_scene", must_show: c.brief, composition: "" }, { productReference: c.productReference })
  const ok = got === c.expected
  if (!ok) failures++
  console.log(`${ok ? "PASS" : "FAIL"} ${JSON.stringify(c.brief)}${c.productReference ? " (product reference)" : ""} -> ${JSON.stringify(got)}${ok ? "" : ` (expected ${JSON.stringify(c.expected)})`}`)
}

if (failures) {
  console.error(`${failures} of ${CASES.length} case(s) failed`)
  process.exit(1)
}
console.log(`all ${CASES.length} text-bearing cases passed`)
