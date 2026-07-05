import { getGroqClient } from "@/lib/ai/models"
import { uploadMediaToStorage } from "@/lib/storage/upload-media"
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

// Stagger each scene's start so we don't fire every scene's image + TTS
// request at the same instant — that's what was tripping Pollinations'
// and Groq's rate limits in production for reels with 6-10 scenes.
const SCENE_STAGGER_MS = 700

// Exponential backoff for rate-limited (429) calls: 500ms, 1s, 2s, (4s if
// ever extended past 3 retries).
const BACKOFF_DELAYS_MS = [500, 1000, 2000, 4000]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()
  return msg.includes("429") || msg.includes("rate_limit") || msg.includes("rate limit")
}

/** Retries `fn` with exponential backoff when it fails with a rate-limit (429) error. */
async function retryOn429<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
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
  imageUrl: string | null
  audioUrl: string | null
  error: string | null
}

function buildScenePollinationsUrl(visualDirection: string, seed: number): string {
  // Same prompt-shaping already used for reel scene previews in
  // components/generate/FullPostGenerator.tsx's ContentDisplay.
  const prompt = encodeURIComponent(`${visualDirection}, cinematic, vertical video frame, 9:16`)
  return `https://image.pollinations.ai/prompt/${prompt}?width=1080&height=1920&seed=${seed}&nologo=true&model=flux`
}

async function generateSceneImage(
  brandId: string,
  scriptId: string,
  sceneIndex: number,
  visualDirection: string
): Promise<{ url: string } | { error: string }> {
  const pollinationsUrl = buildScenePollinationsUrl(visualDirection, sceneIndex + 1)

  const uploadResult = await uploadMediaToStorage(
    { kind: "remoteUrl", url: pollinationsUrl },
    `${brandId}/reel-video/${scriptId}/scene-${sceneIndex}-image`
  )
  if ("error" in uploadResult) {
    console.error(`[reel-scene-assets] scene ${sceneIndex} image hosting failed:`, uploadResult.error)
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
 * Generates one AI image (Pollinations, re-hosted to Supabase Storage for
 * reliability) and one Groq TTS voiceover clip per scene. Each scene's start
 * is staggered by SCENE_STAGGER_MS rather than firing all scenes at once —
 * reel scripts can have 6-10 scenes, and generating everything simultaneously
 * was tripping Pollinations' and Groq's rate limits in production. Never
 * throws: a failure on one scene is captured in that scene's own `error`
 * field rather than aborting the whole batch, so the caller can decide how
 * to handle partial failures.
 */
export async function generateSceneAssets(
  brandId: string,
  scriptId: string,
  scenes: ReelScene[]
): Promise<SceneAsset[]> {
  return Promise.all(
    scenes.map(async (scene, sceneIndex): Promise<SceneAsset> => {
      await sleep(sceneIndex * SCENE_STAGGER_MS)

      const [imageResult, audioResult] = await Promise.all([
        generateSceneImage(brandId, scriptId, sceneIndex, scene.visual_direction),
        generateSceneVoiceover(brandId, scriptId, sceneIndex, scene.voiceover_or_text_overlay),
      ])

      const errors = [
        "error" in imageResult ? `Image: ${imageResult.error}` : null,
        "error" in audioResult ? `Voiceover: ${audioResult.error}` : null,
      ].filter((e): e is string => e !== null)

      return {
        sceneIndex,
        visualDirection: scene.visual_direction,
        voiceoverText: scene.voiceover_or_text_overlay,
        durationSeconds: scene.duration_seconds,
        imageUrl: "url" in imageResult ? imageResult.url : null,
        audioUrl: "url" in audioResult ? audioResult.url : null,
        error: errors.length > 0 ? errors.join(" ") : null,
      }
    })
  )
}
