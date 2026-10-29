// Lightweight sanity check run on every piece of LLM-generated user-facing
// text (captions, hooks, carousel/story slide copy, ad copy, blog posts)
// right before it's returned to the client or saved — a backstop against
// template/instruction leakage, not a replacement for prompt quality.
//
// Root cause this exists to guard against: this codebase's own system
// prompts use "✓"/"✗" as GOOD/BAD example bullet markers (see
// lib/ai/prompts.ts's buildHookSystemPrompt/buildCaptionSystemPrompt and
// app/api/v1/ai/carousel/generate/route.ts's COVER HOOK GUIDANCE) — those
// two symbols have now been replaced with plain "GOOD:"/"BAD:" text labels
// in every prompt that had them, since an LLM occasionally echoes a
// formatting artifact from its own few-shot examples into unrelated
// generated output (a well-documented class of instruction-following
// failure, distinct from the model just writing worse copy). The checks
// below are a second, independent layer of defense: even a prompt this
// codebase doesn't control directly (a future addition, a prompt fetched
// from elsewhere) gets caught here before its output ships.

const LEAKED_SYMBOL_RE = /[✓✗]/
const BRACKET_PLACEHOLDER_RE = /\[(?:Name|Age|Year|Date|Number|Price|City|Brand|Product|Insert[^\]]*)\]/i
const TEMPLATE_ARTIFACT_RE = /\$\{[^}]*\}|\{\{[^}]*\}\}/
const LITERAL_JS_ARTIFACT_RE = /\b(?:undefined|NaN|\[object Object\])\b/

// Matches a standalone "x"/"X" token that ISN'T a legitimate quantity/
// multiplier use (e.g. "3 x 40g", "6x4 inch") -- those always have a digit
// immediately before or after (allowing one optional space), so this only
// flags an "x" with no numeral anywhere near it, the actual leaked-
// placeholder shape reported in production.
const STRAY_X_RE = /(?<![\dxX])\s[xX]\s(?![\dxX])/

