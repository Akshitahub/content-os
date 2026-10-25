import OpenAI, { APIError } from "openai"
import { toFile } from "openai/core/uploads"
import { getOpenAIClient } from "./models"
import { imageCostUsd } from "./pricing"

// The only provider for AI image generation in this codebase -- every
// caller (Post, Story, Carousel, Ad Maker, the standalone Images tab,
// Autopilot/Fastlane) goes through lib/ai/post-image-pipeline.ts's
// fetchBackgroundImage, which calls generateOpenAIImage below. No fallback
// to any other image provider.
export const IMAGE_PROVIDER = "openai" as const

// Single place to change the model, default quality, or per-call timeout --
// e.g. bump model to "gpt-image-1.5" or raise quality to "high" by editing
// one line here. Confirmed against the installed `openai` SDK's own
// ImageModel type (node_modules/openai/resources/images.d.ts) that
// "gpt-image-2" is a real, currently-valid model literal, not a guess.
export const IMAGE_PROVIDER_CONFIG = {
  model: "gpt-image-2" as const,
  /** "low" | "medium" | "high" | "auto" -- GPT image models only. */
  quality: "medium" as const,
  /** Per-call timeout passed straight through as the SDK's own
   * RequestOptions.timeout. Kept well under the 60s maxDuration every
   * caller route sets, since fetchBackgroundImage can make up to 2
   * sequential calls (primary + fallback-prompt retry) on top of whatever
   * this SDK call retries internally. */
  timeoutMs: 25_000,
  /** SDK-native retry count for transient failures (network errors, 429,
   * 5xx) -- the SDK itself inspects the status code and retry-after header,
   * so there's no hand-rolled retry loop here. Moderation rejections are
   * never retried (see isModerationError below) since retrying the exact
   * same prompt against a content-policy rejection can't succeed. */
  maxRetries: 1,
  /** Native generation sizes, one per aspect ratio a caller can ask for --
   * resolveImageSize below picks the one whose ratio is closest to the
   * requested canvas. Each matches its canvas's ratio EXACTLY (so the
   * final `fit: "cover"` resize in the pipeline/compositors scales rather
   * than crops). Every size must satisfy gpt-image-2's rules -- see
   * isValidImageSize below; scripts/test-image-gen.ts checks them all.
   * Was "1024x1536" (2:3) for both portrait canvases, which cropped ~17%
   * of a 4:5 post's height and ~14% of a 9:16 story's width away. */
  sizes: {
    /** 1:1 -- the standalone Images tab, square Ad Maker. */
    square: "1024x1024",
    /** 4:5 -- Post, Carousel slides, portrait Ad Maker (canvas 1080x1350).
     * Slightly larger than the canvas, so it's only ever scaled down.
     * 1,479,680 px -- fewer than the old 1024x1536 (1,572,864). */
    portrait: "1088x1360",
    /** 9:16 -- Story slides, story Ad Maker (canvas 1080x1920). Scaled up
     * ~7% to the canvas; 1152x2048 (also exact 9:16) would avoid that but
     * is ~31% more pixels than this (cost/latency not published by OpenAI
     * for custom sizes). 1,806,336 px. */
    story: "1008x1792",
    /** 3:2 -- landscape (Images-tab 16:9 still maps here; unchanged). */
    landscape: "1536x1024",
  },
} as const

// gpt-image-2's size rules, from OpenAI's image-generation guide
// (developers.openai.com/api/docs/guides/image-generation, "Size
// constraints" for gpt-image-2, checked 2026-10-25): both edges multiples
// of 16px; max edge <= 3840px; long:short edge ratio <= 3:1; total pixels
// between 655,360 and 8,294,400. The installed SDK's own docstring agrees
// (`WIDTHxHEIGHT` strings, both edges divisible by 16).
export function isValidImageSize(size: string): boolean {
  const m = /^(\d+)x(\d+)$/.exec(size)
  if (!m) return false
  const w = Number(m[1])
  const h = Number(m[2])
  const pixels = w * h
  return (
    w % 16 === 0 && h % 16 === 0 &&
    Math.max(w, h) <= 3840 &&
    Math.max(w, h) / Math.min(w, h) <= 3 &&
    pixels >= 655_360 && pixels <= 8_294_400
  )
}

export interface ImageDimensions {
  width: number
  height: number
  /** Human-readable label (e.g. "1:1", "9:16") for logs only --
   * resolveImageSize picks the native size from width/height, never from
   * this label, and it's never sent to the API. */
  aspectRatio: string
}

export type OpenAIImageSize = (typeof IMAGE_PROVIDER_CONFIG.sizes)[keyof typeof IMAGE_PROVIDER_CONFIG.sizes]

function sizeRatio(size: string): number {
  const [w, h] = size.split("x").map(Number)
  return w! / h!
}

/** The configured size whose aspect ratio is closest to the requested canvas (compared on a log scale, so 2:1 and 1:2 are equally far from 1:1). */
export function resolveImageSize(dimensions: ImageDimensions): OpenAIImageSize {
  const target = Math.log(dimensions.width / dimensions.height)
  const sizes = Object.values(IMAGE_PROVIDER_CONFIG.sizes)
  return sizes.reduce((best, size) =>
    Math.abs(Math.log(sizeRatio(size)) - target) < Math.abs(Math.log(sizeRatio(best)) - target) ? size : best
  )
}

