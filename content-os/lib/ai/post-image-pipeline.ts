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

async function fetchAndCheckImage(prompt: string, seed: number): Promise<{ buffer: Buffer } | { error: string } > {
  const url = buildPollinationsUrl(prompt, seed)
  console.log(`[post-image-pipeline] calling Pollinations: seed=${seed} promptLen=${prompt.length} url=${url.slice(0, 200)}${url.length > 200 ? "…" : ""}`)

  let res: Response
  try {
    res = await fetch(url)
  } catch (err) {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    console.error(`[post-image-pipeline] Pollinations fetch threw before any response (network/DNS/timeout-level failure):`, detail)
    return { error: err instanceof Error ? err.message : "Image generation request failed." }
  }

  console.log(`[post-image-pipeline] Pollinations responded: status=${res.status} content-type=${res.headers.get("content-type")}`)

  if (!res.ok) {
    // Read the body even on failure — Pollinations returns a JSON or plain
    // text error body (rate limit, invalid model, prompt rejected, etc.)
    // that the status code alone doesn't explain.
    let bodyText = ""
    try {
      bodyText = (await res.text()).slice(0, 500)
    } catch (readErr) {
      bodyText = `<failed to read response body: ${readErr instanceof Error ? readErr.message : String(readErr)}>`
    }
    console.error(`[post-image-pipeline] Pollinations returned non-200: status=${res.status} statusText=${res.statusText} body=${JSON.stringify(bodyText)}`)
    return { error: `Pollinations API error (${res.status}): ${bodyText || res.statusText}` }
  }

  const buffer = Buffer.from(await res.arrayBuffer())
  console.log(`[post-image-pipeline] Pollinations image buffer: ${buffer.length} bytes`)
  if (buffer.length < MIN_BUFFER_BYTES) {
    return { error: `Image response was too small to be a real photo (${buffer.length} bytes).` }
  }

  try {
    const stats = await sharp(buffer).stats()
    const means = stats.channels.slice(0, 3).map((c) => c.mean)
    const isNearBlack = means.every((m) => m <= NEAR_BLACK_MEAN)
    const isNearBlank = means.every((m) => m >= NEAR_BLANK_MEAN)
    if (isNearBlack || isNearBlank) {
      console.error(`[post-image-pipeline] image failed quality check: channel means=${JSON.stringify(means)}`)
      return { error: "Generated image was mostly blank or black." }
    }
  } catch (err) {
    console.error(`[post-image-pipeline] sharp couldn't read the response as an image:`, err instanceof Error ? err.message : err)
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
      // Keep the real reason in the message (not just the logs) — a fully
      // generic string here was hiding the actual cause from the API
      // response too, not just from the user-facing copy.
      return { success: false, error: `Couldn't generate a usable image after two attempts. Last error: ${attempt.error}` }
    }
  }

  console.log(
    `[post-image-pipeline] compositing: template=${options.template} colorTheme=${options.colorTheme.id} logoUrl=${options.logoUrl ? "present" : "none"} headlineLen=${options.headline.length}`
  )

  try {
    const composited = await compositePostImage(attempt.buffer, {
      template: options.template,
      colorTheme: options.colorTheme,
      headline: options.headline,
      ctaText: options.ctaText,
      logoUrl: options.logoUrl,
    })
    console.log(`[post-image-pipeline] composited successfully: ${composited.length} bytes`)
    return { success: true, buffer: composited, mimeType: "image/png", fullPrompt }
  } catch (err) {
    console.error("[post-image-pipeline] compositing failed:", err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : err)
    return { success: false, error: "Couldn't finish styling the generated image. Please try again." }
  }
}
