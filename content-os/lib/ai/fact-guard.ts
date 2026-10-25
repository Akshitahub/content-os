import type { BrandRow, ProductRow } from "@/types/database"

// Backstop for QUALITY_BAR's "FACTS ONLY" rule (lib/ai/prompts.ts): finds
// claim-bearing numbers in generated copy that don't appear anywhere in
// the facts the model was actually given (brand profile, product, the
// user's brief). Callers follow the same shape as caption-validation.ts:
// check -> retry once with an explicit correction -> if it still fails,
// strip the offending sentence rather than publish an invented claim.
//
// What counts as a "claim-bearing number" is deliberately narrower than
// "any digit": bare small counts that just describe the copy's own
// structure ("3 steps", "5 signs", "Day 2") are NOT flagged -- they're not
// factual claims, and stripping them would mangle ordinary listicle copy.
// Flagged: percentages, currency amounts, multipliers ("3x"), durations
// and rates ("2 minutes", "24 hours", "10 times"), magnitude words ("5k",
// "2 lakh"), ratios ("9 out of 10"), and any number of 100 or more
// ("10,000+ customers", "500 reviews", a founding year).

export type FactSource = { numbers: Set<string> }

const MAGNITUDE = "(?:k|lakhs?|crores?|cr|million|mn|bn|billion)"
const CLAIM_PATTERNS: RegExp[] = [
  // percentages: "41%", "41 percent"
  /\d[\d,]*(?:\.\d+)?\s*(?:%|percent\b|per cent\b)/gi,
  // currency: "₹799", "Rs. 499", "INR 2,000", "$10"
  new RegExp(`(?:₹|\\brs\\.?|\\binr|\\$|\\busd)\\s?\\d[\\d,]*(?:\\.\\d+)?(?:\\s?${MAGNITUDE}\\b)?`, "gi"),
  // multipliers: "3x", "2.5×"
  /\b\d+(?:\.\d+)?[x×](?![a-z])/gi,
  // magnitude words: "5k", "2 lakh", "1.2 million"
  new RegExp(`\\b\\d[\\d,]*(?:\\.\\d+)?\\+?\\s?${MAGNITUDE}\\b\\+?`, "gi"),
  // durations, rates and repetitions: "2 minutes", "24-hour", "10 times"
  /\b\d[\d,]*(?:\.\d+)?[\s-]*(?:times|hours?|hrs?|minutes?|mins?|seconds?|secs?|days?|weeks?|months?|years?|yrs?)\b/gi,
  // ratios: "9 out of 10", "1 in 3"
  /\b\d+\s+(?:out of|in)\s+\d+\b/gi,
  // any standalone number >= 100: "10,000+", "500", "2015"
  /\b\d{1,3}(?:,\d{2,3})+\+?|\b\d{3,}(?:\.\d+)?\+?/g,
]

function normalizeNumber(raw: string): string {
  const n = raw.replace(/,/g, "")
  return n.includes(".") ? n.replace(/\.?0+$/, "") : n
}

function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(normalizeNumber)
}

/** Every number found in the supplied facts -- the only numbers generated copy may use. */
export function buildFactSource(input: {
  brand?: Partial<BrandRow> | null
  product?: Partial<ProductRow> | null
  /** The user's own brief: topic, additional context, an edited hook, etc. */
  brief?: (string | null | undefined)[]
}): FactSource {
  const parts: string[] = []
  const b = input.brand
  if (b) {
    parts.push(
      b.name ?? "", b.description ?? "", b.niche ?? "", b.target_audience ?? "", b.tone_of_voice ?? "",
      b.ai_persona ?? "", b.cta_phrase ?? "", b.brand_personality ?? "", b.target_emotion ?? "",
      b.positioning ?? "", b.instagram_handle ?? "", b.website_url ?? "",
      ...(b.brand_values ?? []), ...(b.content_pillars ?? []),
    )
  }
  const p = input.product
  if (p) {
    parts.push(
      p.name ?? "", p.description ?? "", p.category ?? "", p.ingredients ?? "", p.target_customer ?? "",
      p.price != null ? String(p.price) : "", ...(p.key_benefits ?? []),
    )
  }
  for (const s of input.brief ?? []) if (s) parts.push(s)
  return { numbers: new Set(numbersIn(parts.join("\n"))) }
}

type ClaimSpan = { start: number; end: number; text: string }

