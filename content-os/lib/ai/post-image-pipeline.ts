import sharp from "sharp"
import Replicate from "replicate"
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

// Variance of a Laplacian convolution — a standard blur-detection metric
// (low variance = few sharp edges = blurry/flat). Threshold calibrated
// live against real Pollinations output: genuinely sharp generations
// (including deliberately low-texture "minimal studio" compositions, the
// realistic false-positive risk) scored 4.1-30.9; the same images with a
// mild synthetic blur applied scored 1.4-1.9, heavy blur 0.7-1.2. 2.5 sits
// with over 1.6x margin below the lowest observed sharp score and above
// the highest observed mild-blur score.
const BLUR_VARIANCE_THRESHOLD = 2.5
const LAPLACIAN_KERNEL = { width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] }

async function isTooBlurry(buffer: Buffer): Promise<boolean> {
  const { data } = await sharp(buffer).greyscale().convolve(LAPLACIAN_KERNEL).raw().toBuffer({ resolveWithObject: true })
  const n = data.length
  let sum = 0
  for (let i = 0; i < n; i++) sum += data[i]
  const mean = sum / n
  let sqDiff = 0
  for (let i = 0; i < n; i++) sqDiff += (data[i] - mean) ** 2
  return sqDiff / n < BLUR_VARIANCE_THRESHOLD
}

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

// Square — kept available (not deleted) for a future square option or any
// caller that explicitly wants it, but no longer the default (see
// PORTRAIT_DIMENSIONS below).
const SQUARE_DIMENSIONS: ImageDimensions = { width: CANVAS_SIZE, height: CANVAS_SIZE, aspectRatio: "1:1" }

// Instagram's 2026 feed default is 4:5 portrait, not square — taller in the
// scroll and less cropped by the 3:4 profile-grid preview than 1:1 was. Now
// the default for every existing caller of fetchBackgroundImage (Post,
// Carousel via lib/ai/carousel-slide-background.ts, Autopilot/Fastlane via
// generatePostImage) so this stays behavior-preserving for them without each
// needing to pass dimensions explicitly. Stories keeps its own explicit 9:16
// STORY_DIMENSIONS (lib/ai/story-slide-background.ts) — untouched by this.
//
// `aspectRatio` here is deliberately "3:4", NOT the true "4:5" pixel ratio —
// Replicate's flux-2-pro model only accepts a fixed aspect_ratio enum
// (confirmed from its own schema, see docs/research/seedream-5-lite-evaluation.md):
// ["match_input_image","1:1","4:3","3:4","16:9","9:16","3:2","2:3","21:9"].
// "4:5" isn't in it — sending it would risk every Flux (paid-plan) call
// failing and silently downgrading to Pollinations via the fallback below.
// "3:4" is the closest valid enum value; it only affects what aspect Flux is
// asked to natively generate at, since compositePostImage's own
// `sharp(...).resize(width, height, { fit: "cover" })` already forces the
// final output to these exact width/height regardless of what a provider
// actually returned. Pollinations has no such enum — its width/height query
// params below are used directly, so this substitution only matters for Flux.
const PORTRAIT_DIMENSIONS: ImageDimensions = { width: 1080, height: 1350, aspectRatio: "3:4" }

export type PostImagePipelineResult =
  | { success: true; buffer: Buffer; mimeType: string; fullPrompt: string; provider: "pollinations" | "flux"; attempts: ImageGenerationAttempt[] }
  | { success: false; error: string; attempts: ImageGenerationAttempt[] }

// Structured failure classification — distinct from the free-text `error`
// message so it's actually queryable once persisted (see
// ImageGenerationAttempt below). Split "near_black"/"near_blank" out from
// "too_small"/"unreadable" specifically because the open diagnostic
// question is whether the near-black/near-blank quality check is
// over-triggering on legitimate photography — that's unanswerable if every
// failure mode collapses into one generic reason.
export type ImageAttemptFailureReason = "too_small" | "near_black" | "near_blank" | "blurry" | "unreadable" | "network_error" | "api_error"

/**
 * One row per real attempt inside fetchBackgroundImage below — not just
 * the final call outcome. Returned up through generatePostImage so the
 * calling route can persist each one (see
 * app/api/v1/ai/post-image/generate/route.ts) — this is what makes "how
 * often does the near-blank/near-black check trip, and at which attempt"
 * actually answerable going forward, per
 * docs/research/post-imagery-diagnosis.md's issue 3 (LOW-MEDIUM
 * confidence specifically because this data didn't exist before now).
 */
