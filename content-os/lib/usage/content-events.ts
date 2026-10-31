import { after } from "next/server"

// content_events (supabase/migrations/061_content_events.sql): what happens
// to generated content -- the raw material for lib/admin/metrics.ts.
// Recording is fire-and-forget: scheduled with after() so it runs once the
// response is sent, never awaited on the response path, never throws.
// Emitted only where the route already knows the content id; meta carries
// model/cost, a rating, or field NAMES -- never content itself.

export type ContentEventType = "caption" | "hook" | "carousel" | "story" | "ad_copy" | "post_image" | "ad_maker"
// provider_fallback: a Groq text call answered by OpenAI instead (lib/ai/provider-fallback.ts).
export type ContentEventName = "generated" | "regenerated" | "edited" | "saved" | "scheduled" | "rated" | "downloaded" | "quality_checked" | "provider_fallback" | "critic_scored"

export type ContentEventInput = {
  userId: string | null
  brandId: string
  contentType: ContentEventType
  contentId?: string | null
  event: ContentEventName
  meta?: Record<string, unknown>
}

/** The insert itself, awaitable -- for code already running after the response (inside after()). Never throws. */
export async function insertContentEvents(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  events: ContentEventInput[],
): Promise<void> {
  const rows = events.map((e) => ({
    user_id: e.userId,
    brand_id: e.brandId,
    content_type: e.contentType,
    content_id: e.contentId ?? null,
    event: e.event,
    meta: e.meta ?? {},
  }))
  if (rows.length === 0) return
  try {
    const { error } = await supabase.from("content_events").insert(rows)
    if (error) console.error("[content-events] insert failed (non-fatal):", error.message)
  } catch (err) {
    console.error("[content-events] insert threw (non-fatal):", err instanceof Error ? err.message : err)
  }
}

export function recordContentEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  events: ContentEventInput | ContentEventInput[],
): void {
  const list = Array.isArray(events) ? events : [events]
  if (list.length === 0) return
  const write = () => insertContentEvents(supabase, list)
  try {
    after(write)
  } catch {
    // Outside a request scope (e.g. a script) -- still never blocks the caller.
    void write()
  }
}

/** Events for a PUT that may set is_saved / user_rating -- saved only on true, rated with the rating. */
export function savedAndRatedEvents(
  base: Omit<ContentEventInput, "event" | "meta">,
  update: { is_saved?: boolean | null; user_rating?: number | null },
): ContentEventInput[] {
  const events: ContentEventInput[] = []
  if (update.is_saved === true) events.push({ ...base, event: "saved" })
  if (update.user_rating != null) events.push({ ...base, event: "rated", meta: { rating: update.user_rating } })
  return events
}

/**
 * Names of the per-item fields that differ between two versions of a
 * slides/frames array (plus "count" if items were added or removed),
 * ignoring `ignore` (e.g. background-image fields the app fills in on its
 * own). [] = nothing the user actually changed.
 */
export function changedFieldNames(before: unknown, after: unknown, ignore: Set<string>): string[] {
  const a = Array.isArray(before) ? before : []
  const b = Array.isArray(after) ? after : []
  const changed = new Set<string>()
  if (a.length !== b.length) changed.add("count")
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = (a[i] && typeof a[i] === "object" ? a[i] : {}) as Record<string, unknown>
    const y = (b[i] && typeof b[i] === "object" ? b[i] : {}) as Record<string, unknown>
    for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (ignore.has(key)) continue
      if (JSON.stringify(x[key]) !== JSON.stringify(y[key])) changed.add(key)
    }
  }
  return [...changed].sort()
}
