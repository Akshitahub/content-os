import { NextResponse, after } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { submitSceneAssetJobs } from "@/lib/video/reel-scene-assets"
import { checkAndIncrementReelUsage, refundReelUsage } from "@/lib/usage/check-and-increment-reel-usage"
import { MUSIC_OPTIONS } from "@/lib/video/music-options"
import { z } from "zod"
import type { ReelScriptRow, ReelVideoJobRow, ReelVideoJobInsert, Json } from "@/types/database"
import type { ReelScene } from "@/types/app"

type RouteParams = { params: Promise<{ brandId: string; scriptId: string }> }

const bodySchema = z.object({
  // Per-scene prompt overrides from the prompt-customization/suggestion
  // step, index-aligned with the script's own scenes. Optional — omitted
  // (or an empty array) falls back to each scene's original visual_direction.
  scenePrompts: z.array(z.string()).optional(),
  // Which MUSIC_OPTIONS entry to use as background music. Optional —
  // omitted or an unrecognized id falls back to "upbeat".
  musicTrackId: z.string().optional(),
})

// This route only SUBMITS work now — one Kling task per scene (webhook-
// driven, see lib/video/kling-client.ts) plus synchronous Groq TTS calls,
// staggered SCENE_STAGGER_MS apart. No polling happens here anymore, so
// even a 10-scene reel should finish submission in well under 30s. The
// actual generation result arrives later via
// app/api/v1/webhooks/kling/route.ts, which also triggers the JSON2Video
// render step once every scene has reported in — that route has its own
// separate, longer maxDuration budget, independent of this one.
export const maxDuration = 30

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reelVideoJobsTable(supabase: any): any {
  return supabase.from("reel_video_jobs")
}

function parseScenes(raw: Json): ReelScene[] {
  if (!Array.isArray(raw)) return []
  const scenes: ReelScene[] = []
  for (const item of raw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue
    const s = item as Record<string, Json | undefined>
    const visual_direction = typeof s.visual_direction === "string" ? s.visual_direction : ""
    if (!visual_direction) continue
    scenes.push({
      visual_direction,
      voiceover_or_text_overlay: typeof s.voiceover_or_text_overlay === "string" ? s.voiceover_or_text_overlay : "",
      duration_seconds: typeof s.duration_seconds === "number" ? s.duration_seconds : 5,
    })
  }
  return scenes
}

