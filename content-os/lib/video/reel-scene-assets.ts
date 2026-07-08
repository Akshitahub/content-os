import { getGroqClient } from "@/lib/ai/models"
import { uploadMediaToStorage } from "@/lib/storage/upload-media"
import { generateKlingVideo } from "@/lib/video/kling-client"
import type { ReelScene } from "@/types/app"

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

// Stagger each scene's start so we don't fire every scene's video + TTS
// request at the same instant — this originally guarded against
// Pollinations' and Groq's rate limits (700ms wasn't enough headroom under
// real load; bumped to 1500ms), and matters just as much now that "image"
// generation means a real Kling job with its own per-account concurrency
// limits.
const SCENE_STAGGER_MS = 1500

// Exponential backoff for rate-limited (429) calls: 1s, 2s, 4s, 8s over up
// to 4 retries — widened from 3 retries (500ms-4s) after production testing
// still showed most scenes failing with 429s under the shorter backoff.
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

export interface SceneAsset {
  sceneIndex: number
  visualDirection: string
  voiceoverText: string
  durationSeconds: number
  videoUrl: string | null
  audioUrl: string | null
  error: string | null
}

/**
 * Generates a real motion video clip for one scene via Kling AI (replacing
 * the earlier Pollinations still-image approach), then re-hosts it to
 * Supabase Storage — Kling's own returned URLs aren't guaranteed to stay
 * reachable long-term, same reasoning as the image/audio re-hosting below.
 */
async function generateSceneVideo(
  brandId: string,
  scriptId: string,
  sceneIndex: number,
  visualDirection: string,
  durationSeconds: number
): Promise<{ url: string } | { error: string }> {
  const result = await generateKlingVideo(visualDirection, {
    durationSeconds,
    aspectRatio: "9:16",
  })

  if (!result.success) {
    console.error(`[reel-scene-assets] scene ${sceneIndex} Kling generation failed:`, result.error)
    return { error: result.error }
  }

  const uploadResult = await uploadMediaToStorage(
    { kind: "remoteUrl", url: result.videoUrl },
    `${brandId}/reel-video/${scriptId}/scene-${sceneIndex}-video`
  )
  if ("error" in uploadResult) {
    console.error(`[reel-scene-assets] scene ${sceneIndex} video hosting failed:`, uploadResult.error)
    return { error: uploadResult.error }
  }
  return { url: uploadResult.publicUrl }
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
        input: text.slice(0, 2000),
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

/**
 * Generates one real AI video clip (Kling, re-hosted to Supabase Storage for
 * reliability) and one Groq TTS voiceover clip per scene. Each scene's start
 * is staggered by SCENE_STAGGER_MS rather than firing all scenes at once —
 * reel scripts can have 6-10 scenes, and generating everything simultaneously
 * risks tripping Kling's and Groq's rate/concurrency limits. Never throws: a
 * failure on one scene is captured in that scene's own `error` field rather
 * than aborting the whole batch, so the caller can decide how to handle
 * partial failures.
 *
 * `scenePromptOverrides` lets a caller substitute a scene's own
 * `visual_direction` with a user-confirmed prompt (raw or AI-enhanced, from
 * the prompt-suggestion step) — index-aligned with `scenes`, and optional
 * per-index so a script's original prompt is used wherever no override was
 * supplied.
 */
export async function generateSceneAssets(
  brandId: string,
  scriptId: string,
  scenes: ReelScene[],
  scenePromptOverrides?: (string | undefined)[]
): Promise<SceneAsset[]> {
  return Promise.all(
    scenes.map(async (scene, sceneIndex): Promise<SceneAsset> => {
      await sleep(sceneIndex * SCENE_STAGGER_MS)

      const prompt = scenePromptOverrides?.[sceneIndex]?.trim() || scene.visual_direction

      const [videoResult, audioResult] = await Promise.all([
        generateSceneVideo(brandId, scriptId, sceneIndex, prompt, scene.duration_seconds),
        generateSceneVoiceover(brandId, scriptId, sceneIndex, scene.voiceover_or_text_overlay),
      ])

      const errors = [
        "error" in videoResult ? `Video: ${videoResult.error}` : null,
        "error" in audioResult ? `Voiceover: ${audioResult.error}` : null,
      ].filter((e): e is string => e !== null)

      return {
        sceneIndex,
        visualDirection: prompt,
        voiceoverText: scene.voiceover_or_text_overlay,
        durationSeconds: scene.duration_seconds,
        videoUrl: "url" in videoResult ? videoResult.url : null,
        audioUrl: "url" in audioResult ? audioResult.url : null,
        error: errors.length > 0 ? errors.join(" ") : null,
      }
    })
  )
}
