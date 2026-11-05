/**
 * Carousels in the story frame language (lib/image/story-frame-compositor.ts,
 * 1080x1350): slide 1 a hook frame, the middle slides laid out by what they
 * say (carouselLayoutsFor), the last a CTA. A framed slide's own headline / subtext ARE
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

/**
 * The carousel's three layouts: a full-bleed photo with the text in its free
 * space, a split (photo on one side, type on the other), and type-led (the
 * brand colour, big type, a supporting photo crop or colour block). The
 * hook and the CTA are full-bleed. A middle slide is a split only when its
 * content is a contrast (carouselLayoutsFor) -- the same rule posts and
 * stories follow -- and the rest alternate full / type for variety. The
 * same layout never runs three slides in a row.
 */
export const CAROUSEL_LAYOUTS = ["full", "split", "type"] as const
export type CarouselLayout = (typeof CAROUSEL_LAYOUTS)[number]

/** True when the same layout runs three slides in a row anywhere in `layouts`. */
export function hasLayoutRun(layouts: string[], run = 3): boolean {
  return layouts.some((_, i) => i >= run - 1 && layouts.slice(i - run + 1, i + 1).every((l) => l === layouts[i]))
}

/** Roles whose content is a contrast -- the only middle slides drawn as a split. */
const SPLIT_ROLES = /comparison|compare|versus|\bvs\b|mistake|myth/i
/** Payoffs built from contrasts: a 2-point slide in one is a contrast pair. */
const CONTRAST_PAYOFFS = new Set(["before_after", "mistake_fix", "myth_truth"])
/** A pair that reads as a contrast on its own (before / after, old way / new way, myth / reality). */
const CONTRAST_WORDS = /\b(before|after|old way|new way|old|new|myth|reality|truth|fact|wrong|right|instead|vs\.?|versus|mistake|fix)\b/i

/** Whether a middle slide's content is a contrast: its role, or exactly 2 contrast points. */
export function isContrastSlide(slide: Record<string, unknown>, payoffType?: unknown): boolean {
  if (typeof slide.role === "string" && SPLIT_ROLES.test(slide.role)) return true
  const points = Array.isArray(slide.points) ? slide.points.filter((p): p is string => typeof p === "string" && !!p.trim()) : []
  if (points.length !== 2) return false
  return CONTRAST_PAYOFFS.has(String(payoffType ?? "")) || points.some((p) => CONTRAST_WORDS.test(p)) || CONTRAST_WORDS.test(String(slide.headline ?? ""))
}

/**
 * Each slide's layout from the slide itself: the hook and CTA full; a
 * contrast slide split; every other middle slide alternating full / type,
 * starting "full" on slide 2. A run of three is broken at its middle slide
 * (a split becomes type -- never a new split).
 */
export function carouselLayoutsFor(slides: Record<string, unknown>[], payoffType?: unknown): CarouselLayout[] {
  const n = slides.length
  let next: CarouselLayout = "full"
  const layouts = slides.map((s, i): CarouselLayout => {
    if (i === 0 || (i === n - 1 && n > 1)) return "full"
    if (isContrastSlide(s, payoffType)) return "split"
    const layout = next
    next = next === "full" ? "type" : "full"
    return layout
  })
  for (let i = 2; i < n; i++) {
    const mid = i - 1
    if (mid === 0 || mid === n - 1 || !hasLayoutRun(layouts.slice(i - 2, i + 1))) continue
    layouts[mid] = layouts[mid] === "type" ? "full" : "type"
  }
  return layouts
}

/** Slide i of n: the hook, the middle slides by their layout (type -> type-led, else photo-led), then the CTA. */
export function carouselFrameFor(index: number, count: number, layout: CarouselLayout): CarouselFrame {
  if (index === 0) return "hook"
  if (index === count - 1 && count > 1) return "cta"
  return layout === "type" ? "slide_type" : "slide_photo"
}

/**
 * Every slide gets a photo for its point -- a type-led slide shows it as a
 * crop. Only when that photo can't show the point does a type-led slide fall
 * back to a detail of the product photo, then to the brand-colour band.
 */
export function carouselFrameNeedsPhoto(frame: unknown): boolean {
  return isCarouselFrame(frame) || frame == null
}

/** Listicles number their items ("02" on the second tip); no other carousel shows numerals. */
export const LISTICLE_PAYOFFS = ["ways", "mini_guide"] as const
export const isListicle = (payoffType: unknown): boolean => (LISTICLE_PAYOFFS as readonly unknown[]).includes(payoffType)

const TRAILING = /^(?:and|or|but|the|a|an|of|to|for|with|in|on|at|by|your|our|is|are|that|this)$/i

/** First `max` words, never ending on a dangling joiner or punctuation. A
 * cut lands on the last phrase break when there is one ("Pick the look, own
 * it" -> "Pick the look", never "Pick the look, own"). */
export function clampSlideWords(s: unknown, max: number): string {
  if (typeof s !== "string") return ""
  const all = s.replace(/\s+/g, " ").trim().split(" ").filter(Boolean)
  let words = all.slice(0, max)
  if (all.length > max) {
    const brk = words.slice(0, -1).findLastIndex((w) => /[,;:.!?\-–—]$/.test(w))
    if (brk >= 1) words = words.slice(0, brk + 1)
  }
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
- "big_words": 1-${CAROUSEL_BIG_WORDS_MAX} words, drawn huge -- THIS slide's concrete point in the fewest words (e.g. "Roll the hem once", "Olive + white tee"), never a generic label ("Style it", "Yours next", "Learn more", "The secret"). The topic's own words when short. Never a number, price or claim the brand facts or topic don't give.
- "body": ONE line, max ${CAROUSEL_BODY_MAX} words -- the slide's new information. No paragraphs, no lists. The cover's "body" is a teaser of at most ${CAROUSEL_SCRIPT_LINE_MAX} words (it's handwritten).
- cta_slide: "cta" is the button, max ${CAROUSEL_CTA_LABEL_MAX} words (the action, e.g. "Shop the drop").`
}

/**
 * Stamps every slide with its frame, a seed and the sequence-level tape /
 * brand-mark choices, and writes the frame copy into the fields the builder
 * edits: headline = big words, subtext = the body line (or the handwritten
 * line on the hook / CTA), points emptied (no lists on a frame). `seedBase`
 * keeps a regenerate from drawing the same rotations. Each slide's layout
 * comes from its own role / points and the plan's payoff_type.
 */
export function finalizeCarouselFrames(slides: Record<string, unknown>[], opts: { ctaPhrase?: string | null; seedBase?: number; listicle?: boolean; payoffType?: unknown } = {}): Record<string, unknown>[] {
  const count = slides.length
  const seedBase = opts.seedBase ?? Math.floor(Math.random() * 2 ** 20)
  // Decided before the points are emptied below -- a contrast pair is one.
  const layouts = carouselLayoutsFor(slides, opts.payoffType)
  return slides.map((s, i) => {
    const frame = carouselFrameFor(i, count, layouts[i]!)
    // No words at all: the slide's own line, never a generic label.
    const bigWords = bigWordsFor(s) || clampSlideWords(s.headline, CAROUSEL_BIG_WORDS_MAX) || clampSlideWords(str(s.body) || str(s.subtext), CAROUSEL_BIG_WORDS_MAX) || "More"
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
      layout_hint: layouts[i],
      // A listicle's middle slides are its items, in order: slide 2 is item 1.
      list_index: opts.listicle && frame !== "hook" && frame !== "cta" ? i : null,
    }
  })
}
