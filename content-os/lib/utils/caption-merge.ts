// Ensures a post's hook and call-to-action survive into caption_text — the
// only field publish-scheduled/route.ts actually sends to Instagram/Facebook.
// Some generation paths (lib/ai/prompts.ts's caption prompt) already mandate
// that the model restate the hook and close with the CTA inside caption_text
// itself; others (lib/ai/fastlane.ts's per-slot prompt) don't. Rather than
// trust either to have complied, every save point runs the same redundancy
// check and merges only what's actually missing.

const STOPWORD_MIN_LENGTH = 4

function significantWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= STOPWORD_MIN_LENGTH)
  )
}

// Fraction of `snippet`'s significant words that already appear in `withinText`.
function overlapRatio(snippet: string, withinText: string): number {
  const snippetWords = significantWords(snippet)
  if (snippetWords.size === 0) return 0
  const withinWords = significantWords(withinText)
  let shared = 0
  for (const w of snippetWords) if (withinWords.has(w)) shared++
  return shared / snippetWords.size
}

const HOOK_REDUNDANCY_THRESHOLD = 0.4
const CTA_REDUNDANCY_THRESHOLD = 0.35

/**
 * Prepends `hookText` as the opening line and appends `callToAction` as the
 * closing line of `captionText`, skipping either when the caption already
 * covers it (checked against the caption's own opening/closing, not the
 * whole body, so a CTA-shaped sentence buried mid-caption doesn't count).
 */
export function mergeCaptionWithHookAndCta(
  captionText: string,
  hookText?: string | null,
  callToAction?: string | null
): string {
  let result = captionText.trim()

  const hook = hookText?.trim()
  if (hook) {
    const opening = result.slice(0, Math.max(hook.length * 2, 120))
    if (overlapRatio(hook, opening) < HOOK_REDUNDANCY_THRESHOLD) {
      result = `${hook}\n\n${result}`
    }
  }

  const cta = callToAction?.trim()
  if (cta) {
    const ending = result.slice(-Math.max(cta.length * 2, 120))
    if (overlapRatio(cta, ending) < CTA_REDUNDANCY_THRESHOLD) {
      result = `${result}\n\n${cta}`
    }
  }

  return result
}