// A colour hex code as a whole token: "#" + exactly 3 or 6 hex characters
// with at least one digit -- "#f5f5f5", "#a1b2c3". The digit rule keeps real
// hashtags that happen to be hex letters (#cafe, #face, #beef, #FFF);
// Instagram turns a hex code in a caption into a clickable hashtag.
const HEX_CODE_RE = /(?<![\w#&])#(?=[0-9a-fA-F]*\d)(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?!\w)/

/** True for "f5f5f5" / "#a1b" style colour codes (3 or 6 hex chars, at least one digit). */
export function isHexColourCode(token: string): boolean {
  const t = token.replace(/^#+/, "")
  return /^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(t) && /\d/.test(t)
}

export interface ContentQualityIssue {
  /** Machine-readable reason, for logging/metrics. */
  code: "leaked_symbol" | "bracket_placeholder" | "template_artifact" | "literal_js_artifact" | "stray_x" | "hex_code"
  /** Human-readable, model-facing correction instruction — usable directly
   * in a retry prompt the same way caption-validation.ts's validateCaption
   * issues already are. */
  message: string
}

/**
 * Scans a single piece of generated text for obvious leakage/artifact
 * patterns. Returns an empty array for clean text. Deliberately narrow and
 * fast (plain regex, no LLM call, no dictionary) — this is a backstop for
 * gross failures, not a grammar or spell checker.
 */
export function findContentQualityIssues(text: string | null | undefined): ContentQualityIssue[] {
  if (!text) return []
  const issues: ContentQualityIssue[] = []

  if (LEAKED_SYMBOL_RE.test(text)) {
    issues.push({ code: "leaked_symbol", message: `Your text contains a stray "✓" or "✗" symbol — remove it, these are formatting markers and never belong in real output.` })
  }
  if (BRACKET_PLACEHOLDER_RE.test(text)) {
    const match = text.match(BRACKET_PLACEHOLDER_RE)?.[0]
    issues.push({ code: "bracket_placeholder", message: `Your text contains an unfilled placeholder like "${match}" — write actual, complete text instead, never a bracketed template variable.` })
  }
  if (TEMPLATE_ARTIFACT_RE.test(text)) {
    issues.push({ code: "template_artifact", message: `Your text contains a raw template expression (e.g. "\${...}" or "{{...}}") — this must never appear in real output.` })
  }
  if (LITERAL_JS_ARTIFACT_RE.test(text)) {
    issues.push({ code: "literal_js_artifact", message: `Your text contains the literal word "undefined", "NaN", or "[object Object]" — write real content instead.` })
  }
  if (STRAY_X_RE.test(` ${text} `)) {
    issues.push({ code: "stray_x", message: `Your text contains a stray standalone "x" character with no number attached to it — remove it or, if you meant a quantity (e.g. "3 x 40g"), include the actual numbers.` })
  }
  if (HEX_CODE_RE.test(text)) {
    const match = text.match(HEX_CODE_RE)?.[0]
    issues.push({ code: "hex_code", message: `Your text contains the colour code "${match}" — describe the colour in words instead ("off-white", "soft grey", "deep teal") and never write colour codes; Instagram turns them into hashtags.` })
  }

  return issues
}

/**
 * Mechanical last-resort cleanup for the same patterns
 * findContentQualityIssues detects — used when a retry isn't available or
 * didn't fully resolve the issue (mirrors caption-validation.ts's
 * applyLastResortFixes: fix rather than silently ship broken text, but
 * loudly, never as a silent success). Strips/collapses rather than
 * rejecting outright, since a caption missing a couple of stray characters
 * is still far more usable than no caption at all.
 */
export function sanitizeLeakedArtifacts(text: string): string {
  // Padded with a space on each side so a stray "x" sitting right at the
  // start/end of the real text (no natural space to anchor
  // STRAY_X_RE's \s...\s pattern against) still gets caught, same as
  // findContentQualityIssues already does for detection.
  let out = ` ${text} `
    .replace(new RegExp(LEAKED_SYMBOL_RE, "g"), "")
    .replace(new RegExp(TEMPLATE_ARTIFACT_RE, "g"), "")
    .replace(new RegExp(STRAY_X_RE, "g"), " ")
  // Colour hex codes: dropped, then only the phrase each one left behind is
  // tidied -- a preposition dangling right before it and the space before
  // the punctuation that follows ("hue to #f5f5f5." -> "hue."). A marker
  // keeps the tidy at the removed code's position, never elsewhere.
  if (HEX_CODE_RE.test(out)) {
    out = out
      .replace(new RegExp(HEX_CODE_RE, "g"), "\u0000")
      .replace(/\s+(?:to|in|into|of|with|as|like|at|on|is|are)\s+\u0000(?=\s*(?:[.,!?;:]|$))/gi, "\u0000")
      .replace(/\s*\u0000\s*(?=[.,!?;:])/g, "")
      .replace(/\u0000/g, "")
  }
  return out.replace(/[ \t]{2,}/g, " ").trim()
}

const MAX_HASHTAG_LENGTH = 30

/**
 * Generated hashtags, finalised: leading #s stripped, only letters (with
 * their combining marks, so "दिवाली" survives), digits and underscores kept
 * ("Diwali Sale" -> "DiwaliSale"), and entries dropped
 * when empty, purely numeric, a colour hex code (isHexColourCode) or longer
 * than 30 characters. Deduped case-insensitively, order kept. Generated copy
 * only -- never applied to what a user typed.
 */
export function normalizeHashtags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of raw) {
    if (typeof entry !== "string") continue
    const tag = entry.replace(/^\s*#+/, "").replace(/[^\p{L}\p{M}\p{N}_]/gu, "")
    if (!tag || /^\d+$/.test(tag) || isHexColourCode(tag) || tag.length > MAX_HASHTAG_LENGTH) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out
}
