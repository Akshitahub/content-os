import type { BrandRow, ProductRow } from "@/types/database"
import { annotatedContext, calloutGrounded } from "./annotated-product"

/**
 * Story frames: every story frame is a full-bleed photo with type layered on
 * it, drawn by lib/image/story-frame-compositor.ts from these per-frame
 * fields instead of a headline + body:
 * - hook: 1-3 huge display words + one short handwritten script line;
 * - offer: a round badge with a REAL number/discount + a short display line;
 * - product: the photo + 2 handwritten callouts with arrows + a torn-tape label;
 * - proof: an Instagram-style text box with a short REAL customer quote;
 * - cta: an IG-style pill button + a hand-drawn arrow.
 * The model picks the middle frames from those this story's data allows
 * (allowedMiddleFrames); finalizeStoryFrames enforces it all in code --
 * order (hook first, cta last), word limits, offer numbers and proof quotes
 * that must come from the topic / product, grounded callouts -- and mirrors
 * the copy into text / subtext so everything that reads only those (fact
 * guard, quality gate, captions, copy-all, old exports) keeps working.
 */

export const STORY_FRAMES = ["hook", "offer", "product", "proof", "cta"] as const
export type StoryFrame = (typeof STORY_FRAMES)[number]

export const BIG_WORDS_MAX = 3
export const SCRIPT_LINE_MAX = 6
export const CALLOUT_MAX_WORDS = 4
export const BADGE_MAX_WORDS = 3
/** The button names the action plus the offer when there is one -- "Grab yours at 40% off". */
export const CTA_LABEL_MAX = 5
/** A topic this short is its own core phrase -- the hook must say it ("Bday sale" -> "BDAY SALE"). */
export const TOPIC_CORE_MAX_WORDS = 3
/** No sentence over this many words anywhere in a story frame. */
export const SENTENCE_MAX = 8

/** The per-frame copy (persisted on each StorySlide). */
export interface StoryFrameFields {
  frame?: StoryFrame | null
  big_words?: string | null
  script_line?: string | null
  badge?: string | null
  callouts?: string[] | null
  quote?: string | null
  cta_label?: string | null
  /** Per-frame seed for the compositor's small rotations / offsets / grain -- renders are reproducible. */
  seed?: number | null
  /** Draw a tape strip on this frame (decided once per sequence, so a frame renders the same alone). */
  tape?: boolean | null
  /** Draw the brand's logo / name on this frame -- the opening hook and the cta, decided once per sequence. */
  brand_mark?: boolean | null
}

export interface StoryFrameContext {
  /** The user's topic -- the only source of offer numbers (with the product) and proof quotes. */
  topic: string
  /** Product + brand facts a callout may draw on (annotatedContext). */
  calloutSource: string
  hasProduct: boolean
  /** The picked product's name -- the product frame's label when the model's isn't grounded. */
  productName: string | null
  /** Numbers the offer badge may show: in the topic or the product's own data. */
  numberSource: string
  /** The brand's CTA phrase, the cta frame's default button label. */
  ctaPhrase: string
  /** The topic's own words when it's short (<= TOPIC_CORE_MAX_WORDS) -- the hook must contain them. */
  topicCore: string | null
}

export function storyFrameContext(brand: BrandRow, product: ProductRow | null, topic: string): StoryFrameContext {
  const b = brand as BrandRow & { cta_phrase?: string | null }
  const productNumbers = product ? [product.name, product.description, product.price != null ? `${product.price}` : "", ...(product.key_benefits ?? [])].filter(Boolean).join(" ") : ""
  return {
    topic,
    calloutSource: annotatedContext(brand, product).sourceText,
    hasProduct: !!product,
    productName: product?.name?.trim() || null,
    numberSource: `${topic} ${productNumbers}`,
    ctaPhrase: b.cta_phrase?.trim() || "Shop now",
    topicCore: topicCorePhrase(topic),
  }
}

/** The topic itself when it's a short phrase ("Bday sale", "new launch"), else null. */
export function topicCorePhrase(topic: string): string | null {
  const words = (topic.trim().replace(/[.!?,;:]+$/, "").match(/\S+/g) ?? [])
  return words.length > 0 && words.length <= TOPIC_CORE_MAX_WORDS ? words.join(" ") : null
}

