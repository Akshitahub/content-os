import { after } from "next/server"
import { applyLessonDecision, decideLesson, type DistillInput } from "./brand-brain"

/**
 * Learning from the client's own edits (migration 071). When an owner
 * rewrites a caption, hook or headline before approving or scheduling it,
 * the before / after pair is stored -- unless under MIN_CHANGE of its words
 * changed (a typo, an emoji). Every EDITS_PER_LESSON new pairs per brand,
 * ONE model call (decideLesson, with the pairs instead of a rated note)
 * distils what they share into brand_lessons with source 'edits', merged
 * with an existing lesson when it's the same preference. Those lessons
 * reach generation through the usual withLessons path. Fail-soft: an edit
 * is never blocked by any of this.
 */

export const MIN_CHANGE = 0.15
export const EDITS_PER_LESSON = 5

export type EditField = "caption" | "hook" | "headline"
export type EditSurface = "calendar" | "carousel" | "story" | "full_post"

export interface ContentEdit {
  brandId: string
  userId: string | null
  surface: EditSurface
  field: EditField
  contentType?: string | null
  contentId?: string | null
  before: string
  after: string
}

// Words and emoji count; punctuation alone ("." -> "!") is a touch-up.
const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}']+|\p{Extended_Pictographic}/gu) ?? []

/** Share of words changed between two texts (word-level edit distance / the longer one's length), 0-1. */
export function changeRatio(before: string, after: string): number {
  const a = words(before)
  const b = words(after)
  if (a.length === 0 && b.length === 0) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return Math.min(1, prev[b.length]! / Math.max(a.length, b.length))
}

/** A real rewrite, not a touch-up. */
export const isMeaningfulEdit = (before: string | null | undefined, after: string | null | undefined): boolean =>
  !!before?.trim() && !!after?.trim() && changeRatio(before, after) >= MIN_CHANGE

/** Headline / text pairs a carousel or story save changed (slide by slide), for recordContentEdits. */
export function slideTextEdits(before: unknown, after: unknown, fields: string[] = ["headline", "big_words", "text"]): { before: string; after: string }[] {
  if (!Array.isArray(before) || !Array.isArray(after)) return []
  const out: { before: string; after: string }[] = []
  after.forEach((slide, i) => {
    const old = before[i] as Record<string, unknown> | undefined
    if (!old || !slide || typeof slide !== "object") return
    for (const f of fields) {
      const b = old[f]
      const a = (slide as Record<string, unknown>)[f]
      if (typeof b === "string" && typeof a === "string" && b.trim() !== a.trim()) {
        out.push({ before: b, after: a })
        return
      }
    }
  })
  return out
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

const LESSON_SCOPE: Record<EditField, DistillInput["scope"]> = { caption: "caption", hook: "hook", headline: "carousel" }

/**
 * Stores the meaningful ones, then (after the response) distils once the
 * brand has EDITS_PER_LESSON new pairs. Call from a route handler. Never throws.
 */
export async function recordContentEdits(db: Db, edits: ContentEdit[]): Promise<number> {
  const rows = edits.filter((e) => isMeaningfulEdit(e.before, e.after)).map((e) => ({
    brand_id: e.brandId, user_id: e.userId, surface: e.surface, field: e.field,
    content_type: e.contentType ?? null, content_id: e.contentId ?? null,
    before_text: e.before.slice(0, 5000), after_text: e.after.slice(0, 5000),
    change_ratio: Math.round(changeRatio(e.before, e.after) * 100) / 100,
  }))
  if (rows.length === 0) return 0
  try {
    const { error } = await db.from("content_edits").insert(rows)
    if (error) {
      // Before migration 071: not recorded.
      console.error("[edit-learning] couldn't record edits (non-fatal):", error.message)
      return 0
    }
    const brandIds = [...new Set(rows.map((r) => r.brand_id))]
    try {
      after(async () => {
        for (const brandId of brandIds) await distillPendingEdits(db, brandId)
      })
    } catch {
      // Outside a request (scripts): distil now.
      for (const brandId of brandIds) await distillPendingEdits(db, brandId)
    }
    return rows.length
  } catch (err) {
    console.error("[edit-learning] record failed (non-fatal):", err instanceof Error ? err.message : err)
    return 0
  }
}

/** The DistillInput for a batch of edits: scope from their most common field. Pure. */
export function editsDistillInput(brandId: string, batch: { field: EditField; before_text: string; after_text: string }[]): DistillInput {
  const counts = new Map<EditField, number>()
  for (const e of batch) counts.set(e.field, (counts.get(e.field) ?? 0) + 1)
  const field = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
  return {
    brandId,
    scope: LESSON_SCOPE[field],
    rating: 0,
    note: "",
    contentText: "",
    edits: batch.map((e) => ({ field: e.field, before: e.before_text, after: e.after_text })),
  }
}

/** Every EDITS_PER_LESSON undistilled edits -> one decision -> a merged / new 'edits' lesson (or a skip). `decide` is the model call (injectable for tests). Never throws. */
export async function distillPendingEdits(db: Db, brandId: string, decide: typeof decideLesson = decideLesson): Promise<"distilled" | "waiting" | "failed"> {
  try {
    const { data } = await db.from("content_edits").select("id, field, before_text, after_text")
      .eq("brand_id", brandId).is("distilled_at", null).order("created_at", { ascending: true }).limit(EDITS_PER_LESSON)
    const batch = (data ?? []) as { id: string; field: EditField; before_text: string; after_text: string }[]
    if (batch.length < EDITS_PER_LESSON) return "waiting"
    // Claimed first, so two requests finishing together don't both distil it.
    const { data: claimed } = await db.from("content_edits").update({ distilled_at: new Date().toISOString() })
      .in("id", batch.map((e) => e.id)).is("distilled_at", null).select("id")
    if ((claimed ?? []).length < batch.length) return "waiting"
    const result = await decide(db, editsDistillInput(brandId, batch))
    if (!result) {
      // The model call failed: release them for the next edit to retry.
      await db.from("content_edits").update({ distilled_at: null }).in("id", batch.map((e) => e.id))
      return "failed"
    }
    await applyLessonDecision(db, brandId, result.decision, result.existing, "edits")
    console.log(`[edit-learning] brand ${brandId}: ${batch.length} edits -> ${result.decision.action}`)
    return "distilled"
  } catch (err) {
    console.error(`[edit-learning] distill failed for brand ${brandId} (non-fatal):`, err instanceof Error ? err.message : err)
    return "failed"
  }
}
