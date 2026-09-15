import { getGroqClient, MODELS } from "./models"
import type { RatedItem } from "./pattern-match"

// Bounds prompt size for a brand with a long rating history -- the most
// recent items in `rated` (callers already order by created_at desc, see
// captions/generate/route.ts) are the most relevant "what have I actually
// been posting lately" signal anyway.
const MAX_EXAMPLES_PER_GROUP = 8

function formatGroup(label: string, items: RatedItem[]): string {
  if (items.length === 0) return ""
  const lines = items.slice(0, MAX_EXAMPLES_PER_GROUP).map((r, i) => `${i + 1}. "${r.text}" (rated ${r.rating}/5)`).join("\n")
  return `${label}:\n${lines}`
}

function formatFeedbackNotes(notes: string[]): string {
  if (notes.length === 0) return ""
  const lines = notes.map((n, i) => `${i + 1}. "${n}"`).join("\n")
  return `This brand has previously flagged these specific issues with past drafts:\n${lines}`
}

function buildUserPrompt(newText: string, wellRated: RatedItem[], poorlyRated: RatedItem[], neutral: RatedItem[], feedbackNotes: string[]): string {
  // Neutral-only history (nothing rated clearly well or poorly yet) still
  // gives Groq real material to compare against, rather than sending it
  // nothing at all -- only used as a fallback when there's no well/poorly
  // signal to group by.
  const useNeutralFallback = wellRated.length === 0 && poorlyRated.length === 0 && neutral.length > 0

  const sections = [
    formatGroup("Captions this brand has rated well before (4-5 stars)", wellRated),
    formatGroup("Captions this brand has rated poorly before (1-2 stars)", poorlyRated),
    useNeutralFallback ? formatGroup("This brand's past captions (no strong rating signal yet)", neutral) : "",
    formatFeedbackNotes(feedbackNotes),
  ].filter(Boolean).join("\n\n")

  // Only added when there's actually something to check -- with an empty
  // feedbackNotes array (the common case today, see lib/ai/feedback-notes.ts's
  // own comment on why) this is "", so the prompt is byte-identical to
  // before feedback notes existed.
  const feedbackInstruction = feedbackNotes.length > 0
    ? " Also check whether the new draft repeats any of the specifically-flagged issues listed above -- if it does, say which one and why, explicitly."
    : ""

  return `New draft caption:
"${newText}"

${sections}

Does the new draft repeat a theme, angle, or hook style already used above? If so, say which one and how, referencing that one specific past example in plain language. If it's covering similar ground to something that scored POORLY before, say that explicitly as a caution.${feedbackInstruction} If it looks like a genuinely new angle for this brand, say that instead. Respond in 1-2 short sentences, plain language, no bullet points, no preamble, no markdown.`
}

const SYSTEM_PROMPT = "You are a sharp, honest content strategist reviewing a brand's caption history for repetition. You compare a new draft against the brand's own past captions (with their ratings) and call out real overlaps or genuine novelty -- concise and specific, never vague or generic."

/**
 * Semantic replacement for pattern-match.ts's buildPatternNote -- same
 * contract (returns null below 3 rated items, a short 1-2 sentence note
 * otherwise) but asks Groq (MODELS.scoring -- the existing lightweight-
 * judgment model, no new provider/embeddings infra) to genuinely read and
 * compare the new draft against the brand's own rated history, grouped
 * into what scored well vs. poorly, instead of a keyword-overlap (Jaccard)
 * heuristic that only ever caught literal word reuse. One completion call
 * per generation, not one per past item -- the whole rated history goes
 * into a single prompt.
 *
 * `feedbackNotes` (optional, defaults to []) is the brand's own explicit
 * "what didn't work" text from content_feedback_notes (see
 * lib/ai/feedback-notes.ts's getRecurringFeedbackNotes) -- real complaints,
 * not just a low number. When non-empty, Groq is also asked to check
 * whether the new draft repeats one of those specifically-flagged issues.
 * An empty array (the common case for a while -- see feedback-notes.ts's
 * own comment) adds nothing to the prompt, identical to before this
 * parameter existed.
 *
 * Fails soft, same non-blocking spirit as the sync version's "not enough
 * history" case: any Groq failure or timeout returns null (no pattern
 * note) rather than throwing, since this is a soft creative aside on top
 * of an already-successful caption generation, never something worth
 * blocking or retrying the real response for.
 */
export async function buildSemanticPatternNote(newText: string, rated: RatedItem[], feedbackNotes: string[] = []): Promise<string | null> {
  if (rated.length < 3) return null

  const wellRated = rated.filter((r) => r.rating >= 4)
  const poorlyRated = rated.filter((r) => r.rating <= 2)
  const neutral = rated.filter((r) => r.rating === 3)

  try {
    const groq = getGroqClient()
    const res = await groq.chat.completions.create(
      {
        model: MODELS.scoring,
        temperature: 0.3,
        // GPT-OSS reasoning tokens count against max_tokens (see
        // lib/ai/models.ts's own warning on this model class) -- a short
        // 1-2 sentence output, but real comparative reasoning over up to
        // 16 past examples first, so "low" with real headroom rather than
        // the bare minimum.
        reasoning_effort: "low",
        max_tokens: 500,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(newText, wellRated, poorlyRated, neutral, feedbackNotes) },
        ],
      },
      // This runs after the caption itself already generated and saved
      // successfully -- a hung Groq call here should never stall the
      // response for long, so this is bounded well under a typical
      // request timeout rather than left to hang indefinitely.
      { timeout: 10_000 }
    )

    const note = res.choices[0]?.message?.content?.trim()
    return note || null
  } catch (err) {
    console.error("[semantic-pattern-match] Groq call failed (non-fatal):", err instanceof Error ? err.message : err)
    return null
  }
}
