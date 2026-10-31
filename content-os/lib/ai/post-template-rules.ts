import type { GeneratedCaption } from "@/types/app"
import { FESTIVAL_CATALOG } from "@/lib/occasions/festival-catalog"
import { getFestivalOccasionsInWindow } from "@/lib/occasions/get-upcoming-occasions"
import { topicQuotes } from "./story-frames"

/**
 * The three data-bound post templates and their server-side requirements --
 * offered to the caption model only when their data exists, then checked
 * again on its answer (finishPostTemplates); a post that fails its check
 * becomes bold_statement and loses the template's fields. Nothing here is
 * ever invented:
 * - listicle_cover: the number on the image IS the count of real items the
 *   caption lists -- computed here, never taken from the model.
 * - festive_poster: only when the topic names an occasion or the post's
 *   date is one (lib/occasions); the occasion name is ours, not the model's.
 * - review_card: only for review text the user actually gave (a quote in
 *   the topic), copied word for word; a reviewer's name only if given.
 */

export const LISTICLE_MIN_ITEMS = 3
export const LISTICLE_MAX_ITEMS = 10
const LISTICLE_ITEM_MAX_WORDS = 10
const LISTICLE_TITLE_MAX_WORDS = 5
const FESTIVE_GREETING_MAX_WORDS = 5
const FESTIVE_LINE_MAX_WORDS = 6
const REVIEW_MAX_WORDS = 24
const FALLBACK = "bold_statement" as const

export interface PostTemplateContext {
  /** The topic (the user's brief / the slot's brief). */
  topic: string
  /** An occasion the topic names or the post's date falls on; null = no festive poster. */
  occasion: string | null
  /** Real review text the user gave (quotes in the topic); empty = no review card. */
  reviews: string[]
}

