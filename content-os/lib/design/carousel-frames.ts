/**
 * Carousels in the story frame language (lib/image/story-frame-compositor.ts,
 * 1080x1350): slide 1 a hook frame, the middle slides alternating photo-led
 * and type-led, the last a CTA. A framed slide's own headline / subtext ARE
 * its big words / body line (finalizeCarouselFrames writes them there), so
 * the builder's existing fields edit what's drawn. Client-safe: no server
 * imports. Slides without a `frame` (saved before this) render as before.
 */

import type { FontId } from "./fonts"

/**
 * Every frame -- story, post, carousel -- sets its big words in a poster
 * display face: the brand's heading font when it is one (Anton, Playfair),
 * else Anton. A rounded, body or script heading (Quicksand, Inter, Caveat)
 * reads soft at poster size; those stay for the brand's other text.
 */
export function frameDisplayFont(id: FontId | null | undefined): FontId {
  return id === "playfair" ? "playfair" : "anton"
}

export const CAROUSEL_FRAMES = ["hook", "slide_photo", "slide_type", "cta"] as const
export type CarouselFrame = (typeof CAROUSEL_FRAMES)[number]

export const CAROUSEL_BIG_WORDS_MAX = 4
/** Body text on any slide -- one line, never a paragraph or a list. */
export const CAROUSEL_BODY_MAX = 12
export const CAROUSEL_SCRIPT_LINE_MAX = 6
export const CAROUSEL_CTA_LABEL_MAX = 5

export function isCarouselFrame(v: unknown): v is CarouselFrame {
  return typeof v === "string" && (CAROUSEL_FRAMES as readonly string[]).includes(v)
}

/** Slide i of n: the hook, then photo / type alternating, then the CTA. */
export function carouselFrameFor(index: number, count: number): CarouselFrame {
  if (index === 0) return "hook"
  if (index === count - 1 && count > 1) return "cta"
  return index % 2 === 1 ? "slide_photo" : "slide_type"
}

/** Type-led slides are drawn on the brand's own colour -- no photo, nothing generated. */
export function carouselFrameNeedsPhoto(frame: unknown): boolean {
  return frame !== "slide_type"
}

const TRAILING = /^(?:and|or|but|the|a|an|of|to|for|with|in|on|at|by|your|our|is|are|that|this)$/i

/** First `max` words, never ending on a dangling joiner or punctuation. */
export function clampSlideWords(s: unknown, max: number): string {
  if (typeof s !== "string") return ""
  const words = s.replace(/\s+/g, " ").trim().split(" ").filter(Boolean).slice(0, max)
  while (words.length > 1 && TRAILING.test(words[words.length - 1]!.replace(/[^\w']/g, ""))) words.pop()
  return words.join(" ").replace(/[,;:\-–—]+$/, "")
}

const wordCount = (s: string) => (s.match(/\S+/g) ?? []).length
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")

/** The slide's 1-4 display words: the model's big_words, else a short headline / highlight. */
function bigWordsFor(s: Record<string, unknown>): string {
  const own = clampSlideWords(s.big_words, CAROUSEL_BIG_WORDS_MAX)
  if (own) return own
  const headline = str(s.headline)
  if (headline && wordCount(headline) <= CAROUSEL_BIG_WORDS_MAX) return headline.replace(/[.!]+$/, "")
  const highlight = str(s.highlight)
  if (highlight && wordCount(highlight) <= CAROUSEL_BIG_WORDS_MAX && headline.toLowerCase().includes(highlight.toLowerCase())) return highlight
  return clampSlideWords(headline, CAROUSEL_BIG_WORDS_MAX)
}

/** One line of at most 12 words -- the model's body, else the slide's subtext / first point / long headline. */
function bodyFor(s: Record<string, unknown>, bigWords: string): string {
  const points = Array.isArray(s.points) ? s.points.filter((p): p is string => typeof p === "string" && !!p.trim()) : []
  const headline = str(s.headline)
  const candidates = [str(s.body), str(s.subtext), points[0] ?? "", headline !== bigWords ? headline : ""]
  return clampSlideWords(candidates.find(Boolean) ?? "", CAROUSEL_BODY_MAX)
}

/** The prompt rule for the frame copy (lib/ai/carousel-generator.ts). */
export function carouselFrameRules(): string {
  return `FRAME COPY -- every slide is a designed image, not a document. Every slide object (and cta_slide) ALSO gets:
- "big_words": 1-${CAROUSEL_BIG_WORDS_MAX} words, drawn huge -- the slide's core in the fewest words (the topic's own words when short). Never a number, price or claim the brand facts or topic don't give.
- "body": ONE line, max ${CAROUSEL_BODY_MAX} words -- the slide's new information. No paragraphs, no lists. The cover's "body" is a teaser of at most ${CAROUSEL_SCRIPT_LINE_MAX} words (it's handwritten).
- cta_slide: "cta" is the button, max ${CAROUSEL_CTA_LABEL_MAX} words (the action, e.g. "Shop the drop").`
}

/**
 * Stamps every slide with its frame, a seed and the sequence-level tape /
 * brand-mark choices, and writes the frame copy into the fields the builder
 * edits: headline = big words, subtext = the body line (or the handwritten
 * line on the hook / CTA), points emptied (no lists on a frame). `seedBase`
 * keeps a regenerate from drawing the same rotations.
 */
export function finalizeCarouselFrames(slides: Record<string, unknown>[], opts: { ctaPhrase?: string | null; seedBase?: number } = {}): Record<string, unknown>[] {
  const count = slides.length
  const seedBase = opts.seedBase ?? Math.floor(Math.random() * 2 ** 20)
  return slides.map((s, i) => {
    const frame = carouselFrameFor(i, count)
    const bigWords = bigWordsFor(s) || clampSlideWords(s.headline, CAROUSEL_BIG_WORDS_MAX) || "More"
    const line = frame === "hook" || frame === "cta"
      ? clampSlideWords(str(s.body) || str(s.subtext), CAROUSEL_SCRIPT_LINE_MAX)
      : bodyFor(s, bigWords)
    const cta = frame === "cta" ? clampSlideWords(str(s.cta) || str(opts.ctaPhrase), CAROUSEL_CTA_LABEL_MAX) || "Shop now" : s.cta
    return {
      ...s,
      frame,
      headline: bigWords,
      subtext: line || null,
      points: [],
      ...(frame === "cta" ? { cta } : {}),
      seed: (seedBase + i * 7919) % 2 ** 30,
      brand_mark: frame === "hook" || frame === "cta",
    }
  })
}
