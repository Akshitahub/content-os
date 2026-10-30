/**
 * annotated_product copy rules (lib/ai/annotated-product.ts): offered only
 * with a product photo, keyword verbatim from the headline, 3-4 callouts
 * each grounded in the product / brand facts. Pure -- no model calls.
 *
 *   npx tsx scripts/test-annotated-product.ts
 */
import { annotatedContext, annotatedIssues, calloutGrounded, finishAnnotatedCaption } from "@/lib/ai/annotated-product"
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

console.log(failures ? `\n${failures} FAILED` : "\nall pass")
process.exit(failures ? 1 : 0)