const wordsOf = (s: string | null | undefined) => (s?.trim().match(/\S+/g) ?? [])
const clampWords = (s: string | null | undefined, max: number) => wordsOf(s).slice(0, max).join(" ").replace(/[,;:\-–—]+$/, "")
const normalize = (s: string) => s.toLowerCase().replace(/[“”"'‘’.,!?;:()\-–—]/g, " ").replace(/\s+/g, " ").trim()
const numbersIn = (s: string) => s.match(/\d+(?:[.,]\d+)?/g) ?? []

/** The catalog occasion the text names (its name or an API name variant), whole words only. */
export function occasionNamedIn(text: string): string | null {
  const t = ` ${normalize(text)} `
  for (const o of FESTIVAL_CATALOG) {
    for (const name of [o.name, ...(o.apiNameVariants ?? [])]) {
      const n = normalize(name)
      if (n && t.includes(` ${n} `)) return o.name
    }
  }
  return null
}

/**
 * What the post's data allows. `postDate` (YYYY-MM-DD) is the day it goes
 * out -- an occasion on that day or the next counts; without one only the
 * topic can name an occasion. Never throws.
 */
export async function postTemplateContext(topic: string | null | undefined, postDate?: string | null): Promise<PostTemplateContext> {
  const t = topic?.trim() ?? ""
  let occasion = occasionNamedIn(t)
  if (!occasion && postDate && /^\d{4}-\d{2}-\d{2}$/.test(postDate)) {
    try {
      const onDate = await getFestivalOccasionsInWindow(new Date(`${postDate}T00:00:00`), 1)
      occasion = onDate[0]?.name ?? null
    } catch (err) {
      console.error("[post-template-rules] couldn't read the occasion dates (no festive poster):", err instanceof Error ? err.message : err)
    }
  }
  return { topic: t, occasion, reviews: topicQuotes(t).filter((q) => wordsOf(q).length <= REVIEW_MAX_WORDS) }
}

/** The extra suggested_template guidance + fields for the caption prompt. */
export function postTemplatePromptBlock(ctx: PostTemplateContext): { rule: string; fields: string } {
  const rule = [
    ` Pick listicle_cover ONLY when the caption genuinely lists ${LISTICLE_MIN_ITEMS}-${LISTICLE_MAX_ITEMS} separate tips, ways or items (one per line) -- the image shows how many there are.`,
    ctx.occasion ? ` Pick festive_poster when this post is about ${ctx.occasion} -- a greeting poster for the occasion.` : "",
    ctx.reviews.length ? " Pick review_card when the post is built around the customer review quoted in the topic -- the image shows that review word for word." : "",
  ].join("")
  const fields = [
    `,\n  "listicle_title": "ONLY if suggested_template is listicle_cover -- what the list is, max ${LISTICLE_TITLE_MAX_WORDS} words, WITHOUT the number (e.g. ways to style chinos), otherwise omit"`,
    `,\n  "listicle_items": "ONLY if suggested_template is listicle_cover -- an array of the caption's own list items, each under ${LISTICLE_ITEM_MAX_WORDS + 1} words, copied from caption_text, otherwise omit"`,
    ctx.occasion ? `,\n  "festive_greeting": "ONLY if suggested_template is festive_poster -- the greeting for ${ctx.occasion}, max ${FESTIVE_GREETING_MAX_WORDS} words (e.g. Happy ${ctx.occasion}), no numbers, otherwise omit",\n  "festive_line": "ONLY if suggested_template is festive_poster -- a short handwritten wish from the brand, max ${FESTIVE_LINE_MAX_WORDS} words, no offers or numbers unless the topic gives them, otherwise omit"` : "",
    ctx.reviews.length ? `,\n  "review_quote": "ONLY if suggested_template is review_card -- the customer review from the topic, copied WORD FOR WORD (max ${REVIEW_MAX_WORDS} words), never invented or reworded, otherwise omit",\n  "review_author": "ONLY if suggested_template is review_card and the topic names the reviewer -- their name exactly as given, otherwise null"` : "",
  ].join("")
  return { rule, fields }
}

/** A list item counts only when most of its words are in the caption -- it must really be listed there. */
function itemInCaption(item: string, caption: string): boolean {
  const words = normalize(item).split(" ").filter((w) => w.length > 2)
  if (words.length === 0) return false
  const text = ` ${normalize(caption)} `
  return words.filter((w) => text.includes(` ${w} `) || text.includes(` ${w}`)).length / words.length >= 0.6
}

function strip(c: GeneratedCaption): GeneratedCaption {
  const rest = { ...c }
  delete rest.listicle_title
  delete rest.listicle_items
  delete rest.listicle_count
  delete rest.festive_occasion
  delete rest.festive_greeting
  delete rest.festive_line
  delete rest.review_quote
  delete rest.review_author
  return rest
}

const fallback = (c: GeneratedCaption, why: string): GeneratedCaption => {
  console.error(`[post-template-rules] ${c.suggested_template}: ${why} -- using ${FALLBACK}`)
  return { ...strip(c), suggested_template: FALLBACK }
}

/** Final say on the three templates: requirement checked, fields cleaned, the number / occasion set here. */
export function finishPostTemplates(c: GeneratedCaption, ctx: PostTemplateContext | undefined): GeneratedCaption {
  const template = c.suggested_template
  if (template !== "listicle_cover" && template !== "festive_poster" && template !== "review_card") return strip(c)
  if (!ctx) return fallback(c, "no template context")

  if (template === "listicle_cover") {
    const seen = new Set<string>()
    const items = (Array.isArray(c.listicle_items) ? c.listicle_items : [])
      .filter((i): i is string => typeof i === "string" && !!i.trim())
      .map((i) => i.trim().replace(/^\d+[.)]\s*/, ""))
      .filter((i) => wordsOf(i).length <= LISTICLE_ITEM_MAX_WORDS && itemInCaption(i, c.caption_text ?? ""))
      .filter((i) => !seen.has(normalize(i)) && !!seen.add(normalize(i)))
    if (items.length < LISTICLE_MIN_ITEMS || items.length > LISTICLE_MAX_ITEMS) return fallback(c, `${items.length} real list item(s) in the caption`)
    // The title never carries its own number -- the count is drawn from the items.
    const title = clampWords(c.listicle_title?.replace(/\b\d+\b/g, " "), LISTICLE_TITLE_MAX_WORDS)
    if (!title) return fallback(c, "no title")
    return { ...strip(c), suggested_template: template, listicle_title: title, listicle_items: items, listicle_count: items.length }
  }

  if (template === "festive_poster") {
    if (!ctx.occasion) return fallback(c, "the topic and date aren't an occasion")
    // No numbers the topic doesn't give (a date, a discount).
    const topicNumbers = new Set(numbersIn(ctx.topic))
    const clean = (s: string | null | undefined, max: number) => {
      const v = clampWords(s, max)
      return numbersIn(v).every((n) => topicNumbers.has(n)) ? v : ""
    }
    const greeting = clean(c.festive_greeting, FESTIVE_GREETING_MAX_WORDS) || `Happy ${ctx.occasion}`
    return { ...strip(c), suggested_template: template, festive_occasion: ctx.occasion, festive_greeting: greeting, festive_line: clean(c.festive_line, FESTIVE_LINE_MAX_WORDS) || null }
  }

  // review_card: the quote must be one of the user's own reviews, word for word.
  const quote = c.review_quote?.trim() ?? ""
  const real = quote ? ctx.reviews.find((r) => normalize(r) === normalize(quote) || (normalize(r).includes(normalize(quote)) && wordsOf(quote).length >= 4)) : undefined
  if (!real) return fallback(c, "no review text the user gave")
  const author = c.review_author?.trim() ?? ""
  return {
    ...strip(c),
    suggested_template: template,
    review_quote: normalize(real) === normalize(quote) ? real : quote,
    review_author: author && normalize(ctx.topic).includes(normalize(author)) ? author : null,
  }
}
