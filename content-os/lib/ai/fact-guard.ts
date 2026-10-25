import type { BrandRow, ProductRow } from "@/types/database"

// Backstop for QUALITY_BAR's "FACTS ONLY" rule (lib/ai/prompts.ts): finds
// claim-bearing numbers in generated copy that don't appear anywhere in
// the facts the model was actually given (brand profile, the picked
// product, the user's brief / extra context). Every generator runs this
// through guardCopy below: check -> retry once with an explicit
// correction (only if the time budget allows) -> strip whatever is still
// unsupported. Never fails a generation that already succeeded.
//
// RULES (applied in this order):
//
// SUPPORTED -- never flagged:
//   - any number that appears anywhere in the supplied facts: brand
//     profile fields, the picked product (name, description, price,
//     category, ingredients, key benefits, target customer), and every
//     brief string the caller passes (topic, extra context, offer/policy
//     text, the user's own edited hook...). Compared after normalizing
//     commas/trailing zeros ("1,299.00" == "1299"), and magnitude words
//     both ways ("5k" == "5000", "2 lakh" == "200000").
//
// ALLOWED -- blanked out before matching, so never flagged:
//   - hashtags, @handles, emails, URLs
//   - phone numbers (10-15 digits, optional +country code, spaces/dashes)
//   - years 1900-2099 -- EXCEPT a founding year ("since 2015",
//     "est. 2015", "founded in 2015"), which is a factual claim and must be
//     in the facts
//   - dates: "25 Oct", "Oct 25th", "25 October 2026", "25/10", "25/10/2026",
//     "2026-10-25" (this also covers "24/7")
//   - "24x7", "2-in-1" / "3 in 1"
//   - small bare numbers (< 100) with no unit or symbol: "3 steps",
//     "Day 2", "SPF 50", "IP68", "Vitamin B12"
//
// FLAGGED -- unless supported:
//   - percentages: "41%", "41 percent"
//   - currency amounts: "₹799", "Rs. 499", "INR 2,000", "$10"
//   - multipliers: "3x", "2.5×"
//   - magnitude words: "5k", "2 lakh", "1.2 million"
//   - durations / rates / repetitions: "2 minutes", "24-hour", "10 times"
//   - ratios: "9 out of 10", "1 in 3"
//   - any other number of 100 or more: "10,000+ customers", "500 reviews",
//     "SPF 100" (unless it's in the product's own name/description)

export type FactSource = { numbers: Set<string> }

const MAGNITUDE = "(?:k|lakhs?|crores?|cr|million|mn|bn|billion)"
const MAGNITUDE_MULTIPLIER: [RegExp, number][] = [
  [/^k$/i, 1e3],
  [/^lakhs?$/i, 1e5],
  [/^(?:crores?|cr)$/i, 1e7],
  [/^(?:million|mn)$/i, 1e6],
  [/^(?:bn|billion)$/i, 1e9],
]

const CLAIM_PATTERNS: RegExp[] = [
  /\d[\d,]*(?:\.\d+)?\s*(?:%|percent\b|per cent\b)/gi,
  new RegExp(`(?:₹|\\brs\\.?|\\binr|\\$|\\busd)\\s?\\d[\\d,]*(?:\\.\\d+)?(?:\\s?${MAGNITUDE}\\b)?`, "gi"),
  /\b\d+(?:\.\d+)?[x×](?![a-z\d])/gi,
  new RegExp(`\\b\\d[\\d,]*(?:\\.\\d+)?\\+?\\s?${MAGNITUDE}\\b\\+?`, "gi"),
  /\b\d[\d,]*(?:\.\d+)?[\s-]*(?:times|hours?|hrs?|minutes?|mins?|seconds?|secs?|days?|weeks?|months?|years?|yrs?)\b/gi,
  /\b\d+\s+(?:out of|in)\s+\d+\b/gi,
  /\b\d{1,3}(?:,\d{2,3})+\+?|\b\d{3,}(?:\.\d+)?\+?/g,
]

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?"
// Non-claim patterns, blanked out (same length, so indices stay valid)
// before CLAIM_PATTERNS run. Order matters only for readability -- each
// one is applied to the already-masked text.
const ALLOW_PATTERNS: { re: RegExp; accept?: (match: string) => boolean }[] = [
  { re: /https?:\/\/\S+/gi },
  { re: /[\w.+-]+@[\w-]+\.[\w.]+/g },
  { re: /(?:#|@)[\w.]+/g },
  // phone numbers: only a real phone-length digit run counts
  {
    re: /(?:\+\d{1,3}[\s-]?)?\b\d(?:[\s-]?\d){9,14}\b/g,
    accept: (m) => {
      const digits = m.replace(/\D/g, "").length
      return digits >= 10 && digits <= 15
    },
  },
  // dates
  { re: /\b(?:19|20)\d{2}-\d{1,2}-\d{1,2}\b/g },
  { re: /\b\d{1,2}[/.-]\d{1,2}(?:[/.-](?:19|20)?\d{2})?\b/g },
  { re: new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}(?:,?\\s+(?:19|20)\\d{2})?\\b`, "gi") },
  { re: new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+(?:19|20)\\d{2})?\\b`, "gi") },
  // years, except founding years
  { re: /(?<!\b(?:since|est\.?|estd\.?|established|founded|founded in|est\. in)\s+)\b(?:19|20)\d{2}\b(?![%+\d,.]|\s*(?:k|lakh|crore|million))/gi },
  { re: /\b24\s?x\s?7\b/gi },
  { re: /\b\d+\s*-?\s*in\s*-?\s*1\b/gi },
]

