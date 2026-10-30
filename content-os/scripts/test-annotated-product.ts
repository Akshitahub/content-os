/**
 * annotated_product copy rules (lib/ai/annotated-product.ts): offered only
 * with a product photo, keyword verbatim from the headline, 3-4 callouts
 * each grounded in the product / brand facts; and the headline's keyword
 * keeping its word gaps (placeHeadlineRuns). Pure -- no model calls.
 *
 *   npx tsx scripts/test-annotated-product.ts
 */
import { annotatedContext, annotatedIssues, calloutGrounded, finishAnnotatedCaption } from "@/lib/ai/annotated-product"
import { placeHeadlineRuns } from "@/lib/image/post-compositor"
import type { GeneratedCaption } from "@/types/app"

const brand = {
  name: "SNITCH",
  description: "Menswear for the modern Indian man",
  niche: "Fashion",
  brand_brain: { facts: { differentiators: ["Ships in 48 hours"] }, voice: { phrases_to_use: ["office to weekend"] } },
}
const product = {
  name: "Olive Straight Fit Chinos",
  description: "Breathable stretch cotton chinos in olive. Straight fit, wrinkle-resistant, easy care.",
  key_benefits: ["All-day comfort"],
  image_urls: ["https://example.com/chinos.png"],
}
const withPhoto = annotatedContext(brand, product)
const noPhoto = annotatedContext(brand, { ...product, image_urls: [] })

const base = { caption_text: "x", hashtags: [], character_count: 1 } as unknown as GeneratedCaption
const good: GeneratedCaption = {
  ...base,
  suggested_template: "annotated_product",
  annotated_headline: "Chinos built for the monsoon",
  annotated_keyword: "monsoon",
  annotated_callouts: ["Breathable stretch cotton", "Straight fit, no fuss", "Office se weekend tak", "Wrinkle-resistant all day"],
}

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail !== undefined ? ` -- ${JSON.stringify(detail)}` : ""}`)
}

check("allowed only with a product photo", withPhoto.allowed && !noPhoto.allowed)
check("good copy has no issues", annotatedIssues(good, withPhoto).length === 0, annotatedIssues(good, withPhoto))
check("good copy is kept", finishAnnotatedCaption(good, withPhoto).annotated_callouts?.length === 4)

check("no photo: an issue for the retry", annotatedIssues(good, noPhoto).length === 1)
const noPhotoFinal = finishAnnotatedCaption(good, noPhoto)
check("no photo: becomes product_focus without annotated fields", noPhotoFinal.suggested_template === "product_focus" && noPhotoFinal.annotated_headline === undefined, noPhotoFinal)

const badKeyword = { ...good, annotated_keyword: "rain" }
check("keyword not in headline: issue", annotatedIssues(badKeyword, withPhoto).some((i) => i.includes("VERBATIM")))
check("keyword not in headline: cleared", finishAnnotatedCaption(badKeyword, withPhoto).annotated_keyword === null)

check("Hinglish callout grounded in the brand's phrase", calloutGrounded("Office se weekend tak", withPhoto.sourceText))
check("invented callout not grounded", !calloutGrounded("Free shipping worldwide", withPhoto.sourceText))
check("invented callout not grounded (2)", !calloutGrounded("Loved by celebrities", withPhoto.sourceText))
check("plural / -ing forms still match", calloutGrounded("Breathing cotton", withPhoto.sourceText))

const invented = { ...good, annotated_callouts: ["Breathable stretch cotton", "Straight fit, no fuss", "Office se weekend tak", "Loved by celebrities"] }
check("invented callout: issue", annotatedIssues(invented, withPhoto).some((i) => i.includes("Loved by celebrities")))
const inventedFinal = finishAnnotatedCaption(invented, withPhoto)
check("invented callout: dropped, template kept with 3", inventedFinal.suggested_template === "annotated_product" && inventedFinal.annotated_callouts?.length === 3, inventedFinal.annotated_callouts)

const tooFew = { ...good, annotated_callouts: ["Breathable stretch cotton", "Loved by celebrities", "Free shipping worldwide"] }
check("under 3 grounded callouts: product_focus", finishAnnotatedCaption(tooFew, withPhoto).suggested_template === "product_focus")

const long = { ...good, annotated_callouts: [...good.annotated_callouts!.slice(0, 3), "Breathable cotton that keeps you cool all day long"] }
check("over-long callout: issue", annotatedIssues(long, withPhoto).some((i) => i.includes("too long")))

const otherTemplate = { ...good, suggested_template: "bold_statement" as const }
const otherFinal = finishAnnotatedCaption(otherTemplate, withPhoto)
check("other template: stray annotated fields stripped", otherFinal.annotated_callouts === undefined && otherFinal.suggested_template === "bold_statement")
check("other template: no issues", annotatedIssues(otherTemplate, noPhoto).length === 0)

// The keyword (script font) keeps a word gap on each side that has a word:
// a space carried inside a tspan used to vanish at the font switch
// ("nani made" -> "nanimade"). Widths: 10px a character, script 12px.
const SPACE = 10
// The script run's ink overhangs its advance by 6px on the right, like Caveat's.
const widthOf = (r: { text: string; script: boolean }) => {
  const width = r.text.length * (r.script ? 12 : 10)
  return r.script ? { width, inkLeft: 0, inkRight: width + 6 } : { width }
}
const inkRight = (r: { text: string; script: boolean; x: number; width: number }) => r.x + r.width + (r.script ? 6 : 0)
const tokens = (headline: string, keyword: string) => headline.split(" ").map((w) => ({ text: w, script: w === keyword }))
for (const [where, keyword, expected] of [
  ["start", "Achaar", ["Achaar", "like nani made"]],
  ["middle", "nani", ["Achaar like", "nani", "made"]],
  ["end", "made", ["Achaar like nani", "made"]],
] as const) {
  const runs = placeHeadlineRuns(tokens("Achaar like nani made", keyword), widthOf, SPACE, 540)
  check(`keyword at the ${where}: runs split around it`, JSON.stringify(runs.map((r) => r.text)) === JSON.stringify(expected), runs.map((r) => r.text))
  const gaps = runs.slice(1).map((r, i) => r.x - inkRight(runs[i]!))
  check(`keyword at the ${where}: a word space of clear ink before and/or after it`, gaps.length === expected.length - 1 && gaps.every((g) => Math.abs(g - SPACE) < 1e-9), gaps)
  const left = runs[0]!.x
  const right = inkRight(runs[runs.length - 1]!)
  check(`keyword at the ${where}: line still centred`, Math.abs((left + right) / 2 - 540) < 1e-9, { left, right })
}

console.log(failures ? `\n${failures} FAILED` : "\nall pass")
process.exit(failures ? 1 : 0)
