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

export interface ContentQualityIssue {
  /** Machine-readable reason, for logging/metrics. */
  code: "leaked_symbol" | "bracket_placeholder" | "template_artifact" | "literal_js_artifact" | "stray_x"
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
  return ` ${text} `
    .replace(new RegExp(LEAKED_SYMBOL_RE, "g"), "")
    .replace(new RegExp(TEMPLATE_ARTIFACT_RE, "g"), "")
    .replace(new RegExp(STRAY_X_RE, "g"), " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}
