import sharp from "sharp"
import Replicate from "replicate"
import { IMAGE_QUALITY_SAFETY_BOILERPLATE } from "./prompts"
import { compositePostImage } from "@/lib/image/post-compositor"
import type { PostTemplateId } from "@/lib/design/post-templates"
import type { ColorTheme } from "@/lib/design/color-themes"
import type { UserPlan } from "@/types/app"

const CANVAS_SIZE = 1080
const MIN_BUFFER_BYTES = 5000
// Near-black or near-blank/white images are treated as a failed attempt
// even on a 200 response — both providers occasionally return a
// placeholder image rather than a real error for a rejected/malformed
// prompt (Pollinations) or a moderation refusal (Replicate/Flux).
const NEAR_BLACK_MEAN = 8
const NEAR_BLANK_MEAN = 247

// Pinned to a specific version string (not just "black-forest-labs/flux-2-pro"'s
// unversioned alias) isn't required here — Replicate's `owner/model` form
// without a `:version` always resolves to that model's current default
// version, which is what every other Flux example in this codebase's
// research showed. Kept as one named constant so bumping to a newer Flux
// release later is a one-line change, not a call-site hunt.
const FLUX_MODEL = "black-forest-labs/flux-2-pro"

// Replicate's black-forest-labs/flux-2-pro controls output resolution via a
// `resolution` input — a string enum ("0.5 MP" | "1 MP" | "2 MP" | "4 MP" |
// "match_input_image"), NOT the `megapixels` field (with bare numeric
// strings) this code sent until 2026-08-17. That field name doesn't exist
// in the model's live schema at all — confirmed directly from Replicate's
// own OpenAPI schema for this model (pulled from the model page's embedded
// JSON, since the page itself is client-rendered). The old `megapixels`
// field was a validation-error-free no-op: Replicate silently drops
// unrecognized input keys rather than rejecting the call, so every prior
// Flux call ran at the schema's default ("1 MP", ~1024x1024) regardless of
// what tier this code picked — smaller than this app's 1080x1080 (and
// Stories' 1080x1920) compositing targets, which is exactly what was
// causing compositePostImage's forced resize to upscale (blur) Flux
// images. See docs/research/seedream-5-lite-evaluation.md for how this was
// found. No "0.25 MP" tier exists in the real enum, so the smallest valid
// tier is "0.5 MP".
const FLUX_RESOLUTION_TIERS = ["0.5 MP", "1 MP", "2 MP", "4 MP"] as const

function resolveFluxResolution(dimensions: ImageDimensions): string {
  const targetMP = (dimensions.width * dimensions.height) / 1_000_000
  const tier = FLUX_RESOLUTION_TIERS.find((t) => parseFloat(t) >= targetMP) ?? FLUX_RESOLUTION_TIERS[FLUX_RESOLUTION_TIERS.length - 1]
  return tier
}

export interface ImageDimensions {
  width: number
  height: number
  /** Replicate/Flux's own aspect-ratio param format, e.g. "1:1", "9:16". */
  aspectRatio: string
}

// Square, matching the post/carousel compositing target — the default for
// every existing caller so this stays behavior-preserving for them.
// Callers with a different canvas shape (e.g. lib/ai/story-slide-background.ts's
// portrait Stories slides) pass their own ImageDimensions explicitly.
const SQUARE_DIMENSIONS: ImageDimensions = { width: CANVAS_SIZE, height: CANVAS_SIZE, aspectRatio: "1:1" }

export type PostImagePipelineResult =
  | { success: true; buffer: Buffer; mimeType: string; fullPrompt: string }
  | { success: false; error: string }

// Shared by both providers — a failed generation can come back as a 200
// with a placeholder/refusal image just as easily as a network error, so
// every fetched buffer goes through the same size + blank/black check
// before being treated as usable.
async function checkImageQuality(buffer: Buffer): Promise<{ ok: true } | { error: string }> {
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

  return { ok: true }
}

