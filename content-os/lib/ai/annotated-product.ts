import type { BrandRow, ProductRow } from "@/types/database"
import type { GeneratedCaption } from "@/types/app"
import { parseBrandBrain } from "@/lib/brand-brain-profile"

/**
 * The annotated_product post template's copy: a headline, one keyword from
 * it set in script, and 3-4 handwritten callouts around the product photo.
 * Only offered when the post has a product with a photo; every callout must
 * be a fact from the product / brand -- checked here (grounding) on top of
 * the fact guard's number check that already walks every copy field.
 */

export const ANNOTATED_TEMPLATE = "annotated_product"
export const ANNOTATED_HEADLINE_MAX_WORDS = 6
export const ANNOTATED_CALLOUT_MAX_WORDS = 5
export const ANNOTATED_MIN_CALLOUTS = 3
export const ANNOTATED_MAX_CALLOUTS = 4

export interface AnnotatedContext {
  /** The post has a product with a photo -- the template is allowed. */
  allowed: boolean
  /** Everything a callout may draw on: product, brand description, Brand Brain profile. */
  sourceText: string
}

/** Product must have a photo; the source is what callouts may be grounded in. */
export function annotatedContext(brand: Partial<BrandRow>, product: Partial<ProductRow> | null | undefined): AnnotatedContext {
  const parts: string[] = [brand.name ?? "", brand.description ?? "", brand.niche ?? "", brand.positioning ?? "", ...(brand.brand_values ?? [])]
  // The Brand Brain's facts and own phrases -- not its never-say lists.
  const brain = parseBrandBrain(brand.brand_brain)
  parts.push(...(brain.facts?.differentiators ?? []), ...(brain.facts?.customer_problems ?? []), ...(brain.facts?.verified_claims ?? []).map((c) => c.claim), ...(brain.voice?.phrases_to_use ?? []))
  if (product) {
    parts.push(product.name ?? "", product.description ?? "", product.category ?? "", product.ingredients ?? "", product.target_customer ?? "", ...(product.key_benefits ?? []))
  }
  return { allowed: !!product?.image_urls?.[0], sourceText: parts.filter(Boolean).join("\n") }
}

/** The JSON fields the caption prompt adds -- only when the template is offered. */
export function annotatedFieldsBlock(): string {
  return `,\n  "annotated_headline": "ONLY if suggested_template is annotated_product -- the headline above the product, under ${ANNOTATED_HEADLINE_MAX_WORDS + 1} words, otherwise omit this field entirely",\n  "annotated_keyword": "ONLY if suggested_template is annotated_product -- one word or a short phrase copied VERBATIM from annotated_headline, shown in handwriting, otherwise omit this field entirely",\n  "annotated_callouts": "ONLY if suggested_template is annotated_product -- an array of ${ANNOTATED_MIN_CALLOUTS}-${ANNOTATED_MAX_CALLOUTS} handwritten notes pointing at the product, each under ${ANNOTATED_CALLOUT_MAX_WORDS + 1} words, each a CONCRETE fact or benefit taken from the product description, the Brand Brain profile or the brand facts above (never invented, no numbers that aren't there); a Hinglish touch is welcome when it fits the brand voice. Otherwise omit this field entirely"`
}

/** The suggested_template guidance for it. */
export const ANNOTATED_TEMPLATE_RULE = "Pick annotated_product when the post is about the selected product itself and its concrete features or benefits: the real product photo sits in the centre with 3-4 handwritten notes pointing at it."

const STOP = new Set(("the a an and or but for with without from into onto your you our its it's this that these those to of in on at by is are was be been made make makes more most very so too just all any every each per than then also not no yes " +
  "hai hain ka ki ke ko se mein aur bhi toh na yaar ekdum bas wala wali wale").split(" "))

function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 3 && !STOP.has(w))
}

// A loose stem: plurals / -ing / -ed forms of the same word match.
const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, "").slice(0, 6)

/** A callout shares at least one content word with the product / brand source. */
export function calloutGrounded(callout: string, sourceText: string): boolean {
  const source = new Set(contentWords(sourceText).map(stem))
  return contentWords(callout).some((w) => source.has(stem(w)))
}

function words(s: string | null | undefined): number {
  return (s?.trim().match(/\S+/g) ?? []).length
}

