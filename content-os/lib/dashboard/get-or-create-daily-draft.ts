import { createClient } from "@/lib/supabase/server"

export interface DailyDraft {
  /** daily_draft_cache row id -- threaded through so the "Today's draft"
   * card's "Copy preview link" action (app/(dashboard)/dashboard/page.tsx)
   * has a content_id to hand POST /api/v1/share, same as every other
   * shareable content type. */
  id: string
  hookText: string
  captionText: string
  hashtags: string[]
  imageUrl: string | null
  failed: boolean
}

// Shape of a daily_draft_cache row -- not in types/database.ts yet (that's
// generated from a live Supabase schema; supabase/migrations/050_daily_draft_cache.sql
// hasn't been run there yet), so every query/insert against this table
// below is cast through `as any`, same convention already used for other
// not-yet-typed tables elsewhere in this codebase.
export interface DailyDraftCacheRow {
  id: string
  brand_id: string
  draft_date: string
  hook_text: string
  caption_text: string
  hashtags: string[] | null
  image_url: string | null
  content_project_id: string | null
  generation_failed: boolean
  created_at: string
}

/**
 * Fast, page-safe cache lookup ONLY -- no credit charge, no generation.
 * Safe to call directly from a Server Component render (see
 * app/(dashboard)/dashboard/page.tsx): it's a single indexed SELECT, never
 * an external API call, so it can't block the page the way the old
 * combined getOrCreateDailyDraft did (confirmed live: that version ran
 * generateHooks -> generateContent -> generatePostImage synchronously
 * inside the page render, each a real 10-30s+ external call, hanging the
 * whole Home page on any day's first visit for a brand).
 *
 * The actual generation (charge + generateHooks/generateContent/
 * generatePostImage + storage upload + cache insert, with refund-on-
 * failure) now lives entirely in
 * app/api/v1/dashboard/generate-daily-draft/route.ts, fired independently
 * by components/dashboard/DailyDraftTrigger.tsx AFTER the page has
 * already rendered and been sent to the browser -- see that route/
 * component for the full generation logic this function no longer does.
 *
 * Returns null for BOTH "never attempted today" and "attempted and
 * failed today" -- the page doesn't need to tell these two cases apart,
 * both mean "show the fallback CTA right now."
 */
export async function getCachedDailyDraft(brandId: string, draftDate: string): Promise<DailyDraft | null> {
  try {
    const supabase = await createClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (supabase.from("daily_draft_cache") as any)
      .select("*")
      .eq("brand_id", brandId)
      .eq("draft_date", draftDate)
      .maybeSingle() as { data: DailyDraftCacheRow | null }

    if (!existing || existing.generation_failed) return null

    return {
      id: existing.id,
      hookText: existing.hook_text,
      captionText: existing.caption_text,
      hashtags: existing.hashtags ?? [],
      imageUrl: existing.image_url,
      failed: false,
    }
  } catch (err) {
    console.error("[get-cached-daily-draft] unexpected error:", err instanceof Error ? err.message : err)
    return null
  }
}