export type ImageProviderFailureReason = "network_error" | "api_error" | "moderation_blocked"

// costUsd: priced from the response's real usage (lib/ai/pricing.ts) --
// present whenever OpenAI actually returned a response (it billed for
// it), null when the call failed before a response or reported no usage.
export type ImageProviderResult =
  | { buffer: Buffer; costUsd: number | null }
  | { error: string; reason: ImageProviderFailureReason; costUsd: number | null }

// OpenAI reports a moderation/safety rejection as a 400 whose error body
// names it explicitly -- checked by `.code` first (the structured,
// documented signal) and falls back to a message match only if `.code`
// isn't populated for some reason, same defensive-fallback pattern
// lib/ai/models.ts's classifyGroqError already uses for its own provider.
function isModerationError(err: unknown): boolean {
  if (err instanceof APIError) {
    if (err.code === "moderation_blocked" || err.code === "content_policy_violation") return true
    if (typeof err.message === "string" && /moderation|safety system|content policy/i.test(err.message)) return true
  }
  return false
}

async function fetchReferenceImageFile(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch the reference photo (${res.status}).`)
  const buffer = Buffer.from(await res.arrayBuffer())
  return toFile(buffer, "reference.png", { type: "image/png" })
}

async function callOpenAIImageAPI(
  prompt: string,
  size: OpenAIImageSize,
  referenceImageUrl?: string | null
): Promise<OpenAI.Images.ImagesResponse> {
  const openai = getOpenAIClient()
  const requestOptions = { timeout: IMAGE_PROVIDER_CONFIG.timeoutMs, maxRetries: IMAGE_PROVIDER_CONFIG.maxRetries }

  // A real uploaded product photo routes through the images.edit endpoint
  // with that photo as input -- the only flow in this codebase that passes
  // a reference image. images.generate has no `image` input at all; GPT
  // image models always return base64 (never a hosted url) from either
  // endpoint, confirmed against the SDK's own ImagesResponse/Image types.
  if (referenceImageUrl) {
    const imageFile = await fetchReferenceImageFile(referenceImageUrl)
    return openai.images.edit(
      {
        model: IMAGE_PROVIDER_CONFIG.model,
        image: imageFile,
        prompt,
        size,
        quality: IMAGE_PROVIDER_CONFIG.quality,
        output_format: "png",
      },
      requestOptions
    )
  }

  return openai.images.generate(
    {
      model: IMAGE_PROVIDER_CONFIG.model,
      prompt,
      size,
      quality: IMAGE_PROVIDER_CONFIG.quality,
      n: 1,
      output_format: "png",
    },
    requestOptions
  )
}

/**
 * The only place in this codebase that talks to an image-generation
 * provider -- lib/ai/post-image-pipeline.ts's fetchBackgroundImage is the
 * only caller, the same single-chokepoint shape the previous provider's
 * call had. Decodes the returned base64 image into a Buffer. Never throws --
 * every failure mode (timeout, rate limit, moderation rejection, malformed
 * response) returns { error, reason } instead, so a failed call never
 * reaches the caller as an uncaught rejection and never consumes credits
 * (the caller only charges/keeps a charge on a successful result).
 */
export async function generateOpenAIImage(
  prompt: string,
  dimensions: ImageDimensions,
  /** Real uploaded product photo URL, if one is attached for this
   * generation -- routes through images.edit instead of images.generate. */
  referenceImageUrl?: string | null
): Promise<ImageProviderResult> {
  const size = resolveImageSize(dimensions)
  console.log(`[image-provider] calling ${IMAGE_PROVIDER_CONFIG.model}: size=${size} quality=${IMAGE_PROVIDER_CONFIG.quality} promptLen=${prompt.length} reference=${referenceImageUrl ? "yes" : "no"}`)

  try {
    const response = await callOpenAIImageAPI(prompt, size, referenceImageUrl)
    const costUsd = imageCostUsd(IMAGE_PROVIDER_CONFIG.model, response.usage)
    const b64 = response.data?.[0]?.b64_json
    if (!b64) {
      console.error(`[image-provider] OpenAI returned no image data in its response`)
      return { error: "The image provider returned no image data.", reason: "api_error", costUsd }
    }
    console.log(`[image-provider] success: model=${IMAGE_PROVIDER_CONFIG.model} quality=${IMAGE_PROVIDER_CONFIG.quality} size=${size} costUsd=${costUsd ?? "unknown"}`)
    return { buffer: Buffer.from(b64, "base64"), costUsd }
  } catch (err) {
    console.error(`[image-provider] call failed: model=${IMAGE_PROVIDER_CONFIG.model} size=${size}`, err)

    if (isModerationError(err)) {
      return {
        error: "This image couldn't be generated because the request was flagged by the safety system. Try rephrasing the description.",
        reason: "moderation_blocked",
        costUsd: null,
      }
    }

    // The SDK throws APIConnectionTimeoutError (not a plain APIError) when
    // RequestOptions.timeout above is hit -- surfaced as a distinct reason
    // so a timeout is distinguishable from a real API error in
    // image_generation_attempts.
    if (err instanceof Error && /timed? ?out/i.test(err.message)) {
      return { error: "Image generation timed out.", reason: "network_error", costUsd: null }
    }

    const detail = err instanceof Error ? err.message : String(err)
    return { error: `Image generation failed: ${detail}`, reason: "api_error", costUsd: null }
  }
}