export interface ImageGenerationAttempt {
  attemptNumber: number
  provider: "pollinations" | "flux"
  promptVariant: "primary" | "fallback"
  success: boolean
  failureReason: ImageAttemptFailureReason | null
}

// Shared by both providers — a failed generation can come back as a 200
// with a placeholder/refusal image just as easily as a network error, so
// every fetched buffer goes through the same size + blank/black check
// before being treated as usable.
async function checkImageQuality(buffer: Buffer): Promise<{ ok: true } | { error: string; reason: ImageAttemptFailureReason }> {
  if (buffer.length < MIN_BUFFER_BYTES) {
    return { error: `Image response was too small to be a real photo (${buffer.length} bytes).`, reason: "too_small" }
  }

  try {
    const stats = await sharp(buffer).stats()
    const means = stats.channels.slice(0, 3).map((c) => c.mean)
    const isNearBlack = means.every((m) => m <= NEAR_BLACK_MEAN)
    const isNearBlank = means.every((m) => m >= NEAR_BLANK_MEAN)
    if (isNearBlack || isNearBlank) {
      console.error(`[post-image-pipeline] image failed quality check: channel means=${JSON.stringify(means)}`)
      return { error: "Generated image was mostly blank or black.", reason: isNearBlack ? "near_black" : "near_blank" }
    }

    if (await isTooBlurry(buffer)) {
      console.error(`[post-image-pipeline] image failed quality check: too blurry`)
      return { error: "Generated image was too blurry to use.", reason: "blurry" }
    }
  } catch (err) {
    console.error(`[post-image-pipeline] sharp couldn't read the response as an image:`, err instanceof Error ? err.message : err)
    return { error: "Generated image could not be read.", reason: "unreadable" }
  }

  return { ok: true }
}

