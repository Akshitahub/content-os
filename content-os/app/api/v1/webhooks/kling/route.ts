import crypto from "crypto"
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { uploadMediaToStorage } from "@/lib/storage/upload-media"
import { renderReelVideo, type RenderReelVideoInput } from "@/lib/video/render-trigger"
import { refundReelUsage } from "@/lib/usage/check-and-increment-reel-usage"
import { captureServerEvent } from "@/lib/analytics/posthog"
import type { KlingWebhookPayload } from "@/lib/video/kling-client"
import type { ReelVideoJobRow, ReelVideoJobSceneRow } from "@/types/database"
import type { UserPlan } from "@/types/app"

// The full chain this can trigger — Kling's own webhook delivery, plus (once
// every scene for a job has reported in) submitting to and polling
// JSON2Video for the final render — runs in THIS function's own execution
// window, separate from and much longer than the submit route's maxDuration
// (see app/api/v1/brands/[brandId]/reel-scripts/[scriptId]/video/route.ts).
// JSON2Video's own poll can take up to ~280s (see lib/video/render-trigger.ts) —
// this is deliberately NOT webhook-driven itself yet (JSON2Video does
// support a webhook, but that wasn't in scope for this pass — see the PR
// description). 300s gives ~20s of headroom on top of that worst case.
export const maxDuration = 300

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reelVideoJobsTable(supabase: any): any {
  return supabase.from("reel_video_jobs")
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reelVideoJobScenesTable(supabase: any): any {
  return supabase.from("reel_video_job_scenes")
}

/**
 * Autopilot (lib/ai/fastlane.ts) reels have a calendar entry that needs the
 * finished video (or failure) reflected in its platform_specific_data —
 * manually-generated reels (reel-scripts/[scriptId]/video/route.ts) have no
 * calendar entry yet at generation time, so calendar_entry_id is null there
 * and this is a no-op.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncCalendarEntry(admin: any, calendarEntryId: string | null, status: "ready" | "failed", videoUrl: string | null, errorMessage: string | null): Promise<void> {
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
 * PiAPI's webhook auth is a plain shared secret, not HMAC — confirmed via
 * their docs (piapi.ai/docs/unified-webhook): "If a secret is provided, it
 * will be included in the 'x-webhook-secret' header." So verification is a
 * direct (constant-time) string comparison, not a signature computation.
 */
function isValidWebhookSecret(received: string | null): boolean {
  const expected = process.env.KLING_WEBHOOK_SECRET
  if (!expected || !received) return false
  const expectedBuf = Buffer.from(expected, "utf8")
  const receivedBuf = Buffer.from(received, "utf8")
  return expectedBuf.length === receivedBuf.length && crypto.timingSafeEqual(expectedBuf, receivedBuf)
}

export async function POST(request: Request) {
  console.log("[webhooks/kling] POST called")

  const receivedSecret = request.headers.get("x-webhook-secret")
  if (!isValidWebhookSecret(receivedSecret)) {
    console.error("[webhooks/kling] invalid or missing x-webhook-secret")
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid signature."), { status: 401 })
  }

  let payload: KlingWebhookPayload
  try {
    payload = await request.json() as KlingWebhookPayload
  } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const taskId = payload.data?.task_id
  const status = payload.data?.status
  if (!taskId) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Missing task_id."), { status: 400 })
  }

  // PiAPI also fires this webhook when a task is first created, and
  // possibly for other transient states — only 'completed'/'failed' are
  // terminal and worth acting on. Acknowledge everything else so PiAPI
  // doesn't keep retrying.
  if (status !== "completed" && status !== "failed") {
    return NextResponse.json({ data: { received: true } }, { status: 200 })
  }

  const admin = await createAdminClient()

  const { data: scene } = await reelVideoJobScenesTable(admin)
    .select("*")
    .eq("kling_task_id", taskId)
    .maybeSingle() as { data: ReelVideoJobSceneRow | null }

  if (!scene) {
    // Unknown task_id — could be a stale/test webhook. Nothing to do, but
    // acknowledge so PiAPI doesn't retry indefinitely.
    console.error(`[webhooks/kling] no scene found for task_id ${taskId}`)
    return NextResponse.json({ data: { received: true } }, { status: 200 })
  }

  if (scene.status !== "pending") {
    // Already processed — PiAPI retries up to 3x on a non-2xx response, so
    // this is the expected idempotent path for a retried delivery, not an error.
    return NextResponse.json({ data: { received: true } }, { status: 200 })
  }

  const { data: job } = await reelVideoJobsTable(admin)
    .select("*")
    .eq("id", scene.job_id)
    .maybeSingle() as { data: ReelVideoJobRow | null }

  if (!job) {
    console.error(`[webhooks/kling] scene ${scene.id} has no matching job ${scene.job_id}`)
    return NextResponse.json({ data: { received: true } }, { status: 200 })
  }

  try {
    if (status === "completed") {
      const rawVideoUrl = payload.data?.output?.video_url
      if (!rawVideoUrl) {
        await reelVideoJobScenesTable(admin)
          .update({ status: "failed", error_message: "Video: Kling reported success but returned no video." })
          .eq("id", scene.id)
      } else {
        // Re-host to Supabase Storage — Kling's own returned URLs aren't
        // guaranteed to stay reachable long-term, same reasoning as every
        // other re-hosted asset in this pipeline.
        const uploadResult = await uploadMediaToStorage(
          { kind: "remoteUrl", url: rawVideoUrl },
          `${job.brand_id}/reel-video/${job.reel_script_id}/scene-${scene.scene_index}-video`
        )
        if ("error" in uploadResult) {
          console.error(`[webhooks/kling] scene ${scene.id} video hosting failed:`, uploadResult.error)
          await reelVideoJobScenesTable(admin)
            .update({ status: "failed", error_message: `Video: ${uploadResult.error}` })
            .eq("id", scene.id)
        } else {
          await reelVideoJobScenesTable(admin)
            .update({ status: "completed", video_url: uploadResult.publicUrl })
            .eq("id", scene.id)
        }
      }
    } else {
      const message = payload.data?.error?.message ?? "Kling video generation failed."
      await reelVideoJobScenesTable(admin)
        .update({ status: "failed", error_message: `Video: ${message}` })
        .eq("id", scene.id)
    }
  } catch (err) {
    console.error(`[webhooks/kling] failed to record scene ${scene.id} result:`, err instanceof Error ? err.message : err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to record scene result."), { status: 500 })
  }

  // Has every scene for this job now reported in (completed or failed —
  // nothing left 'pending')?
  const { count: stillPending } = await reelVideoJobScenesTable(admin)
    .select("id", { count: "exact", head: true })
    .eq("job_id", job.id)
    .eq("status", "pending")

  if (stillPending && stillPending > 0) {
    return NextResponse.json({ data: { received: true } }, { status: 200 })
  }

  // Last scene just reported in. Two webhooks for two different scenes of
  // the same job could both observe stillPending === 0 at nearly the same
  // moment — this conditional update is the mutex: only the invocation that
  // actually flips generating_voiceover -> rendering proceeds to finalize.
  const { data: claimed } = await reelVideoJobsTable(admin)
    .update({ status: "rendering", progress_message: "Combining your scenes into the final video…" })
    .eq("id", job.id)
    .eq("status", "generating_voiceover")
    .select("id")

  if (!claimed || claimed.length === 0) {
    // Another webhook delivery already claimed finalization for this job.
    return NextResponse.json({ data: { received: true } }, { status: 200 })
  }

  const { data: allScenes } = await reelVideoJobScenesTable(admin)
    .select("*")
    .eq("job_id", job.id)
    .order("scene_index", { ascending: true }) as { data: ReelVideoJobSceneRow[] | null }

  const completedScenes = (allScenes ?? []).filter((s) => s.status === "completed" && s.video_url)

  const { data: brand } = await admin.from("brands").select("user_id").eq("id", job.brand_id).maybeSingle<{ user_id: string }>()
  const userId = brand?.user_id

  if (completedScenes.length === 0) {
    console.error(`[webhooks/kling] job ${job.id}: no usable scenes after all reported in`)
    await reelVideoJobsTable(admin)
      .update({
        status: "failed",
        progress_message: null,
        error_message: "Couldn't generate any usable scene assets for this video. Please try again.",
      })
      .eq("id", job.id)
    // Total failure, nothing usable produced — don't let this burn a free
    // user's one-time free reel or a pro/agency user's weekly allowance on
    // a video that was never made.
    if (userId) await refundReelUsage(admin, userId)
    await syncCalendarEntry(admin, job.calendar_entry_id, "failed", null, "Couldn't generate any usable scene assets for this video. Please try again.")
    return NextResponse.json({ data: { received: true } }, { status: 200 })
  }

  const renderInput: RenderReelVideoInput = {
    jobId: job.id,
    scenes: completedScenes.map((s) => ({
      imageUrl: s.video_url!,
      audioUrl: s.audio_url,
      text: s.voiceover_text,
      durationSeconds: s.duration_seconds,
    })),
    musicUrl: job.music_url,
  }

  const renderResult = await renderReelVideo(renderInput)

  if (renderResult.success) {
    await reelVideoJobsTable(admin)
      .update({ status: "completed", progress_message: null, video_url: renderResult.videoUrl })
      .eq("id", job.id)
    await syncCalendarEntry(admin, job.calendar_entry_id, "ready", renderResult.videoUrl, null)

    // Not a refund case — some (or all) scenes rendered successfully, this
    // is a genuine completion, just possibly with fewer scenes than asked
    // for. Only fires for the free plan's one-time reel, to build a
    // free_reel_generated -> upgraded_within_7_days funnel in PostHog.
    if (userId) {
      const { data: userRow } = await admin.from("users").select("plan").eq("id", userId).maybeSingle<{ plan: UserPlan }>()
      if (userRow?.plan === "free") {
        await captureServerEvent(userId, "free_reel_generated", { user_id: userId, timestamp: new Date().toISOString() })
      }
    }
  } else {
    // Assets existed (partial or full success) but the render itself
    // failed — per the pre-existing refund policy, this is NOT a total
    // failure and does not get refunded.
    await reelVideoJobsTable(admin)
      .update({ status: "failed", progress_message: null, error_message: renderResult.error })
      .eq("id", job.id)
    await syncCalendarEntry(admin, job.calendar_entry_id, "failed", null, renderResult.error)
  }

  return NextResponse.json({ data: { received: true } }, { status: 200 })
}
