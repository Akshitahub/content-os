import sharp from "sharp"
import { IMAGE_QUALITY_SAFETY_BOILERPLATE } from "./prompts"
import { compositePostImage } from "@/lib/image/post-compositor"
import type { PostTemplateId } from "@/lib/design/post-templates"
import type { ColorTheme } from "@/lib/design/color-themes"

const CANVAS_SIZE = 1080
const MIN_BUFFER_BYTES = 5000
// Near-black or near-blank/white images are treated as a failed attempt
// even on a 200 response — Pollinations occasionally returns a placeholder
// image rather than a real error for a rejected/malformed prompt.
const NEAR_BLACK_MEAN = 8
const NEAR_BLANK_MEAN = 247

export type PostImagePipelineResult =
  | { success: true; buffer: Buffer; mimeType: string; fullPrompt: string }
  | { success: false; error: string }

function buildPollinationsUrl(prompt: string, seed: number): string {
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${CANVAS_SIZE}&height=${CANVAS_SIZE}&seed=${seed}&nologo=true&model=flux`
}

async function fetchAndCheckImage(prompt: string, seed: number): Promise<{ buffer: Buffer } | { error: string }> {
  let res: Response
  try {
    res = await fetch(buildPollinationsUrl(prompt, seed))
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Image generation request failed." }
  }

  if (!res.ok) {
    return { error: `Pollinations API error (${res.status})` }
  }

  const buffer = Buffer.from(await res.arrayBuffer())
  if (buffer.length < MIN_BUFFER_BYTES) {
    return { error: "Image response was too small to be a real photo." }
  }

  try {
    const stats = await sharp(buffer).stats()
    const means = stats.channels.slice(0, 3).map((c) => c.mean)
    const isNearBlack = means.every((m) => m <= NEAR_BLACK_MEAN)
    const isNearBlank = means.every((m) => m >= NEAR_BLANK_MEAN)
    if (isNearBlack || isNearBlank) {
      return { error: "Generated image was mostly blank or black." }
    }
  } catch {
    return { error: "Generated image could not be read." }
  }

  return { buffer }
}

function simplifyPrompt(prompt: string, brandNiche: string | null): string {
  const core = prompt.split(",")[0]?.trim() || prompt.slice(0, 150)
  const parts = [core]
  if (brandNiche) parts.push(`${brandNiche} brand aesthetic`)
  parts.push(IMAGE_QUALITY_SAFETY_BOILERPLATE)
  return parts.join(", ")
}

export interface GeneratePostImageOptions {
  imagePrompt: string
  brandNiche: string | null
  template: PostTemplateId
  colorTheme: ColorTheme
  headline: string
  ctaText: string
  logoUrl: string | null
}

/**
 * Generates the base image via Pollinations (retrying once with a
 * simplified prompt and a new seed if the first attempt fails outright or
 * comes back low-quality — capped at 1 auto-retry, 2 attempts total), then
 * composites the chosen template's overlay onto it. Never throws — every
 * failure mode returns { success: false } so the route can surface a clean
 * inline error instead of a silent blank preview.
 */
export async function generatePostImage(options: GeneratePostImageOptions): Promise<PostImagePipelineResult> {
  const fullPrompt = [
    options.imagePrompt,
    "leave the lower third of the frame visually simpler and less busy for a text overlay",
    IMAGE_QUALITY_SAFETY_BOILERPLATE,
  ].join(", ")

  const seed = Math.floor(Math.random() * 1_000_000)
  let attempt = await fetchAndCheckImage(fullPrompt, seed)

  if ("error" in attempt) {
    console.error("[post-image-pipeline] first attempt failed:", attempt.error)
    const retryPrompt = simplifyPrompt(fullPrompt, options.brandNiche)
    const retrySeed = Math.floor(Math.random() * 1_000_000)
    attempt = await fetchAndCheckImage(retryPrompt, retrySeed)

    if ("error" in attempt) {
      console.error("[post-image-pipeline] retry also failed:", attempt.error)
      return { success: false, error: "Couldn't generate a usable image after two attempts. Please try again." }
    }
  }

  try {
    const composited = await compositePostImage(attempt.buffer, {
      template: options.template,
      colorTheme: options.colorTheme,
      headline: options.headline,
      ctaText: options.ctaText,
      logoUrl: options.logoUrl,
    })
    return { success: true, buffer: composited, mimeType: "image/png", fullPrompt }
  } catch (err) {
    console.error("[post-image-pipeline] compositing failed:", err instanceof Error ? err.message : err)
    return { success: false, error: "Couldn't finish styling the generated image. Please try again." }
  }
}