// Hashtags, @handles and URLs never carry a claim -- blanked out (same
// length, so indices stay valid) before matching.
function maskNonClaims(text: string): string {
  return text.replace(/(?:#|@)[\w.]+|https?:\/\/\S+/g, (m) => " ".repeat(m.length))
}

function unsupportedSpans(text: string, facts: FactSource): ClaimSpan[] {
  const masked = maskNonClaims(text)
  const spans: ClaimSpan[] = []
  for (const pattern of CLAIM_PATTERNS) {
    for (const m of masked.matchAll(pattern)) {
      const start = m.index ?? 0
      const end = start + m[0].length
      const nums = numbersIn(m[0])
      if (nums.length === 0 || nums.every((n) => facts.numbers.has(n))) continue
      if (spans.some((s) => start < s.end && end > s.start)) continue
      spans.push({ start, end, text: text.slice(start, end).trim() })
    }
  }
  return spans.sort((a, b) => a.start - b.start)
}

/** Claim-bearing numbers in `text` that aren't in the supplied facts (empty = clean). */
export function findUnsupportedClaims(text: string, facts: FactSource): string[] {
  return unsupportedSpans(text, facts).map((s) => s.text)
}

// Sentence boundaries: a newline, or . ! ? followed by whitespace/end (so
// "2.5" and "Rs.799" don't split mid-number).
function sentenceRanges(text: string): [number, number][] {
  const ranges: [number, number][] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    const isEnd = c === "\n" || (/[.!?]/.test(c) && (i + 1 >= text.length || /\s/.test(text[i + 1]!)))
    if (isEnd) {
      ranges.push([start, i + 1])
      start = i + 1
    }
  }
  if (start < text.length) ranges.push([start, text.length])
  return ranges
}

function tidy(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.!?])/g, "$1")
    .replace(/^[ \t,;:-]+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/**
 * Removes every sentence that contains an unsupported claim. If that would
 * empty the text entirely (a one-line hook or headline), removes just the
 * claim itself instead (or returns "" if under two words would remain) --
 * the copy may read slightly thinner, but never publishes an invented
 * number.
 */
export function stripUnsupportedClaims(text: string, facts: FactSource): string {
  const spans = unsupportedSpans(text, facts)
  if (spans.length === 0) return text

  const kept = sentenceRanges(text).filter(([s, e]) => {
    if (text.slice(s, e) === "\n") return true
    return !spans.some((span) => span.start < e && span.end > s)
  })
  const bySentence = tidy(kept.map(([s, e]) => text.slice(s, e)).join(""))
  if (/[\p{L}\p{N}]/u.test(bySentence)) return bySentence

  let byClaim = text
  for (const span of [...spans].reverse()) byClaim = byClaim.slice(0, span.start) + byClaim.slice(span.end)
  const result = tidy(byClaim)
  // A one-word leftover ("in" from "in 2 weeks") is junk, not copy -- an
  // empty field is the safer thing to publish.
  return (result.match(/[\p{L}\p{N}]+/gu) ?? []).length >= 2 ? result : ""
}

// JSON keys that are never published copy (layout enums, ids, the image
// model's prompt, hashtags) -- skipped when walking a structured response.
const NON_COPY_KEYS = new Set([
  "hashtags", "image_prompt", "background", "background_style", "text_position", "type",
  "suggested_vibe", "suggested_template", "suggested_color_theme_id", "story_number",
  "slide_number", "has_poll", "handle", "id", "hook_type",
])

/** findUnsupportedClaims over every copy string inside a parsed JSON response. */
export function findUnsupportedClaimsIn(value: unknown, facts: FactSource): string[] {
  if (typeof value === "string") return findUnsupportedClaims(value, facts)
  if (Array.isArray(value)) return value.flatMap((v) => findUnsupportedClaimsIn(v, facts))
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => (NON_COPY_KEYS.has(k) ? [] : findUnsupportedClaimsIn(v, facts)))
  }
  return []
}

/** stripUnsupportedClaims over every copy string inside a parsed JSON response. */
export function stripUnsupportedClaimsIn<T>(value: T, facts: FactSource): T {
  if (typeof value === "string") return stripUnsupportedClaims(value, facts) as T
  if (Array.isArray(value)) return value.map((v) => stripUnsupportedClaimsIn(v, facts)) as T
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, NON_COPY_KEYS.has(k) ? v : stripUnsupportedClaimsIn(v, facts)])
    ) as T
  }
  return value
}

export const FACT_CORRECTION_PREFIX = "Your response used numbers or claims that are not in the brand/product facts"

/** The model-facing correction sent on the one retry. */
export function buildFactCorrection(claims: string[]): string {
  const unique = [...new Set(claims)]
  return `${FACT_CORRECTION_PREFIX} or the brief you were given: ${unique.map((c) => `"${c}"`).join(", ")}. Respond again with the SAME JSON schema. Remove each of these, or rewrite those lines so they don't need a number. Only use numbers that appear in the facts provided.`
}

// Logs counts only -- never the claims or copy themselves (generated text
// derived from the user's own brief).
export function logFactGuard(stage: string, action: "retry" | "strip", count: number): void {
  console.error(`[fact-guard] stage=${stage} unsupportedClaims=${count} action=${action}`)
}
