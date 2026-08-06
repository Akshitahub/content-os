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

// Deterministic reinforcement layered on top of the LLM-generated
// image_prompt (see lib/ai/prompts.ts's IMAGE_PROMPT_INSTRUCTION) — a
// code-level guarantee of industry-appropriate specificity, since the LLM
// step can't be relied on alone to avoid generic stock-photo results.
// Keyword-matched against the brand's niche; falls back to a neutral
// editorial-product-photography default when the niche doesn't match a
// known category or isn't set at all.
interface NicheStyleProfile {
  keywords: string[]
  setting: string
}

const NICHE_STYLE_PROFILES: NicheStyleProfile[] = [
  {
    keywords: ["skincare", "beauty", "cosmetic", "makeup", "haircare", "wellness", "spa"],
    setting: "clean minimalist beauty studio setting, soft diffused lighting, marble or neutral textured surface, editorial beauty product photography",
  },
  {
    keywords: ["food", "beverage", "snack", "drink", "coffee", "tea", "restaurant", "bakery", "culinary", "kitchen"],
    setting: "appetizing food photography styling, natural warm lighting, styled kitchen or table surface, 45-degree angle food styling",
  },
  {
    keywords: ["apparel", "fashion", "clothing", "wear", "garment", "footwear", "shoe", "accessor"],
    setting: "editorial fashion photography, natural outdoor or minimalist studio backdrop, fabric and texture detail visible",
  },
  {
    keywords: ["tech", "software", "saas", "app", "digital product", "startup"],
    setting: "modern minimalist tech aesthetic, clean device-focused composition, soft natural light",
  },
  {
    keywords: ["home", "decor", "furniture", "interior", "candle", "fragrance"],
    setting: "warm inviting home interior styling, natural window light, styled wood, linen, or ceramic surface",
  },
  {
    keywords: ["jewelry", "jewellery", "watch"],
    setting: "macro editorial jewelry photography, soft directional lighting, elegant neutral backdrop emphasizing texture and shine",
  },
  {
    keywords: ["fitness", "gym", "sport", "activewear", "supplement", "nutrition"],
    setting: "energetic athletic photography, natural or gym-appropriate setting, dynamic but tasteful composition",
  },
]

const DEFAULT_NICHE_SETTING = "clean editorial product photography setting appropriate to the brand's own industry"

const TECH_NICHE_KEYWORDS = ["tech", "software", "saas", "app", "digital product", "startup"]

const PHOTOGRAPHY_STYLE = "professional product photography, natural editorial lighting, premium D2C brand aesthetic, high-detail commercial quality"

// Word-boundary match, not a raw substring — a plain .includes() would
// false-positive on e.g. "apparel" containing the tech keyword "app", or
// "instead" containing the food keyword "tea".
function matchesKeyword(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`\\b${escaped}\\b`, "i").test(text)
}

function resolveNicheSetting(niche: string | null): string {
  if (!niche) return DEFAULT_NICHE_SETTING
  const match = NICHE_STYLE_PROFILES.find((profile) => profile.keywords.some((k) => matchesKeyword(niche, k)))
  return match?.setting ?? DEFAULT_NICHE_SETTING
}

function isTechLikeNiche(niche: string | null): boolean {
  if (!niche) return false
  return TECH_NICHE_KEYWORDS.some((k) => matchesKeyword(niche, k))
}

// Only applied for non-tech niches — a laptop/office scene is often
// actually correct for a genuine SaaS/tech brand, so the guard would be
// counterproductive there.
function buildNegativeGuard(niche: string | null): string {
  if (isTechLikeNiche(niche)) return ""
  return "avoid generic corporate stock-photo clichés — no laptops on a desk, no empty office interiors, no generic handshake or boardroom meeting scenes"
}

function simplifyPrompt(prompt: string, brandNiche: string | null): string {
  const core = prompt.split(",")[0]?.trim() || prompt.slice(0, 150)
  return [
    core,
    brandNiche ? `${brandNiche} brand` : "",
    resolveNicheSetting(brandNiche),
    PHOTOGRAPHY_STYLE,
    IMAGE_QUALITY_SAFETY_BOILERPLATE,
  ].filter(Boolean).join(", ")
}

export interface GeneratePostImageOptions {
  imagePrompt: string
  brandNiche: string | null
  targetAudience: string | null
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
  // Deterministic grounding, independent of how well the LLM-generated
  // imagePrompt followed instructions — every image gets an
  // industry-appropriate setting, a consistent premium photography style,
  // and (for non-tech niches) a guard against generic corporate stock-photo
  // compositions, regardless of what the model itself produced.
  const fullPrompt = [
    options.imagePrompt,
    options.brandNiche ? `${options.brandNiche} brand` : "",
    resolveNicheSetting(options.brandNiche),
    options.targetAudience ? `styled to appeal to ${options.targetAudience}` : "",
    PHOTOGRAPHY_STYLE,
    buildNegativeGuard(options.brandNiche),
    "leave the lower third of the frame visually simpler and less busy for a text overlay",
    IMAGE_QUALITY_SAFETY_BOILERPLATE,
  ].filter(Boolean).join(", ")

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
