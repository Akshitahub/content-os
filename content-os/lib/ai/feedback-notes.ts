// Real notes are short (a phrase, a sentence) -- this isn't the prompt-size
// bottleneck lib/ai/semantic-pattern-match.ts's MAX_EXAMPLES_PER_GROUP
// exists for, so a slightly more generous cap is fine. Groq itself
// recognizes a recurring pattern across a handful of short strings ("too
// salesy" appearing three times) without any pre-grouping here.
const MAX_FEEDBACK_NOTES = 10

/**
 * Surfaces a brand's own explicit "what didn't work" notes (content_
 * feedback_notes, see supabase/migrations/053_content_feedback_notes.sql --
 * captured on any 1-2 star rating, currently only for captions/hooks) for
 * a given content_type, most recent first. Deliberately NOT clustered or
 * themed algorithmically -- just the raw note strings, exact-duplicate text
 * collapsed to one entry so a repeatedly-typed identical complaint doesn't
 * eat multiple slots of the cap. buildSemanticPatternNote hands these
 * straight to Groq, which can recognize a recurring theme across a handful
 * of short strings on its own.
 *
 * Non-fatal on any failure -- returns [] rather than throwing, same
 * fail-soft spirit as resolveCaptionEngagementRatings. Expected to return
 * [] for most brands for a while: migration 053 only just shipped, so
 * there's little to no real history yet -- callers (buildSemanticPatternNote)
 * already degrade cleanly to their pre-feedback-notes behavior on an empty
 * array.
 */
export async function getRecurringFeedbackNotes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  brandId: string,
  contentType: string
): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from("content_feedback_notes")
      .select("note")
      .eq("brand_id", brandId)
      .eq("content_type", contentType)
      .not("note", "is", null)
      .order("created_at", { ascending: false })
      .limit(50) as { data: { note: string | null }[] | null; error: { message: string } | null }

    if (error) {
      console.error("[feedback-notes] getRecurringFeedbackNotes query failed (non-fatal):", error.message)
      return []
    }

    const seen = new Set<string>()
    const notes: string[] = []
    for (const row of data ?? []) {
      const note = row.note?.trim()
      if (!note || seen.has(note)) continue
      seen.add(note)
      notes.push(note)
      if (notes.length >= MAX_FEEDBACK_NOTES) break
    }
    return notes
  } catch (err) {
    console.error("[feedback-notes] getRecurringFeedbackNotes failed (non-fatal):", err)
    return []
  }
}
