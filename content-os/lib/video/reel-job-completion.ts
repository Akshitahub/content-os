import { refundReelUsage } from "@/lib/usage/check-and-increment-reel-usage"
import type { ReelVideoJobRow } from "@/types/database"

// Shared by app/api/v1/webhooks/kling/route.ts (total scene failure, before
// a render was ever attempted) and app/api/v1/webhooks/json2video/route.ts
// (render success/failure) — both webhooks can independently reach a
// terminal state for the same job, so this logic lives in one place rather
// than being duplicated ad hoc in each route.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reelVideoJobsTable(supabase: any): any {
  return supabase.from("reel_video_jobs")
}

/**
 * Autopilot (lib/ai/fastlane.ts) reels have a calendar entry that needs the
 * finished video (or failure) reflected in its platform_specific_data —
 * manually-generated reels (reel-scripts/[scriptId]/video/route.ts) have no
 * calendar entry yet at generation time, so calendar_entry_id is null there
 * and this is a no-op.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function syncCalendarEntry(admin: any, calendarEntryId: string | null, status: "ready" | "failed", videoUrl: string | null, errorMessage: string | null): Promise<void> {
  if (!calendarEntryId) return
  const entriesTable = admin.from("calendar_entries")
  const { data: current } = await entriesTable.select("platform_specific_data").eq("id", calendarEntryId).single()
  const existing = (current?.platform_specific_data ?? {}) as Record<string, unknown>
  await entriesTable
    .update({
      platform_specific_data:
        status === "ready"
          ? { ...existing, content_format: "video", video_status: "ready", video_url: videoUrl }
          : { ...existing, content_format: "video", video_status: "failed", video_error: errorMessage },
    })
    .eq("id", calendarEntryId)
}

/**
 * Marks a reel_video_jobs row as genuinely completed — video rendered,
 * calendar entry (if any) synced. (The free_reel_generated PostHog event
 * this used to fire for plan === "free" was retired along with the Free
 * tier — reels are Pro/Agency-only now, and neither of those was ever the
 * "free" plan, so the event could never fire again anyway.)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function markReelJobCompleted(admin: any, job: ReelVideoJobRow, videoUrl: string): Promise<void> {
  await reelVideoJobsTable(admin)
    .update({ status: "completed", progress_message: null, video_url: videoUrl })
    .eq("id", job.id)
  await syncCalendarEntry(admin, job.calendar_entry_id, "ready", videoUrl, null)
}

/**
 * Marks a reel_video_jobs row as failed — calendar entry (if any) synced,
 * and usage refunded ONLY when `refund` is true. Refund policy: true only
 * for a total failure (no usable scene assets ever produced); false when
 * assets existed but the render itself failed, since a free user's
 * one-time reel (or a pro/agency user's weekly allowance) was genuinely
 * spent on real generation work either way.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function markReelJobFailed(admin: any, job: ReelVideoJobRow, errorMessage: string, options: { refund: boolean }): Promise<void> {
  await reelVideoJobsTable(admin)
    .update({ status: "failed", progress_message: null, error_message: errorMessage })
    .eq("id", job.id)
  await syncCalendarEntry(admin, job.calendar_entry_id, "failed", null, errorMessage)

  if (options.refund) {
    const { data: brand } = await admin.from("brands").select("user_id").eq("id", job.brand_id).maybeSingle() as { data: { user_id: string } | null }
    if (brand?.user_id) await refundReelUsage(admin, brand.user_id)
  }
}
