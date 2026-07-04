import { NextResponse, after } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { generateSceneAssets } from "@/lib/video/reel-scene-assets"
import type { ReelScriptRow, ReelVideoJobRow, ReelVideoJobInsert, Json } from "@/types/database"
import type { ReelScene } from "@/types/app"

type RouteParams = { params: Promise<{ brandId: string; scriptId: string }> }

// Placeholder tracks — see public/audio/README.md. These are genuinely
// silent, code-generated files, not a real royalty-free asset.
const MUSIC_TRACKS = [
  "/audio/reel-music-1-placeholder-silent.wav",
  "/audio/reel-music-2-placeholder-silent.wav",
  "/audio/reel-music-3-placeholder-silent.wav",
]

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

export async function POST(_request: Request, { params }: RouteParams) {
  const { brandId, scriptId } = await params
  console.log(`[reel-scripts/${scriptId}/video] POST called`)

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

  const musicUrl = MUSIC_TRACKS[Math.floor(Math.random() * MUSIC_TRACKS.length)]!

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

  // Runs after the response is sent, so the client isn't held open while
  // several image + TTS calls complete. Still bounded by the function's
  // own max execution duration — it just doesn't block the HTTP response.
  after(async () => {
    const admin = await createAdminClient()

    try {
      await reelVideoJobsTable(admin)
        .update({ status: "generating_images", progress_message: "Generating scene images and voiceover…" })
        .eq("id", job.id)

      const sceneAssets = await generateSceneAssets(brandId, scriptId, scenes)
      const failedScenes = sceneAssets.filter((s) => s.error)
      const hasUsableAssets = sceneAssets.some((s) => s.imageUrl && s.audioUrl)

      if (!hasUsableAssets) {
        await reelVideoJobsTable(admin)
          .update({
            status: "failed",
            progress_message: null,
            scene_assets: sceneAssets as unknown as Json,
            error_message: `Couldn't generate any usable scene assets. ${failedScenes[0]?.error ?? ""}`.trim(),
          })
          .eq("id", job.id)
        return
      }

      // Rendering is intentionally not implemented yet — see
      // lib/video/render-trigger.ts. The job stops here, at a genuine
      // success state for everything that IS built, rather than a
      // "rendering" state that never progresses or a "failed" state for
      // a known, disclosed limitation rather than a bug.
      await reelVideoJobsTable(admin)
        .update({
          status: "assets_ready",
          progress_message:
            failedScenes.length > 0
              ? `Scene assets ready — ${failedScenes.length} scene(s) had an issue and may need attention.`
              : "All scene assets generated. Video rendering isn't wired up yet (see project notes).",
          scene_assets: sceneAssets as unknown as Json,
        })
        .eq("id", job.id)
    } catch (err) {
      console.error(`[reel-scripts/video] job ${job.id} failed:`, err instanceof Error ? err.message : err)
      await reelVideoJobsTable(admin)
        .update({
          status: "failed",
          progress_message: null,
          error_message: err instanceof Error ? err.message : "Video asset generation failed.",
        })
        .eq("id", job.id)
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