function maskAllowed(text: string): string {
  let masked = text
  for (const { re, accept } of ALLOW_PATTERNS) {
    masked = masked.replace(re, (m) => (accept && !accept(m) ? m : " ".repeat(m.length)))
  }
  return masked
}

function normalizeNumber(raw: string): string {
  const n = raw.replace(/,/g, "")
  return n.includes(".") ? n.replace(/\.?0+$/, "") : n
}

// One group per number occurrence in `text`: its normalized value, plus
// its magnitude-expanded value when followed by a magnitude word
// ("5k" -> ["5", "5000"]). A claim is supported only if EVERY group has a
// member in the facts -- so "9 out of 10" needs both 9 and 10.
function numberGroupsIn(text: string): string[][] {
  const groups: string[][] = []
  // No word boundary required after the digits themselves ("3x", "2.5x"
  // must still yield 3 / 2.5) -- only after a magnitude word.
  const re = new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)(?:\\+?\\s?(${MAGNITUDE})\\b)?`, "gi")
  for (const m of text.matchAll(re)) {
    const base = normalizeNumber(m[1]!)
    const group = [base]
    const word = m[2]
    if (word) {
      const mult = MAGNITUDE_MULTIPLIER.find(([r]) => r.test(word))?.[1]
      if (mult) group.push(normalizeNumber(String(Number(base) * mult)))
    }
    groups.push(group)
  }
  return groups
}

/** Every number found in the supplied facts -- the only numbers generated copy may use. */
export function buildFactSource(input: {
  brand?: Partial<BrandRow> | null
  product?: Partial<ProductRow> | null
  /** The user's own input: topic, extra context, offer/policy text, an edited hook, source content to repurpose... */
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
  return { numbers: new Set(numberGroupsIn(parts.join("\n")).flat()) }
}

type ClaimSpan = { start: number; end: number; text: string }

function unsupportedSpans(text: string, facts: FactSource): ClaimSpan[] {
  const masked = maskAllowed(text)
  const spans: ClaimSpan[] = []
  for (const pattern of CLAIM_PATTERNS) {
    for (const m of masked.matchAll(pattern)) {
      const start = m.index ?? 0
      const end = start + m[0].length
      const groups = numberGroupsIn(m[0])
      if (groups.length === 0 || groups.every((g) => g.some((n) => facts.numbers.has(n)))) continue
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
  for (const span of [...spans].reverse()) {
    let start = span.start
    // "Visible glow in 2 weeks." -> "Visible glow." rather than "...glow in."
    // -- only when the claim ends the sentence, so "Recommended by 250
    // dermatologists" keeps its "by".
    if (/^\s*(?:[.!?]|$)/.test(text.slice(span.end))) {
      const dangling = /\b(?:in|within|for|by|at|of|over|under|up to|just|only|about|around|nearly|almost)\s+$/i.exec(byClaim.slice(0, start))
      if (dangling) start = dangling.index
    }
    byClaim = byClaim.slice(0, start) + byClaim.slice(span.end)
  }
  const result = tidy(byClaim)
  // A one-word leftover ("in" from "in 2 weeks") is junk, not copy -- an
  // empty field is the safer thing to publish.
  return (result.match(/[\p{L}\p{N}]+/gu) ?? []).length >= 2 ? result : ""
}

// JSON keys that are never published copy (layout enums, ids, the image /
// video model's prompts, hashtags, tags, internal suggestions) -- skipped
// when walking a structured response.
const NON_COPY_KEYS = new Set([
  "hashtags", "image_prompt", "background", "background_style", "text_position", "type",
  "suggested_vibe", "suggested_template", "suggested_color_theme_id", "story_number",
  "slide_number", "has_poll", "handle", "id", "hook_type", "visual_direction",
  "audio_suggestion", "sticker_suggestion", "cta_button", "suggested_tags", "duration_seconds",
  "pattern_note", "reasoning",
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
export function logFactGuard(stage: string, action: "retry" | "strip" | "skip_retry", count: number): void {
  console.error(`[fact-guard] stage=${stage} unsupportedClaims=${count} action=${action}`)
}

// ─── Time budget ─────────────────────────────────────────────────────────
// The retry is one more model call. Routes with a hard maxDuration pass a
// `deadline` (epoch ms by which their text step must be done); the retry
// then gets at most the time left (minus a margin), or is skipped -- and
// the claim stripped instead -- when less than FACT_RETRY_MIN_MS remains.
const FACT_RETRY_MIN_MS = 8_000
const FACT_RETRY_MARGIN_MS = 3_000

/** Timeout to give the fact-guard retry, or null to skip it (strip instead). */
export function factRetryTimeoutMs(deadline: number | undefined, normalTimeoutMs: number): number | null {
  if (deadline === undefined) return normalTimeoutMs
  const remaining = deadline - Date.now() - FACT_RETRY_MARGIN_MS
  if (remaining < FACT_RETRY_MIN_MS) return null
  return Math.min(normalTimeoutMs, remaining)
}

function errorName(err: unknown): string {
  // Name only -- a JSON.parse message can quote the generated text.
  return err instanceof Error ? err.name : typeof err
}

/**
 * The one shared check -> retry -> strip cycle every generator uses.
 * `retry` makes the corrective call and returns the re-parsed result (or
 * throws -- an unparseable or failed retry just falls back to stripping the
 * first result). If anything in the guard itself throws, the original
 * result is returned stripped (or untouched if even that fails) -- a
 * generation that already succeeded never fails because of this check.
 */
export async function guardCopy<T>(params: {
  stage: string
  data: T
  facts: FactSource
  normalTimeoutMs: number
  deadline?: number
  retry: (correction: string, timeoutMs: number) => Promise<T>
}): Promise<T> {
  const { stage, facts } = params
  try {
    let data = params.data
    const claims = findUnsupportedClaimsIn(data, facts)
    if (claims.length === 0) return data

    const timeoutMs = factRetryTimeoutMs(params.deadline, params.normalTimeoutMs)
    if (timeoutMs === null) {
      logFactGuard(stage, "skip_retry", claims.length)
    } else {
      logFactGuard(stage, "retry", claims.length)
      try {
        data = await params.retry(buildFactCorrection(claims), timeoutMs)
      } catch (err) {
        console.error(`[fact-guard] stage=${stage} retry failed (${errorName(err)}), stripping the first result instead`)
      }
    }

    const remaining = findUnsupportedClaimsIn(data, facts)
    if (remaining.length === 0) return data
    logFactGuard(stage, "strip", remaining.length)
    return stripUnsupportedClaimsIn(data, facts)
  } catch (err) {
    console.error(`[fact-guard] stage=${stage} guard error (${errorName(err)}), returning the original result stripped`)
    return stripGuard(stage, params.data, facts)
  }
}

/** Strip-only variant (no retry possible, e.g. a regex-fallback parse) -- never throws. */
export function stripGuard<T>(stage: string, data: T, facts: FactSource): T {
  try {
    const claims = findUnsupportedClaimsIn(data, facts)
    if (claims.length === 0) return data
    logFactGuard(stage, "strip", claims.length)
    return stripUnsupportedClaimsIn(data, facts)
  } catch (err) {
    console.error(`[fact-guard] stage=${stage} strip failed (${errorName(err)}), returning the result unchanged`)
    return data
  }
}