function buildPollinationsUrl(prompt: string, seed: number, dimensions: ImageDimensions): string {
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${dimensions.width}&height=${dimensions.height}&seed=${seed}&nologo=true&model=flux`
}

async function fetchAndCheckPollinationsImage(prompt: string, seed: number, dimensions: ImageDimensions): Promise<{ buffer: Buffer } | { error: string; reason: ImageAttemptFailureReason }> {
  const url = buildPollinationsUrl(prompt, seed, dimensions)
  console.log(`[post-image-pipeline] calling Pollinations: seed=${seed} promptLen=${prompt.length} url=${url.slice(0, 200)}${url.length > 200 ? "…" : ""}`)

  let res: Response
  try {
    res = await fetch(url)
  } catch (err) {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    console.error(`[post-image-pipeline] Pollinations fetch threw before any response (network/DNS/timeout-level failure):`, detail)
    return { error: err instanceof Error ? err.message : "Image generation request failed.", reason: "network_error" }
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
    return { error: `Pollinations API error (${res.status}): ${bodyText || res.statusText}`, reason: "api_error" }
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
async function bufferFromReplicateOutput(output: unknown): Promise<{ buffer: Buffer } | { error: string; reason: ImageAttemptFailureReason }> {
  const first = Array.isArray(output) ? output[0] : output
  if (first === undefined || first === null) {
    return { error: "Replicate returned no image output.", reason: "api_error" }
  }

  if (typeof first === "object" && "blob" in first && typeof (first as { blob: unknown }).blob === "function") {
    const blob = await (first as { blob(): Promise<Blob> }).blob()
    return { buffer: Buffer.from(await blob.arrayBuffer()) }
  }

  const url = typeof first === "string" ? first : String(first)
  try {
    const res = await fetch(url)
    if (!res.ok) return { error: `Failed to fetch Flux image from Replicate (${res.status}).`, reason: "api_error" }
    return { buffer: Buffer.from(await res.arrayBuffer()) }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to fetch Flux image from Replicate.", reason: "network_error" }
  }
}

async function fetchAndCheckFluxImage(prompt: string, seed: number, dimensions: ImageDimensions): Promise<{ buffer: Buffer } | { error: string; reason: ImageAttemptFailureReason }> {
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
    return { error: `Flux generation failed: ${detail}`, reason: "api_error" }
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

// Concrete photography-technical language (specific lens/aperture/lighting
// direction) instead of the old vague "natural editorial lighting" — gives
// the diffusion model something specific to aim for rather than falling
// back to its generic stock-photo default. See
// docs/research/post-imagery-diagnosis.md, issue 2.
const PHOTOGRAPHY_STYLE = "professional product photography shot on a full-frame DSLR with an 85mm lens at f/2.8 for natural background blur, soft directional key light from the upper left with gentle fill, premium D2C brand aesthetic, high-detail commercial quality"

// Posts-specific quality + negative-artifact language — deliberately NOT
// lib/ai/prompts.ts's shared IMAGE_QUALITY_SAFETY_BOILERPLATE (also used by
// the standalone Images tab, out of scope for this fix). Two changes from
// that shared boilerplate: drops the redundant "professional photography"
// (already covered by PHOTOGRAPHY_STYLE above) and "8K ultra HD, sharp
// focus" (a generic superlative with nothing for the model to actually aim
// at), and adds explicit negative-artifact language — confirmed via
// Pollinations' and Replicate/Flux 2 Pro's actual API docs that NEITHER
// provider has a dedicated negative-prompt parameter (Pollinations'
// documented query params are prompt/model/width/height/seed/nologo/
// enhance/private only, and Black Forest Labs' own FLUX.2 docs say
// "FLUX.2 does not support negative prompts" outright) — so this has to be
// folded into the single positive prompt string for both providers, same
// as everything else here.
// "the main subject in crisp sharp focus... not soft, hazy, or out of
// focus" — contrastive rather than a bare superlative (the prior "8K ultra
// HD, sharp focus" removed in favor of PHOTOGRAPHY_STYLE's specific lens/
// lighting language was reasoned as "nothing for the model to actually aim
// at"; pairing a positive target with its negative opposite is the same
// pattern already used successfully elsewhere in this string, e.g.
// "authentic unretouched skin texture... avoid airbrushed or over-smoothed
// skin"). Scoped to "the main subject" specifically so it doesn't fight
// PHOTOGRAPHY_STYLE's own deliberate shallow-depth-of-field background blur.
const POST_IMAGE_QUALITY_AND_NEGATIVE_GUARD = "no text, no watermarks, no logos, no illegible text or symbols, anatomically correct human features if any people are shown, correct number of fingers and limbs, natural hand positioning, authentic unretouched skin texture with natural imperfections, not a 3D render, not CGI, not a digital illustration, not an AI-generated look, avoid airbrushed or over-smoothed skin, avoid plastic or waxy-looking surfaces, avoid unnaturally perfect symmetry, the main subject rendered in crisp sharp focus with clearly resolved fine detail, not soft, hazy, or out of focus"

// Now that the target canvas is 4:5 portrait (see PORTRAIT_DIMENSIONS
// above), Instagram's profile-grid preview crops it further to 3:4 — tighter
// than the 4:5 feed view. Keeping the subject and any key visual detail
// centered means it survives that extra crop instead of being clipped at
// the top/bottom edges.
const CENTERED_COMPOSITION_GUARD = "keep the main subject, text, logos, and key visual elements centered in the frame — avoid placing them in the outer ~10% margin on any side"

// The only two genuinely unbounded pieces of the assembled prompt below —
// everything else (niche setting, negative guard, photography style,
// quality boilerplate) is a short, fixed, code-authored string. Capping
// these two directly (rather than checking the assembled total after the
// fact) guarantees the combined prompt can never silently balloon toward
// Pollinations' URL-length ceiling regardless of how verbose a future LLM
// response or a brand's target_audience field gets. The client already
// caps imagePrompt at 500 chars (components/generate/FullPostGenerator.tsx)
// but this pipeline is reachable without going through that specific
// client path (e.g. "Regenerate image"), so it needs its own server-side
// floor — never trust a length limit enforced only by the caller.
const MAX_IMAGE_PROMPT_CHARS = 600
const MAX_TARGET_AUDIENCE_CHARS = 150

function capLength(text: string, max: number): string {
  return text.length > max ? text.slice(0, max).trim() : text
}

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
    CENTERED_COMPOSITION_GUARD,
    POST_IMAGE_QUALITY_AND_NEGATIVE_GUARD,
  ].filter(Boolean).join(", ")
}

export type BackgroundImageResult =
  | { success: true; buffer: Buffer; mimeType: string; provider: "pollinations" | "flux"; attempts: ImageGenerationAttempt[] }
  | { success: false; error: string; attempts: ImageGenerationAttempt[] }

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
  dimensions: ImageDimensions = PORTRAIT_DIMENSIONS
): Promise<BackgroundImageResult> {
  const provider = resolveImageProvider(plan, isInternalUnlimitedUser)
  const fetchImage = provider === "flux" ? fetchAndCheckFluxImage : fetchAndCheckPollinationsImage
  console.log(`[post-image-pipeline] fetchBackgroundImage provider=${provider} plan=${plan} internalUnlimited=${isInternalUnlimitedUser} dimensions=${dimensions.width}x${dimensions.height}`)

  // Tracks which provider actually produced the returned buffer — distinct
  // from `provider` above once the Flux-fails-twice fallback kicks in, and
  // worth surfacing to callers since Flux is a paid-per-call cost and
  // Pollinations isn't (see ai_generation_logs inserts that read this).
  let actualProvider: "pollinations" | "flux" = provider

  // One entry per real attempt (not just the final outcome) — this is what
  // makes "how often does the near-blank/near-black check trip, and at
  // which attempt" answerable going forward once the caller persists it
  // (see app/api/v1/ai/post-image/generate/route.ts). Previously only the
  // whole call's outcome was ever logged, so a moderate silent-retry rate
  // inside this function was invisible in the data entirely.
  const attempts: ImageGenerationAttempt[] = []

  const seed = Math.floor(Math.random() * 1_000_000)
  let attempt = await fetchImage(prompt, seed, dimensions)
  attempts.push({ attemptNumber: 1, provider, promptVariant: "primary", success: !("error" in attempt), failureReason: "error" in attempt ? attempt.reason : null })

  if ("error" in attempt) {
    console.error(`[post-image-pipeline] first attempt failed (${provider}):`, attempt.error)
    const retrySeed = Math.floor(Math.random() * 1_000_000)
    attempt = await fetchImage(fallbackPrompt, retrySeed, dimensions)
    attempts.push({ attemptNumber: 2, provider, promptVariant: "fallback", success: !("error" in attempt), failureReason: "error" in attempt ? attempt.reason : null })

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
        attempts.push({ attemptNumber: 3, provider: "pollinations", promptVariant: "primary", success: !("error" in attempt), failureReason: "error" in attempt ? attempt.reason : null })

        if ("error" in attempt) {
          console.error(`[post-image-pipeline] Pollinations fallback also failed:`, attempt.error)
          return { success: false, error: `Couldn't generate a usable image after three attempts. Last error: ${attempt.error}`, attempts }
        }
      } else {
        return { success: false, error: `Couldn't generate a usable image after two attempts. Last error: ${attempt.error}`, attempts }
      }
    }
  }

  return { success: true, buffer: attempt.buffer, mimeType: "image/png", provider: actualProvider, attempts }
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
  // compositions, regardless of what the model itself produced. The two
  // caller-supplied pieces are length-capped before joining so neither an
  // unusually long LLM-generated imagePrompt nor a verbose brand
  // target_audience can push the assembled prompt toward Pollinations' URL
  // length ceiling — every other piece here is a short, fixed string.
  const cappedImagePrompt = capLength(options.imagePrompt, MAX_IMAGE_PROMPT_CHARS)
  const cappedTargetAudience = options.targetAudience ? capLength(options.targetAudience, MAX_TARGET_AUDIENCE_CHARS) : null

  const fullPrompt = [
    cappedImagePrompt,
    options.brandNiche ? `${options.brandNiche} brand` : "",
    resolveNicheSetting(options.brandNiche),
    cappedTargetAudience ? `styled to appeal to ${cappedTargetAudience}` : "",
    PHOTOGRAPHY_STYLE,
    buildNegativeGuard(options.brandNiche),
    "leave the lower third of the frame visually simpler and less busy for a text overlay",
    CENTERED_COMPOSITION_GUARD,
    POST_IMAGE_QUALITY_AND_NEGATIVE_GUARD,
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
    return { success: true, buffer: composited, mimeType: "image/png", fullPrompt, provider: result.provider, attempts: result.attempts }
  } catch (err) {
    console.error("[post-image-pipeline] compositing failed:", err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : err)
    return { success: false, error: "Couldn't finish styling the generated image. Please try again.", attempts: result.attempts }
  }
}