/** Validation issues for the retry -- only when the model picked the template. */
export function annotatedIssues(parsed: GeneratedCaption, ctx: AnnotatedContext | undefined): string[] {
  if (!ctx || parsed.suggested_template !== ANNOTATED_TEMPLATE) return []
  if (!ctx.allowed) return [`suggested_template annotated_product needs a product photo and this post has none -- pick another template and omit the annotated_* fields.`]
  const issues: string[] = []
  const headline = parsed.annotated_headline?.trim() ?? ""
  if (!headline) issues.push(`annotated_headline is missing -- annotated_product needs a headline under ${ANNOTATED_HEADLINE_MAX_WORDS + 1} words.`)
  else if (words(headline) > ANNOTATED_HEADLINE_MAX_WORDS) issues.push(`annotated_headline "${headline}" is too long -- under ${ANNOTATED_HEADLINE_MAX_WORDS + 1} words.`)
  const keyword = parsed.annotated_keyword?.trim() ?? ""
  if (!keyword || !headline.toLowerCase().includes(keyword.toLowerCase())) issues.push(`annotated_keyword "${keyword}" must be copied VERBATIM from annotated_headline.`)
  const callouts = Array.isArray(parsed.annotated_callouts) ? parsed.annotated_callouts : []
  if (callouts.length < ANNOTATED_MIN_CALLOUTS || callouts.length > ANNOTATED_MAX_CALLOUTS) issues.push(`annotated_callouts needs ${ANNOTATED_MIN_CALLOUTS}-${ANNOTATED_MAX_CALLOUTS} items (got ${callouts.length}).`)
  for (const c of callouts) {
    if (typeof c !== "string" || !c.trim()) continue
    if (words(c) > ANNOTATED_CALLOUT_MAX_WORDS) issues.push(`annotated_callouts "${c}" is too long -- under ${ANNOTATED_CALLOUT_MAX_WORDS + 1} words.`)
    if (!calloutGrounded(c, ctx.sourceText)) issues.push(`annotated_callouts "${c}" isn't a fact from the product description, Brand Brain or brand facts -- replace it with one that is.`)
  }
  return issues
}

/**
 * Final say on the template after validation / retry: never annotated_product
 * without a product photo; ungrounded or over-long callouts dropped; a
 * keyword not in the headline cleared; and with fewer than 3 callouts left
 * (or no headline) the post becomes product_focus -- it still has its
 * product photo. Other templates lose any stray annotated_* fields.
 */
export function finishAnnotatedCaption(parsed: GeneratedCaption, ctx: AnnotatedContext | undefined): GeneratedCaption {
  const strip = (c: GeneratedCaption): GeneratedCaption => {
    const rest = { ...c }
    delete rest.annotated_headline
    delete rest.annotated_keyword
    delete rest.annotated_callouts
    return rest
  }
  if (parsed.suggested_template !== ANNOTATED_TEMPLATE) return strip(parsed)
  if (!ctx?.allowed) {
    console.error("[annotated-product] suggested without a product photo -- using product_focus")
    return { ...strip(parsed), suggested_template: "product_focus" }
  }
  const headline = parsed.annotated_headline?.trim().split(/\s+/).slice(0, ANNOTATED_HEADLINE_MAX_WORDS).join(" ") ?? ""
  const keywordRaw = parsed.annotated_keyword?.trim() ?? ""
  const keyword = keywordRaw && headline.toLowerCase().includes(keywordRaw.toLowerCase()) ? keywordRaw : null
  const callouts = (Array.isArray(parsed.annotated_callouts) ? parsed.annotated_callouts : [])
    .filter((c): c is string => typeof c === "string" && !!c.trim())
    .map((c) => c.trim())
    .filter((c) => words(c) <= ANNOTATED_CALLOUT_MAX_WORDS && calloutGrounded(c, ctx.sourceText))
    .slice(0, ANNOTATED_MAX_CALLOUTS)
  if (!headline || callouts.length < ANNOTATED_MIN_CALLOUTS) {
    console.error(`[annotated-product] only ${callouts.length} grounded callout(s)${headline ? "" : " and no headline"} -- using product_focus`)
    return { ...strip(parsed), suggested_template: "product_focus" }
  }
  return { ...parsed, annotated_headline: headline, annotated_keyword: keyword, annotated_callouts: callouts }
}