const wordsOf = (s: string | null | undefined) => (s?.trim().match(/\S+/g) ?? [])
const clampWords = (s: string | null | undefined, max: number) => wordsOf(s).slice(0, max).join(" ").replace(/[,;:\-–—]+$/, "")
const normalize = (s: string) => s.toLowerCase().replace(/[“”"'‘’]/g, "").replace(/\s+/g, " ").trim()
const numbersIn = (s: string) => (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", "."))

/** Quotes the user typed into the topic ("..." or “...”), 2+ words -- the only real reviews a story can quote. */
export function topicQuotes(topic: string): string[] {
  return [...topic.matchAll(/["“]([^"”]{4,200})["”]/g)].map((m) => m[1]!.trim()).filter((q) => wordsOf(q).length >= 2)
}

/** The middle frames this story's own data allows (hook is always allowed). */
export function allowedMiddleFrames(ctx: StoryFrameContext): StoryFrame[] {
  const out: StoryFrame[] = ["hook"]
  if (numbersIn(ctx.numberSource).length > 0) out.push("offer")
  if (ctx.hasProduct) out.push("product")
  if (topicQuotes(ctx.topic).some((q) => wordsOf(q).length <= SENTENCE_MAX)) out.push("proof")
  return out
}

/** The frame order: hook first, cta last, the middle frames from what's allowed. */
export function frameSlots(count: number, allowed: StoryFrame[]): string[] {
  if (count <= 1) return ["hook"]
  if (count === 2) return ["hook", "cta"]
  return ["hook", ...Array(count - 2).fill(allowed.join(" | ")), "cta"]
}

/** The FRAME COPY section of the story prompt. */
export function storyFrameRules(ctx: StoryFrameContext, count: number): string {
  const allowed = allowedMiddleFrames(ctx)
  return `FRAMES — every frame is a full-screen photo with a few words layered on it, like a real Instagram story from a good brand. Frame order: ${frameSlots(count, allowed).map((f, i) => `${i + 1}: ${f}`).join(", ")}.
Each story object has a "frame" and ONLY that frame's fields:
- hook: "big_words" (1-${BIG_WORDS_MAX} words, huge on screen) + "script_line" (a handwritten aside, max ${SCRIPT_LINE_MAX} words).${ctx.topicCore ? ` The hook's big_words MUST contain the topic's own words "${ctx.topicCore}" (e.g. topic "Bday sale" -> "Bday sale", not just "Birthday").` : ""}
${allowed.includes("offer") ? `- offer: "badge" (the real number or discount, max ${BADGE_MAX_WORDS} words, e.g. "30% OFF" -- ONLY a number that appears in the topic or product data above) + "big_words" (max ${BIG_WORDS_MAX} words) + optional "script_line".\n` : ""}${allowed.includes("product") ? `- product: "big_words" (max ${BIG_WORDS_MAX} words, e.g. the product's name -- it goes on a tape label) + "callouts": exactly 2 short handwritten notes (max ${CALLOUT_MAX_WORDS} words each) naming real facts from the product / brand context above.\n` : ""}${allowed.includes("proof") ? `- proof: "quote" -- copied word for word from the customer quote in the topic (max ${SENTENCE_MAX} words), never invented or reworded.\n` : ""}- cta: "big_words" (max ${BIG_WORDS_MAX} words) + "cta_label" (the button, max ${CTA_LABEL_MAX} words: the action plus the offer when there is one -- "Shop the sale", "Grab yours at 40% off" -- never a bare "${ctx.ctaPhrase}" when the story has an offer) + optional "script_line" (max ${SCRIPT_LINE_MAX} words).
Rules:
- EVERY frame except proof has its own "big_words", and no two frames repeat the same big_words -- each one moves the story on (a detail, a feeling, a reason to care).
- No sentence over ${SENTENCE_MAX} words anywhere. Fragments beat sentences.
- Never invent a number, date, price or discount${allowed.includes("offer") ? "" : " -- this story has none, so there is no offer frame"}. ${allowed.includes("proof") ? "" : "There are no real customer quotes for this story, so there is no proof frame. "}Never invent a review.
- No exclamation marks, hashtags or emojis.
- Each frame says something the previous one didn't.`
}

const EXAMPLE_BY_FRAME: Record<StoryFrame, Record<string, unknown>> = {
  hook: { frame: "hook", big_words: "Bday week", script_line: "and you're invited" },
  offer: { frame: "offer", badge: "30% OFF", big_words: "Everything", script_line: "till Sunday" },
  product: { frame: "product", big_words: "Meet Glow", callouts: ["hand-poured soy wax", "burns 40 hours"] },
  proof: { frame: "proof", quote: "my room smells like home now" },
  cta: { frame: "cta", big_words: "Don't miss it", cta_label: "Shop the sale", script_line: "link's right here" },
}

/** One example frame object for a slot (its first allowed frame). */
export function exampleFrameFields(slot: string): Record<string, unknown> {
  const frame = (slot.split(" | ").find((f) => f !== "hook") ?? slot.split(" | ")[0]) as StoryFrame
  return EXAMPLE_BY_FRAME[frame] ?? EXAMPLE_BY_FRAME.hook
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")

/**
 * Enforces the frame rules in code and mirrors the copy into text/subtext.
 * Idempotent (safe to run after the fact guard / quality gate again). A
 * frame whose data doesn't hold up becomes a hook: an offer without a real
 * number, a product without 2 grounded callouts, a proof without a verbatim
 * topic quote.
 */
export function finalizeStoryFrames(stories: Record<string, unknown>[], ctx: StoryFrameContext): Record<string, unknown>[] {
  const allowed = allowedMiddleFrames(ctx)
  const sourceNumbers = new Set(numbersIn(ctx.numberSource))
  const quotes = topicQuotes(ctx.topic).map(normalize)
  const baseSeed = stories.find((s) => typeof s.seed === "number")?.seed as number | undefined ?? Math.floor(Math.random() * 2 ** 30)
  const last = stories.length - 1

  const out = stories.map((s, i) => {
    let frame: StoryFrame = STORY_FRAMES.includes(s.frame as StoryFrame) ? (s.frame as StoryFrame) : "hook"
    if (i === 0) frame = "hook"
    else if (i === last && stories.length >= 2) frame = "cta"
    else if (frame === "cta" || !allowed.includes(frame)) frame = "hook"

    // Fallback display words, from any copy the model gave this frame (a
    // downgraded product / proof / offer frame keeps its own words) -- the
    // topic only as the very last resort.
    const firstCallout = Array.isArray(s.callouts) ? str(s.callouts[0]) : ""
    const fallbackWords = clampWords(str(s.big_words) || str(s.text) || str(s.headline) || firstCallout || str(s.quote) || str(s.badge) || str(s.script_line) || ctx.topic, BIG_WORDS_MAX)
    let bigWords = clampWords(str(s.big_words), BIG_WORDS_MAX) || fallbackWords
    const secondCallout = Array.isArray(s.callouts) ? str(s.callouts[1]) : ""
    const scriptLine = clampWords(str(s.script_line) || (frame === "hook" ? str(s.subtext) || secondCallout : ""), SCRIPT_LINE_MAX)
    let badge = ""
    let callouts: string[] = []
    let quote = ""
    let ctaLabel = ""

    if (frame === "offer") {
      badge = clampWords(str(s.badge), BADGE_MAX_WORDS)
      const nums = numbersIn(badge)
      if (!badge || nums.length === 0 || !nums.every((n) => sourceNumbers.has(n))) { frame = "hook"; badge = "" }
    }
    if (frame === "product") {
      callouts = (Array.isArray(s.callouts) ? s.callouts : [])
        .map((c) => clampWords(str(c), CALLOUT_MAX_WORDS))
        .filter((c) => c && calloutGrounded(c, ctx.calloutSource))
        .slice(0, 2)
      if (callouts.length < 2) { frame = "hook"; callouts = [] }
      // The label names the real product -- never a name the model made up.
      else if (!calloutGrounded(bigWords, ctx.calloutSource) && ctx.productName) bigWords = clampWords(ctx.productName, BIG_WORDS_MAX)
    }
    if (frame === "proof") {
      quote = str(s.quote)
      const ok = quote && wordsOf(quote).length <= SENTENCE_MAX && quotes.some((q) => q.includes(normalize(quote)))
      if (!ok) { frame = "hook"; quote = "" }
    }
    if (frame === "cta") ctaLabel = clampWords(str(s.cta_label), CTA_LABEL_MAX) || clampWords(ctx.ctaPhrase, CTA_LABEL_MAX)
    if (frame === "hook" && !bigWords) bigWords = fallbackWords
    // The first hook says the topic's own words when the topic is short.
    if (i === 0 && ctx.topicCore && !normalize(bigWords).includes(normalize(ctx.topicCore))) bigWords = clampWords(ctx.topicCore, BIG_WORDS_MAX)

    const primary = frame === "proof" ? quote : bigWords
    const secondary = frame === "offer" ? [badge, scriptLine].filter(Boolean).join(", ") : frame === "product" ? callouts.join(", ") : frame === "cta" ? [ctaLabel, scriptLine].filter(Boolean).join(", ") : scriptLine
    return {
      ...s,
      frame,
      big_words: frame === "proof" ? null : bigWords,
      script_line: scriptLine || null,
      badge: badge || null,
      callouts: callouts.length ? callouts : null,
      quote: quote || null,
      cta_label: ctaLabel || null,
      seed: typeof s.seed === "number" ? s.seed : (baseSeed + i * 7919) % 2 ** 30,
      // Frames carry no poll; text_position stays valid for older readers.
      has_poll: false,
      poll_options: undefined,
      text_position: s.text_position === "top" || s.text_position === "bottom" ? s.text_position : "center",
      text: primary || bigWords || "Story",
      subtext: secondary,
    }
  })

  // The cta's button names the offer when the story has a real one: an offer
  // badge whose number the label doesn't already carry is appended.
  const offerBadge = out.find((s) => s.frame === "offer" && typeof s.badge === "string")?.badge as string | undefined
  const withOffer = out.map((s) => {
    if (s.frame !== "cta" || !offerBadge || typeof s.cta_label !== "string") return s
    const label = s.cta_label
    if (numbersIn(offerBadge).every((n) => numbersIn(label).includes(n))) return s
    const action = clampWords(label, CTA_LABEL_MAX - wordsOf(offerBadge).length - 1) || "Shop"
    const ctaLabel = `${action} at ${offerBadge.toLowerCase()}`
    return { ...s, cta_label: ctaLabel, subtext: [ctaLabel, s.script_line].filter(Boolean).join(", ") }
  })

  // A tape strip on at least one frame: the product frame's torn-tape label
  // counts; without one, the hook gets a strip.
  const hasProductFrame = withOffer.some((s) => s.frame === "product")
  return withOffer.map((s, i) => ({ ...s, tape: s.frame === "product" || (!hasProductFrame && i === 0), brand_mark: i === 0 || s.frame === "cta" }))
}
