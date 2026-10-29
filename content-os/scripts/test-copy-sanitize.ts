/**
 * Dev-only check for lib/ai/content-quality-check.ts's colour-code and
 * hashtag handling (no test runner in this repo -- same pattern as
 * scripts/test-text-bearing.ts): hex codes found and dropped from generated
 * text, and generated hashtags normalised. Exits non-zero on any mismatch.
 *
 *   npx tsx scripts/test-copy-sanitize.ts
 */
import { findContentQualityIssues, normalizeHashtags, sanitizeLeakedArtifacts } from "@/lib/ai/content-quality-check"

if (process.env.NODE_ENV === "production") {
  console.error("[test-copy-sanitize] refusing to run with NODE_ENV=production -- this is a dev-only check.")
  process.exit(1)
}

let failures = 0
let total = 0
function check(name: string, got: unknown, expected: unknown) {
  total++
  const ok = JSON.stringify(got) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? "PASS" : "FAIL"} ${name} -> ${JSON.stringify(got)}${ok ? "" : ` (expected ${JSON.stringify(expected)})`}`)
}

const flagsHex = (text: string) => findContentQualityIssues(text).some((i) => i.code === "hex_code")

// Text: colour hex codes are flagged and removed; real hashtags aren't.
const TEXT_CASES: { text: string; flagged: boolean; sanitized: string }[] = [
  { text: "Change background hue to #f5f5f5.", flagged: true, sanitized: "Change background hue." },
  { text: "Swap the trim to #a1b2c3 for a calmer look", flagged: true, sanitized: "Swap the trim to for a calmer look" },
  { text: "Pure white like #FFF, crisp and clean", flagged: false, sanitized: "Pure white like #FFF, crisp and clean" },
  { text: "Weekend plans: #cafe hopping in Bandra", flagged: false, sanitized: "Weekend plans: #cafe hopping in Bandra" },
  { text: "Proudly #indiad2c since day one", flagged: false, sanitized: "Proudly #indiad2c since day one" },
  { text: "Our #ab12 drop is live", flagged: false, sanitized: "Our #ab12 drop is live" },
  { text: "Turn it on. Then set the wall to #333.", flagged: true, sanitized: "Turn it on. Then set the wall." },
]
for (const c of TEXT_CASES) {
  check(`flags hex in ${JSON.stringify(c.text)}`, flagsHex(c.text), c.flagged)
  check(`sanitizes ${JSON.stringify(c.text)}`, sanitizeLeakedArtifacts(c.text), c.sanitized)
}

// Hashtags array: normalised, junk dropped, deduped case-insensitively, order kept.
check("normalizeHashtags drops hex codes, keeps hex-letter words", normalizeHashtags(["#f5f5f5", "#FFF", "#a1b2c3", "#cafe", "#ab12"]), ["FFF", "cafe", "ab12"])
check("normalizeHashtags drops purely numeric", normalizeHashtags(["#2026", "Diwali2026"]), ["Diwali2026"])
check("normalizeHashtags joins words", normalizeHashtags(["Diwali Sale"]), ["DiwaliSale"])
check("normalizeHashtags strips leading #s and symbols", normalizeHashtags(["##IndiaD2C", "skin-care!", "#made_in_india"]), ["IndiaD2C", "skincare", "made_in_india"])
check("normalizeHashtags dedupes case-insensitively, keeping the first", normalizeHashtags(["#IndiaD2C", "indiad2c", "#INDIAD2C", "Skincare"]), ["IndiaD2C", "Skincare"])
check("normalizeHashtags drops empty and over-30-char tags", normalizeHashtags(["#", "  ", "ThisHashtagIsWayTooLongToBeUseful2026"]), [])
check("normalizeHashtags keeps non-Latin letters", normalizeHashtags(["#दिवाली", "#दिवाली"]), ["दिवाली"])
check("normalizeHashtags ignores non-arrays and non-strings", [normalizeHashtags(undefined), normalizeHashtags(["ok", 5, null])], [[], ["ok"]])

if (failures) {
  console.error(`${failures} of ${total} check(s) failed`)
  process.exit(1)
}
console.log(`all ${total} copy-sanitize checks passed`)
