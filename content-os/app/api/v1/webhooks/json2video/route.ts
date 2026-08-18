import crypto from "crypto"
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { fetchJson2VideoStatus } from "@/lib/video/render-trigger"
import { markReelJobCompleted, markReelJobFailed } from "@/lib/video/reel-job-completion"
import type { ReelVideoJobRow } from "@/types/database"

// Just a few DB round-trips plus one JSON2Video status GET — no polling
// happens here anymore.
export const maxDuration = 30

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reelVideoJobsTable(supabase: any): any {
  return supabase.from("reel_video_jobs")
}

interface Json2VideoWebhookPayload {
  project?: string
  id?: string
  url?: string
}

/**
 * JSON2Video has no webhook signing at all — confirmed via their own docs
 * ("Webhooks are not currently signed by JSON2Video"). Their own
 * recommendation is an unguessable endpoint path/token plus always
 * cross-checking via GET /v2/movies before trusting a callback. This
 * checks the token (a query param on the URL we registered at submit
 * time); the project-id match and the authoritative status re-fetch below
 * are the other two layers.
 */
function isValidToken(url: URL): boolean {
  const expected = process.env.JSON2VIDEO_WEBHOOK_SECRET
  const received = url.searchParams.get("token")
  if (!expected || !received) return false
  const expectedBuf = Buffer.from(expected, "utf8")
  const receivedBuf = Buffer.from(received, "utf8")
  return expectedBuf.length === receivedBuf.length && crypto.timingSafeEqual(expectedBuf, receivedBuf)
}

export async function POST(request: Request) {
  console.log("[webhooks/json2video] POST called")

  const url = new URL(request.url)
  if (!isValidToken(url)) {
    console.error("[webhooks/json2video] invalid or missing token")
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid token."), { status: 401 })
  }

  let payload: Json2VideoWebhookPayload
  try {
    payload = await request.json() as Json2VideoWebhookPayload
  } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  // `id` is the jobId we set on submit (see lib/video/render-trigger.ts's
  // submitReelRender) — JSON2Video's own generated `project` id is a
  // separate field, used below purely as a sanity check.
  const jobId = payload.id
  const project = payload.project
  if (!jobId || !project) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Missing id or project."), { status: 400 })
  }

  const admin = await createAdminClient()

  const { data: job } = await reelVideoJobsTable(admin)
    .select("*")
    .eq("id", jobId)
    .maybeSingle() as { data: ReelVideoJobRow | null }

  if (!job) {
    // Unknown job id — could be a stale/test webhook. Nothing to do, but
    // acknowledge rather than error.
    console.error(`[webhooks/json2video] no job found for id ${jobId}`)
    return NextResponse.json({ data: { received: true } }, { status: 200 })
  }

  // Defense-in-depth given JSON2Video has no real signature: the project id
  // in the payload must match what we stored when we submitted this job.
  if (job.json2video_project_id !== project) {
    console.error(`[webhooks/json2video] project mismatch for job ${jobId}: expected ${job.json2video_project_id}, got ${project}`)
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Project mismatch."), { status: 400 })
  }

  if (job.status === "completed" || job.status === "failed") {
    // Already finalized — idempotent no-op. JSON2Video doesn't retry failed
    // deliveries, but a duplicate/late delivery is still possible.
    return NextResponse.json({ data: { received: true } }, { status: 200 })
  }

  // JSON2Video's own docs recommend never trusting the webhook payload
  // alone (their failure-case payload shape isn't even documented) —
  // always re-fetch authoritative status instead.
  const statusResult = await fetchJson2VideoStatus(project)
  if ("error" in statusResult) {
    console.error(`[webhooks/json2video] status check failed for job ${jobId}:`, statusResult.error)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to verify render status."), { status: 500 })
  }

  if (statusResult.status === "done") {
    if (!statusResult.videoUrl) {
      // Assets existed (scenes rendered) but the render itself came back
      // empty — not a total failure, no refund, matching the pre-existing
      // policy for any post-assets render failure.
      await markReelJobFailed(admin, job, "JSON2Video reported success but returned no video.", { refund: false })
    } else {
      await markReelJobCompleted(admin, job, statusResult.videoUrl)
    }
  } else if (statusResult.status === "error") {
    await markReelJobFailed(admin, job, statusResult.message ?? "Video rendering failed.", { refund: false })
  } else {
    // Still pending/running — a premature or duplicate delivery. Nothing
    // to do yet; a later delivery (or the next status check) will resolve it.
    console.log(`[webhooks/json2video] job ${jobId} status check returned "${statusResult.status}" — not yet terminal`)
  }

  return NextResponse.json({ data: { received: true } }, { status: 200 })
}
