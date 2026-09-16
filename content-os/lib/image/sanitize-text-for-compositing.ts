// The curated fonts (lib/design/fonts.ts — Anton, Inter, Playfair Display,
// Quicksand, Caveat) are all shipped via @fontsource Latin SUBSETS, which
// don't include glyphs for typographic punctuation LLM output commonly
// produces (en/em dashes, curly quotes, ellipsis, etc.) -- resvg-js has no
// fallback font to borrow a glyph from, so a missing character renders as a
// tofu box (a real, confirmed defect on published posts: a boxed-X
// replacing a hyphen in compound words like "on-brand"). Mapped to their
// plain-ASCII equivalents, which every one of these fonts does have.
const TYPOGRAPHIC_REPLACEMENTS: Record<string, string> = {
  "‐": "-", // hyphen ‐
  "‑": "-", // non-breaking hyphen ‑
  "‒": "-", // figure dash ‒
  "–": "-", // en dash –
  "—": "-", // em dash —
  "―": "-", // horizontal bar ―
  "−": "-", // minus sign −
  "•": "-", // bullet •
  "·": "-", // middle dot ·
  "“": "\"", // left double quotation mark “
  "”": "\"", // right double quotation mark ”
  "„": "\"", // double low-9 quotation mark „
  "«": "\"", // left guillemet «
  "»": "\"", // right guillemet »
  "‘": "'", // left single quotation mark ‘
  "’": "'", // right single quotation mark ’
  "‚": "'", // single low-9 quotation mark ‚
  "‹": "'", // single left guillemet ‹
  "›": "'", // single right guillemet ›
  "′": "'", // prime ′
  "″": "\"", // double prime ″
  "…": "...", // horizontal ellipsis …
  "×": "x", // multiplication sign ×
}

const TYPOGRAPHIC_PATTERN = new RegExp(`[${Object.keys(TYPOGRAPHIC_REPLACEMENTS).join("")}]`, "g")

/**
 * Replaces typographic Unicode punctuation with the plain-ASCII
 * equivalents every curated compositor font actually has glyphs for --
 * en/em dashes and other dash-like characters to a plain hyphen, every
 * curly/smart quote variant to a straight one, the ellipsis character to
 * three periods, and a handful of other characters LLM output commonly
 * produces (bullets, primes, guillemets, the multiplication sign).
 *
 * Deliberately the ONLY place this runs -- call this right before handing
 * text to a compositor's own text-drawing/measuring code (fitText,
 * wrapText, a <text> element), never earlier in the pipeline (generation,
 * saving to the database, API responses). The raw AI/user text stays
 * completely untouched everywhere else -- this exists purely to keep a
 * font's missing glyphs from ever reaching a rasterized image, not to
 * "clean up" text in general.
 */
export function sanitizeTextForCompositing(text: string): string {
  return text.replace(TYPOGRAPHIC_PATTERN, (ch) => TYPOGRAPHIC_REPLACEMENTS[ch] ?? ch)
}
