import crypto from "crypto"
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { uploadMediaToStorage } from "@/lib/storage/upload-media"
import { submitReelRender } from "@/lib/video/render-trigger"
import { markReelJobFailed } from "@/lib/video/reel-job-completion"
import type { KlingWebhookPayload } from "@/lib/video/kling-client"
import type { ReelVideoJobRow, ReelVideoJobSceneRow } from "@/types/database"

// 2026-08-18: this used to also submit to and poll JSON2Video for the final
// render (up to ~280s) once every scene reported in — that's now webhook-
// driven too (app/api/v1/webhooks/json2video/route.ts), so this route only
// ever does a handful of DB round-trips plus one fast JSON2Video submit
// call. 30s matches the Kling submit route's own budget.
export const maxDuration = 30

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reelVideoJobsTable(supabase: any): any {
  return supabase.from("reel_video_jobs")
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reelVideoJobScenesTable(supabase: any): any {
  return supabase.from("reel_video_job_scenes")
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

  if (completedScenes.length === 0) {
    console.error(`[webhooks/kling] job ${job.id}: no usable scenes after all reported in`)
    // Total failure, nothing usable produced — don't let this burn a free
    // user's one-time free reel or a pro/agency user's weekly allowance on
    // a video that was never made.
    await markReelJobFailed(admin, job, "Couldn't generate any usable scene assets for this video. Please try again.", { refund: true })
    return NextResponse.json({ data: { received: true } }, { status: 200 })
  }

  if (!process.env.NEXT_PUBLIC_APP_URL || !process.env.JSON2VIDEO_WEBHOOK_SECRET) {
    console.error(`[webhooks/kling] job ${job.id}: NEXT_PUBLIC_APP_URL or JSON2VIDEO_WEBHOOK_SECRET not configured`)
    // Assets existed but we can't even submit the render — same non-refund
    // policy as any other post-assets render failure.
    await markReelJobFailed(admin, job, "Video rendering isn't configured yet.", { refund: false })
    return NextResponse.json({ data: { received: true } }, { status: 200 })
  }

  const renderWebhookEndpoint = `${process.env.NEXT_PUBLIC_APP_URL}/api/v1/webhooks/json2video?token=${encodeURIComponent(process.env.JSON2VIDEO_WEBHOOK_SECRET)}`

  const submitResult = await submitReelRender(
    {
      jobId: job.id,
      scenes: completedScenes.map((s) => ({
        imageUrl: s.video_url!,
        audioUrl: s.audio_url,
        text: s.voiceover_text,
        durationSeconds: s.duration_seconds,
      })),
      musicUrl: job.music_url,
    },
    { endpoint: renderWebhookEndpoint }
  )

  if ("error" in submitResult) {
    // Assets existed (partial or full success) but we couldn't even get
    // JSON2Video to accept the render — per the pre-existing policy, this
    // is NOT a total failure and does not get refunded.
    await markReelJobFailed(admin, job, submitResult.error, { refund: false })
    return NextResponse.json({ data: { received: true } }, { status: 200 })
  }

  // Job stays in 'rendering' (already set by the claim update above) — the
  // JSON2Video webhook receiver takes it from here.
  await reelVideoJobsTable(admin)
    .update({ json2video_project_id: submitResult.projectId })
    .eq("id", job.id)

  return NextResponse.json({ data: { received: true } }, { status: 200 })
}