export async function POST(request: Request, { params }: RouteParams) {
  const { brandId, scriptId } = await params
  console.log(`[reel-scripts/${scriptId}/video] POST called`)

  // Fails fast, before touching the user's reel quota — a missing key means
  // no generation can possibly succeed, so there's nothing worth spending
  // their one-time free reel or weekly allowance on.
  if (!process.env.KLING_API_KEY) {
    console.error("[reel-scripts/video] KLING_API_KEY is not configured")
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Video generation isn't configured yet."), { status: 500 })
  }
  // Same reasoning — without this, every scene's Kling job would be
  // submitted with no way for the webhook receiver to verify (or even
  // trust) the callback, and no way for us to ever learn the result.
  if (!process.env.KLING_WEBHOOK_SECRET) {
    console.error("[reel-scripts/video] KLING_WEBHOOK_SECRET is not configured")
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Video generation isn't configured yet."), { status: 500 })
  }

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[reel-scripts/video] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  const { data: brand } = await supabase.from("brands").select("id").eq("id", brandId).eq("user_id", user.id).single<{ id: string }>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  const reelUsageCheck = await checkAndIncrementReelUsage(user.id)
  if (!reelUsageCheck.ok) {
    return NextResponse.json(buildError(ErrorCodes.USAGE_LIMIT_EXCEEDED, reelUsageCheck.message), { status: reelUsageCheck.status })
  }

  // Body is optional — an empty/absent body falls back to each scene's own
  // visual_direction (no prompt customization step used).
  let scenePrompts: string[] | undefined
  let musicTrackId: string | undefined
  try {
    const rawBody = await request.text()
    if (rawBody.trim()) {
      const parsed = bodySchema.safeParse(JSON.parse(rawBody))
      if (!parsed.success) {
        return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.issues[0]?.message), { status: 400 })
      }
      scenePrompts = parsed.data.scenePrompts
      musicTrackId = parsed.data.musicTrackId
    }
  } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const { data: script } = await supabase
    .from("reel_scripts")
    .select("*")
    .eq("id", scriptId)
    .eq("brand_id", brandId)
    .single<ReelScriptRow>()

  if (!script) return NextResponse.json(buildError(ErrorCodes.NOT_FOUND, "Reel script not found."), { status: 404 })

  const scenes = parseScenes(script.scenes)
  if (scenes.length === 0) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "This reel script has no scenes to turn into a video."), { status: 400 })
  }

  const musicOption =
    MUSIC_OPTIONS.find((m) => m.id === musicTrackId) ?? MUSIC_OPTIONS.find((m) => m.id === "upbeat")!
  const musicUrl = musicOption.url

  const jobInsert: ReelVideoJobInsert = {
    brand_id: brandId,
    reel_script_id: scriptId,
    status: "pending",
    progress_message: "Queued…",
    music_url: musicUrl,
  }

  const { data: job, error: insertError } = await reelVideoJobsTable(supabase)
    .insert(jobInsert)
    .select()
    .single() as { data: ReelVideoJobRow | null; error: { message: string } | null }

  if (insertError || !job) {
    console.error("[reel-scripts/video] failed to create job:", insertError)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to start video generation."), { status: 500 })
  }

  // Absolute URL PiAPI's webhook needs to reach — same fallback convention
  // used by every OAuth callback route in this codebase (NEXT_PUBLIC_APP_URL,
  // falling back to the request's own origin).
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin
  const webhookConfig = { endpoint: `${appUrl}/api/v1/webhooks/kling`, secret: process.env.KLING_WEBHOOK_SECRET! }

  // Runs after the response is sent, so the client isn't held open — but
  // unlike before, this only SUBMITS each scene's Kling job and generates
  // its TTS voiceover (both fast, no polling), so it finishes in seconds,
  // not minutes. The actual video results arrive later via
  // app/api/v1/webhooks/kling/route.ts, which also owns triggering the
  // JSON2Video render step once every scene has reported in.
  after(async () => {
    const admin = await createAdminClient()

    try {
      await reelVideoJobsTable(admin)
        .update({ status: "generating_images", progress_message: "Generating AI video scenes and voiceover, this can take a few minutes…" })
        .eq("id", job.id)

      const result = await submitSceneAssetJobs(admin, brandId, scriptId, job.id, scenes, scenePrompts, webhookConfig)

      if (result.pendingCount === 0) {
        // Every scene failed to even submit — no webhook will ever arrive
        // for any of them, so this is a total failure right now rather than
        // something to wait on.
        console.error(`[reel-scripts/video] job ${job.id}: all ${result.totalScenes} scene(s) failed to submit`)
        await reelVideoJobsTable(admin)
          .update({
            status: "failed",
            progress_message: null,
            error_message: "Couldn't generate any usable scene assets for this video. Please try again.",
          })
          .eq("id", job.id)
        // Total failure, nothing usable produced — don't let this burn a
        // free user's one-time free reel or a pro/agency user's weekly
        // allowance on a video that was never made.
        await refundReelUsage(admin, user.id)
        return
      }

      // At least one scene is genuinely in flight — the webhook receiver
      // takes it from here (per-scene completion, then the JSON2Video
      // render step once all scenes have reported in).
      await reelVideoJobsTable(admin)
        .update({
          status: "generating_voiceover",
          progress_message:
            result.immediateFailureCount > 0
              ? `${result.immediateFailureCount} scene(s) failed to start — generating the rest…`
              : "Generating AI video scenes — this can take a few minutes…",
        })
        .eq("id", job.id)
    } catch (err) {
      // Full raw error stays server-side only — never shown to the user.
      console.error(`[reel-scripts/video] job ${job.id} submit failed:`, err instanceof Error ? err.message : err)
      await reelVideoJobsTable(admin)
        .update({
          status: "failed",
          progress_message: null,
          error_message: "Video generation failed. Please try again.",
        })
        .eq("id", job.id)
      await refundReelUsage(admin, user.id)
    }
  })

  return NextResponse.json({ data: { jobId: job.id, status: job.status } }, { status: 202 })
}

export async function GET(request: Request, { params }: RouteParams) {
  const { brandId, scriptId } = await params
  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get("jobId")
  if (!jobId) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "jobId is required."), { status: 400 })

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[reel-scripts/video] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  const { data: brand } = await supabase.from("brands").select("id").eq("id", brandId).eq("user_id", user.id).single<{ id: string }>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  const { data: job } = await supabase
    .from("reel_video_jobs")
    .select("id, status, progress_message, scene_assets, music_url, video_url, error_message")
    .eq("id", jobId)
    .eq("brand_id", brandId)
    .eq("reel_script_id", scriptId)
    .maybeSingle<Pick<ReelVideoJobRow, "id" | "status" | "progress_message" | "scene_assets" | "music_url" | "video_url" | "error_message">>()

  if (!job) return NextResponse.json(buildError(ErrorCodes.NOT_FOUND, "Video job not found."), { status: 404 })

  return NextResponse.json({ data: job })
}
