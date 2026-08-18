import type { SupabaseClient } from "@supabase/supabase-js"
import { getGroqClient } from "@/lib/ai/models"
import { uploadMediaToStorage } from "@/lib/storage/upload-media"
import { submitKlingVideoJob, type KlingWebhookConfig } from "@/lib/video/kling-client"
import type { ReelScene } from "@/types/app"
import type { Database } from "@/types/database"

// Groq's TTS model — priced per character ($50/1M chars as of writing),
// unlike the free-tier llama models used elsewhere in this codebase.
// Every video generated has a real, non-trivial cost.
//
// playai-tts was decommissioned by Groq in December 2025, replaced by
// Canopy Labs' Orpheus models. Valid Orpheus English voices: troy,
// autumn, diana, hannah, austin, daniel — "troy" is used here as a
// reasonable default professional-sounding voice. There is no PlayAI
// voice list to carry over (Fritz-PlayAI no longer exists).
const TTS_MODEL = "canopylabs/orpheus-v1-english"
const TTS_VOICE = "troy"

// Stagger each scene's Kling submission + TTS call so we don't fire
// everything at the same instant — guards against PiAPI's and Groq's
// per-account rate/concurrency limits. Submission itself is now fast (no
// polling happens here), so this only adds a few seconds total even for a
// 10-scene reel, not the minutes it used to when each stagger step also
// waited out a full generation.
const SCENE_STAGGER_MS = 1500

// Exponential backoff for rate-limited (429) TTS calls: 1s, 2s, 4s, 8s over
// up to 4 retries — widened from 3 retries (500ms-4s) after production
// testing still showed most calls failing with 429s under the shorter backoff.
const BACKOFF_DELAYS_MS = [1000, 2000, 4000, 8000]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()
  return msg.includes("429") || msg.includes("rate_limit") || msg.includes("rate limit")
}

/** Retries `fn` with exponential backoff when it fails with a rate-limit (429) error. */
async function retryOn429<T>(fn: () => Promise<T>, maxRetries = 4): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt >= maxRetries || !isRateLimitError(err)) throw err
      const delay = BACKOFF_DELAYS_MS[attempt] ?? BACKOFF_DELAYS_MS[BACKOFF_DELAYS_MS.length - 1]
      console.log(`[reel-scene-assets] Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`)
      await sleep(delay)
    }
  }
}

async function generateSceneVoiceover(
  brandId: string,
  scriptId: string,
  sceneIndex: number,
  text: string
): Promise<{ url: string } | { error: string }> {
  if (!text.trim()) {
    return { error: "No voiceover/text-overlay text for this scene." }
  }

  try {
    const groq = getGroqClient()
    const speech = await retryOn429(() =>
      groq.audio.speech.create({
        input: text.slice(0, 200),
        model: TTS_MODEL,
        voice: TTS_VOICE,
        response_format: "wav",
      })
    )

    const arrayBuffer = await speech.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const uploadResult = await uploadMediaToStorage(
      { kind: "buffer", buffer, mimeType: "audio/wav" },
      `${brandId}/reel-video/${scriptId}/scene-${sceneIndex}-audio`
    )
    if ("error" in uploadResult) {
      console.error(`[reel-scene-assets] scene ${sceneIndex} voiceover hosting failed:`, uploadResult.error)
      return { error: uploadResult.error }
    }
    return { url: uploadResult.publicUrl }
  } catch (err) {
    // Log the full raw error (e.g. Groq's API error body) server-side only —
    // never surface it directly, since SDK errors often embed raw JSON in
    // their message and this ends up rendered in end-user-facing UI.
    console.error(`[reel-scene-assets] TTS failed for scene ${sceneIndex}:`, err instanceof Error ? err.message : err)
    return { error: "Couldn't generate voiceover for this scene. Please try again." }
  }
}

export interface SubmitScenesResult {
  totalScenes: number
  /** Scenes with a valid Kling task_id, now awaiting the webhook. */
  pendingCount: number
  /** Scenes whose Kling submit call itself failed — no webhook will ever arrive for these. */
  immediateFailureCount: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reelVideoJobScenesTable(supabase: SupabaseClient<Database>): any {
  return supabase.from("reel_video_job_scenes")
}

/**
 * Submits one Kling video-generation task per scene (webhook-driven, not
 * polled) and one Groq TTS voiceover per scene (still synchronous — TTS is
 * fast and isn't the timeout risk Kling's full generation was), then
 * writes one reel_video_job_scenes row per scene recording the outcome.
 * Each scene's start is staggered by SCENE_STAGGER_MS, same reasoning as
 * before: reel scripts can have 6-10 scenes, and firing everything at once
 * risks tripping PiAPI's and Groq's rate/concurrency limits.
 *
 * Never throws: a scene whose Kling submit fails outright gets a 'failed'
 * row immediately (no webhook will ever arrive for it) rather than
 * aborting the whole batch — the caller decides what a job with 0 pending
 * scenes means (total failure, nothing to wait for).
 *
 * `scenePromptOverrides` lets a caller substitute a scene's own
 * `visual_direction` with a user-confirmed prompt (raw or AI-enhanced, from
 * the prompt-suggestion step) — index-aligned with `scenes`, and optional
 * per-index so a script's original prompt is used wherever no override was
 * supplied.
 */
export async function submitSceneAssetJobs(
  supabase: SupabaseClient<Database>,
  brandId: string,
  scriptId: string,
  jobId: string,
  scenes: ReelScene[],
  scenePromptOverrides: (string | undefined)[] | undefined,
  webhook: KlingWebhookConfig
): Promise<SubmitScenesResult> {
  const rows = await Promise.all(
    scenes.map(async (scene, sceneIndex) => {
      await sleep(sceneIndex * SCENE_STAGGER_MS)

      const prompt = scenePromptOverrides?.[sceneIndex]?.trim() || scene.visual_direction

      const [submitResult, audioResult] = await Promise.all([
        submitKlingVideoJob(prompt, { durationSeconds: scene.duration_seconds, aspectRatio: "9:16" }, webhook),
        generateSceneVoiceover(brandId, scriptId, sceneIndex, scene.voiceover_or_text_overlay),
      ])

      const audioUrl = "url" in audioResult ? audioResult.url : null

      if ("error" in submitResult) {
        console.error(`[reel-scene-assets] scene ${sceneIndex} Kling submit failed:`, submitResult.error)
        return {
          job_id: jobId,
          scene_index: sceneIndex,
          visual_direction: prompt,
          voiceover_text: scene.voiceover_or_text_overlay,
          duration_seconds: scene.duration_seconds,
          kling_task_id: null,
          status: "failed" as const,
          video_url: null,
          audio_url: audioUrl,
          error_message: `Video: ${submitResult.error}`,
        }
      }

      return {
        job_id: jobId,
        scene_index: sceneIndex,
        visual_direction: prompt,
        voiceover_text: scene.voiceover_or_text_overlay,
        duration_seconds: scene.duration_seconds,
        kling_task_id: submitResult.taskId,
        status: "pending" as const,
        video_url: null,
        audio_url: audioUrl,
        error_message: null,
      }
    })
  )

  const { error: insertError } = await reelVideoJobScenesTable(supabase).insert(rows)
  if (insertError) {
    console.error(`[reel-scene-assets] failed to insert scene rows for job ${jobId}:`, insertError)
  }

  const pendingCount = rows.filter((r) => r.status === "pending").length
  return {
    totalScenes: rows.length,
    pendingCount,
    immediateFailureCount: rows.length - pendingCount,
  }
}