function buildPollinationsUrl(prompt: string, seed: number, dimensions: ImageDimensions): string {
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${dimensions.width}&height=${dimensions.height}&seed=${seed}&nologo=true&model=flux`
}

async function fetchAndCheckPollinationsImage(prompt: string, seed: number, dimensions: ImageDimensions): Promise<{ buffer: Buffer } | { error: string } > {
  const url = buildPollinationsUrl(prompt, seed, dimensions)
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

  const quality = await checkImageQuality(buffer)
  if ("error" in quality) return quality
  return { buffer }
}

function getReplicateApiToken(): string {
  const token = process.env.REPLICATE_API_TOKEN
  if (!token) throw new Error("REPLICATE_API_TOKEN is not set")
  return token
}

function getReplicateClient(): Replicate {
  return new Replicate({ auth: getReplicateApiToken() })
}

// The Node client's `.run()` return type is deliberately loose (`Promise<object>`)
// since its actual shape depends on both the model (single output vs. an
// array of outputs) and the client's `useFileOutput` setting (defaults to
// true, wrapping each URL in a `FileOutput` — a ReadableStream with a
// `.blob()`/`.url()` — rather than a plain string). Handled defensively
// here instead of assuming one specific shape.
async function bufferFromReplicateOutput(output: unknown): Promise<{ buffer: Buffer } | { error: string }> {
  const first = Array.isArray(output) ? output[0] : output
  if (first === undefined || first === null) {
    return { error: "Replicate returned no image output." }
  }

  if (typeof first === "object" && "blob" in first && typeof (first as { blob: unknown }).blob === "function") {
    const blob = await (first as { blob(): Promise<Blob> }).blob()
    return { buffer: Buffer.from(await blob.arrayBuffer()) }
  }

  const url = typeof first === "string" ? first : String(first)
  try {
    const res = await fetch(url)
    if (!res.ok) return { error: `Failed to fetch Flux image from Replicate (${res.status}).` }
    return { buffer: Buffer.from(await res.arrayBuffer()) }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to fetch Flux image from Replicate." }
  }
}

async function fetchAndCheckFluxImage(prompt: string, seed: number, dimensions: ImageDimensions): Promise<{ buffer: Buffer } | { error: string }> {
  const resolution = resolveFluxResolution(dimensions)
  console.log(`[post-image-pipeline] calling Replicate (${FLUX_MODEL}): attemptSeed=${seed} promptLen=${prompt.length} aspectRatio=${dimensions.aspectRatio} resolution=${resolution}`)

  let output: unknown
  try {
    const replicate = getReplicateClient()
    output = await replicate.run(FLUX_MODEL, {
      input: {
        prompt,
        aspect_ratio: dimensions.aspectRatio,
        resolution,
        output_format: "png",
      },
    })
  } catch (err) {
    // Full error object logged server-side — Replicate's client throws
    // errors whose .message often only has a generic summary, with the
    // actual API-reported reason (moderation, invalid input, etc.) on the
    // error's own `.response`/`.detail` — never swallowed here.
    console.error(`[post-image-pipeline] Replicate call failed:`, err)
    const detail = err instanceof Error ? err.message : String(err)
    return { error: `Flux generation failed: ${detail}` }
  }

  const result = await bufferFromReplicateOutput(output)
  if ("error" in result) {
    console.error(`[post-image-pipeline] Replicate output could not be read:`, result.error)
    return result
  }

  console.log(`[post-image-pipeline] Flux image buffer: ${result.buffer.length} bytes`)

  const quality = await checkImageQuality(result.buffer)
  if ("error" in quality) return quality
  return { buffer: result.buffer }
}

/** Free plan stays on Pollinations (already benefits from the
 * brand-grounded prompt this pipeline builds); every paid tier — and the
 * internal owner-bypass, regardless of its nominal plan — gets Flux. The
 * comparison lives here, once, rather than being re-implemented at each
 * call site. */
function resolveImageProvider(plan: UserPlan, isInternalUnlimitedUser: boolean): "pollinations" | "flux" {
  if (isInternalUnlimitedUser) return "flux"
  return plan === "free" ? "pollinations" : "flux"
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

export type BackgroundImageResult =
  | { success: true; buffer: Buffer; mimeType: string; provider: "pollinations" | "flux" }
  | { success: false; error: string }

/**
 * Fetches a single background image buffer via Pollinations (free plan) or
 * Replicate's Flux 2 Pro (paid plans + internal bypass) — retrying once
 * with `fallbackPrompt`/a new seed on failure, and falling back to
 * Pollinations (with the original `prompt`) if Flux fails twice. Never
 * throws. This is the shared "get me a good image buffer" half of
 * generatePostImage below, minus its niche-specific prompt-building and
 * template compositing — reused as-is by any caller that just wants a
 * plain, uncomposited background image (e.g. carousel slide backgrounds
 * in lib/ai/carousel-slide-background.ts).
 */
export async function fetchBackgroundImage(
  prompt: string,
  fallbackPrompt: string,
  plan: UserPlan,
  isInternalUnlimitedUser: boolean,
  dimensions: ImageDimensions = SQUARE_DIMENSIONS
): Promise<BackgroundImageResult> {
  const provider = resolveImageProvider(plan, isInternalUnlimitedUser)
  const fetchImage = provider === "flux" ? fetchAndCheckFluxImage : fetchAndCheckPollinationsImage
  console.log(`[post-image-pipeline] fetchBackgroundImage provider=${provider} plan=${plan} internalUnlimited=${isInternalUnlimitedUser} dimensions=${dimensions.width}x${dimensions.height}`)

  // Tracks which provider actually produced the returned buffer — distinct
  // from `provider` above once the Flux-fails-twice fallback kicks in, and
  // worth surfacing to callers since Flux is a paid-per-call cost and
  // Pollinations isn't (see ai_generation_logs inserts that read this).
  let actualProvider: "pollinations" | "flux" = provider

  const seed = Math.floor(Math.random() * 1_000_000)
  let attempt = await fetchImage(prompt, seed, dimensions)

  if ("error" in attempt) {
    console.error(`[post-image-pipeline] first attempt failed (${provider}):`, attempt.error)
    const retrySeed = Math.floor(Math.random() * 1_000_000)
    attempt = await fetchImage(fallbackPrompt, retrySeed, dimensions)

    if ("error" in attempt) {
      console.error(`[post-image-pipeline] retry also failed (${provider}):`, attempt.error)

      // Flux failing twice (Replicate outage, out of credit, etc.) shouldn't
      // leave a paying user with nothing — fall back to the always-available
      // free provider rather than a hard failure. Logged loudly since this
      // is a last-resort safety net, not a routine path.
      if (provider === "flux") {
        console.log(`[post-image-pipeline] Flux failed twice, falling back to Pollinations for plan=${plan}`)
        const fallbackSeed = Math.floor(Math.random() * 1_000_000)
        attempt = await fetchAndCheckPollinationsImage(prompt, fallbackSeed, dimensions)
        actualProvider = "pollinations"

        if ("error" in attempt) {
          console.error(`[post-image-pipeline] Pollinations fallback also failed:`, attempt.error)
          return { success: false, error: `Couldn't generate a usable image after three attempts. Last error: ${attempt.error}` }
        }
      } else {
        return { success: false, error: `Couldn't generate a usable image after two attempts. Last error: ${attempt.error}` }
      }
    }
  }

  return { success: true, buffer: attempt.buffer, mimeType: "image/png", provider: actualProvider }
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
  /** Determines the image provider (resolveImageProvider) — Free stays on
   * Pollinations, every paid tier gets Flux. */
  plan: UserPlan
  /** Internal owner-bypass — always resolves to Flux regardless of `plan`. */
  isInternalUnlimitedUser: boolean
}

/**
 * Generates the base image via Pollinations (Free plan) or Replicate's
 * Flux 2 Pro (every paid tier, and the internal owner-bypass — see
 * resolveImageProvider), retrying once with a simplified prompt and a new
 * seed if the first attempt fails outright or comes back low-quality —
 * capped at 1 auto-retry, 2 attempts total — then composites the chosen
 * template's overlay onto it. Never throws — every failure mode returns
 * { success: false } so the route can surface a clean inline error instead
 * of a silent blank preview.
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

  const retryPrompt = simplifyPrompt(fullPrompt, options.brandNiche)
  const result = await fetchBackgroundImage(fullPrompt, retryPrompt, options.plan, options.isInternalUnlimitedUser)
  if (!result.success) return result

  console.log(
    `[post-image-pipeline] compositing: template=${options.template} colorTheme=${options.colorTheme.id} logoUrl=${options.logoUrl ? "present" : "none"} headlineLen=${options.headline.length}`
  )

  try {
    const composited = await compositePostImage(result.buffer, {
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
