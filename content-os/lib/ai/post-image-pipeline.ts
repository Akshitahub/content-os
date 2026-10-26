import sharp from "sharp"
import { generateOpenAIImage, IMAGE_PROVIDER, type ImageDimensions } from "@/lib/ai/image-provider"
import { sumCostUsd } from "@/lib/ai/pricing"
import { compositePostImage, compositeHardTruthChecklist } from "@/lib/image/post-compositor"
import type { PostTemplateId } from "@/lib/design/post-templates"
import type { ColorTheme } from "@/lib/design/color-themes"
import type { UserPlan } from "@/types/app"

export type { ImageDimensions }

const CANVAS_SIZE = 1080
const MIN_BUFFER_BYTES = 5000
// Near-black or near-blank/white images are treated as a failed attempt
// even on a 200 response — OpenAI occasionally returns a placeholder-like
// image rather than a clean error for a moderation refusal.
const NEAR_BLACK_MEAN = 8
const NEAR_BLANK_MEAN = 247

// Variance of a Laplacian convolution — a standard blur-detection metric
// (low variance = few sharp edges = blurry/flat). Threshold calibrated
// live against real generated output: genuinely sharp generations
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
// lib/ai/image-provider.ts's resolveImageSize picks the native generation
// size from these width/height (IMAGE_PROVIDER_CONFIG.sizes.portrait, an
// exact 4:5), so the `sharp(...).resize(width, height, { fit: "cover" })`
// here and in compositePostImage only scales -- it no longer crops the
// top/bottom ~17% the old 2:3 (1024x1536) generation size lost.
const PORTRAIT_DIMENSIONS: ImageDimensions = { width: 1080, height: 1350, aspectRatio: "4:5" }

// 9:16 — reuses the exact same dimensions Stories already generates at
// (lib/ai/story-slide-background.ts's STORY_DIMENSIONS), kept as its own
// constant here since that file's export isn't public API for this module.
const STORY_LIKE_DIMENSIONS: ImageDimensions = { width: 1080, height: 1920, aspectRatio: "9:16" }

// Maps the client-facing aspect ratio choice (generatePostImageSchema's
// aspectRatio) to the actual pixel dimensions fetchBackgroundImage and the
// no-composite resize path should target. Only consulted on the
// non-composited (no caption text) path — see the willCompositeText branch
// below for why the composited path stays locked to PORTRAIT_DIMENSIONS.
function resolvePostImageDimensions(aspectRatio: "4:5" | "1:1" | "9:16" | undefined): ImageDimensions {
  if (aspectRatio === "1:1") return SQUARE_DIMENSIONS
  if (aspectRatio === "9:16") return STORY_LIKE_DIMENSIONS
  return PORTRAIT_DIMENSIONS
}

export type PostImagePipelineResult =
  | { success: true; buffer: Buffer; mimeType: string; fullPrompt: string; provider: typeof IMAGE_PROVIDER | "none"; attempts: ImageGenerationAttempt[]; textComposited: boolean }
  | { success: false; error: string; attempts: ImageGenerationAttempt[] }

// Structured failure classification — distinct from the free-text `error`
// message so it's actually queryable once persisted (see
// ImageGenerationAttempt below). Split "near_black"/"near_blank" out from
// "too_small"/"unreadable" specifically because the open diagnostic
// question is whether the near-black/near-blank quality check is
// over-triggering on legitimate photography — that's unanswerable if every
// failure mode collapses into one generic reason.
export type ImageAttemptFailureReason = "too_small" | "near_black" | "near_blank" | "blurry" | "unreadable" | "network_error" | "api_error" | "moderation_blocked"

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
  provider: typeof IMAGE_PROVIDER
  promptVariant: "primary" | "fallback"
  success: boolean
  failureReason: ImageAttemptFailureReason | null
  /** The provider's or quality check's own error text for a failed
   * attempt -- logged by the calling route; not persisted
   * (image_generation_attempts has no column for it). */
  errorMessage?: string | null
  /** What OpenAI billed for this attempt (lib/ai/pricing.ts) -- a
   * quality-check failure was still billed. Null if unknown. Not persisted
   * to image_generation_attempts (no column); summed into
   * ai_generation_logs.cost_usd by the calling route via attemptsCostUsd. */
  costUsd: number | null
}

/** Total billed across every attempt of one generation (see ImageGenerationAttempt.costUsd). */
export function attemptsCostUsd(attempts: ImageGenerationAttempt[]): number | null {
  return sumCostUsd(...attempts.map((a) => a.costUsd))
}

// A failed generation can come back as a 200 with a placeholder/refusal
// image just as easily as a network error, so every fetched buffer goes
// through the same size + blank/black check before being treated as usable.
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

// Thin wrapper around lib/ai/image-provider.ts's generateOpenAIImage --
// this file owns the quality check (blank/black/blurry), the provider
// module owns everything about actually talking to OpenAI. `attemptLabel`
// is for logging only -- there's no seed param in the images API to vary
// generations by.
async function fetchAndCheckImage(prompt: string, attemptLabel: string, dimensions: ImageDimensions, productImageUrl?: string | null): Promise<{ buffer: Buffer; costUsd: number | null } | { error: string; reason: ImageAttemptFailureReason; costUsd: number | null; timedOut?: boolean }> {
  console.log(`[post-image-pipeline] attempt=${attemptLabel} dimensions=${dimensions.width}x${dimensions.height} productReference=${productImageUrl ? "yes" : "no"}`)

  const result = await generateOpenAIImage(prompt, dimensions, productImageUrl)
  if ("error" in result) return result

  console.log(`[post-image-pipeline] image buffer: ${result.buffer.length} bytes`)

  const quality = await checkImageQuality(result.buffer)
  if ("error" in quality) return { ...quality, costUsd: result.costUsd }
  return { buffer: result.buffer, costUsd: result.costUsd }
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
export const PHOTOGRAPHY_STYLE = "professional product photography shot on a full-frame DSLR with an 85mm lens at f/2.8 for natural background blur, soft directional key light from the upper left with gentle fill, premium D2C brand aesthetic, high-detail commercial quality"

// Alternative to PHOTOGRAPHY_STYLE above -- selected via
// GeneratePostImageOptions.visualStyle === "editorial_graphic" (Create →
// Full Post's visual-direction picker). A flat, styled-composition look
// rather than a photorealistic studio shot, for brands whose product
// doesn't suit (or doesn't exist as) a physical photographed scene.
export const EDITORIAL_GRAPHIC_STYLE = "minimal editorial flat-lay composition, soft paper or fabric texture background, clean geometric shapes, muted contemporary color palette, generous negative space, magazine-editorial commercial aesthetic — no photorealistic studio lighting or DSLR depth-of-field effects"

// The single most effective lever against anatomy anomalies: a shot with
// no people in it can't have an extra-limb problem at all. Biases every
// post image toward product-only or environmental/lifestyle framing by
// default, only allowing a person into frame when the scene genuinely
// needs one (worn apparel, a hand demonstrating use, etc.) — the
// counting-language strengthening of POST_IMAGE_QUALITY_AND_NEGATIVE_GUARD
// below is the second layer of defense for the cases where a person is
// still shown, not the only one.
export const NO_PEOPLE_BY_DEFAULT_GUARD = "prefer product-only or environmental/lifestyle framing with no visible people, unless the product or scene specifically requires a person (e.g. an apparel item worn on a body, a hand actively demonstrating product use) — when a person isn't genuinely needed, exclude people from the frame entirely rather than including one incidentally"

// Used instead of NO_PEOPLE_BY_DEFAULT_GUARD on the reference-image path
// only. Confirmed live (2026-08-26): for a real product whose only
// reference photo shows it worn on a person (e.g. apparel shot on a
// model), the blanket no-people bias above forces the model into
// isolating a worn garment into a standalone flat-lay it has never
// actually seen — a much harder edit than keeping the person — and it was
// observed resolving that conflict by dropping the product from the scene
// entirely rather than attempting the isolation. Copying the real person
// already in the reference photo carries much lower anatomy-defect risk
// than NO_PEOPLE_BY_DEFAULT_GUARD's original invented-from-scratch case
// (see that constant's comment above), since the model is tracing real
// proportions from an attached photo rather than hallucinating a person —
// so relaxing the bias specifically here doesn't reintroduce the problem
// that guard exists to prevent.
export const REFERENCE_IMAGE_PEOPLE_GUARD = "if the reference photo shows the product being worn, held, or used by a person, you may keep a person wearing or holding it in the new scene to preserve the product's real fit, drape, and appearance — do not try to isolate or extract the product away from a person if that would change how it naturally appears; if the reference photo shows the product on its own with no person, keep the new scene product-only as well"

// Posts-specific quality + negative-artifact language — deliberately NOT
// lib/ai/prompts.ts's shared IMAGE_QUALITY_SAFETY_BOILERPLATE (also used by
// the standalone Images tab). Two changes from
// that shared boilerplate: drops the redundant "professional photography"
// (already covered by PHOTOGRAPHY_STYLE above) and "8K ultra HD, sharp
// focus" (a generic superlative with nothing for the model to actually aim
// at), and adds explicit negative-artifact language — OpenAI's image
// models have no dedicated negative-prompt parameter, so every constraint
// has to be folded into the single positive prompt string, same as
// everything else here.
// "the main subject in crisp sharp focus... not soft, hazy, or out of
// focus" — contrastive rather than a bare superlative (the prior "8K ultra
// HD, sharp focus" removed in favor of PHOTOGRAPHY_STYLE's specific lens/
// lighting language was reasoned as "nothing for the model to actually aim
// at"; pairing a positive target with its negative opposite is the same
// pattern already used successfully elsewhere in this string, e.g.
// "authentic unretouched skin texture... avoid airbrushed or over-smoothed
// skin"). Scoped to "the main subject" specifically so it doesn't fight
// PHOTOGRAPHY_STYLE's own deliberate shallow-depth-of-field background blur.
// "no social media UI elements, no usernames or @handles, no URLs...,
// no 'link in bio'..., no fake app interface elements" — the existing
// "no text, no illegible text or symbols" wasn't specific enough:
// diffusion models hallucinate UI-like text (fake usernames, "link in
// bio", fake URLs) noticeably more often in photorealistic product-photo
// contexts than in the abstract Story/Carousel backgrounds, where the
// same generic guard already held up fine. Named explicitly here instead
// of trusting the generic phrase to cover it.
// Anatomy clause rewritten from vague "anatomically correct... correct
// number of fingers and limbs" to specific counting language — diffusion
// models respond far more reliably to concrete counts ("exactly two arms
// and two hands per person, five fingers per hand") than generic
// correctness phrasing, which reportedly wasn't enough to reliably prevent
// extra-limb anomalies (e.g. a woman with three hands). Also adds general
// surface-cleanliness language the guard previously lacked entirely.
export const POST_IMAGE_QUALITY_AND_NEGATIVE_GUARD = "no text, no watermarks, no logos, no illegible text or symbols, no social media UI elements, no usernames or @handles, no URLs or website addresses, no 'link in bio' or similar caption-style text, no fake app interface elements, if any people are shown: exactly two arms and two hands per person, five fingers per hand, no extra or duplicated limbs, no merged or fused body parts, no distorted or extra fingers, anatomically normal human proportions, natural hand positioning, authentic unretouched skin texture with natural imperfections, not a 3D render, not CGI, not a digital illustration, not an AI-generated look, avoid airbrushed or over-smoothed skin, avoid plastic or waxy-looking surfaces, avoid unnaturally perfect symmetry, no blemishes, no visual artifacts, no compression artifacts, no random marks or smudges, no color banding, clean unmarked surface, the main subject rendered in crisp sharp focus with clearly resolved fine detail, not soft, hazy, or out of focus, ultra-high-resolution 8K quality, professionally composed and lit, modern and elevated editorial aesthetic, visually striking and scroll-stopping, on-trend for 2026 social media, tightly grounded in and relevant to the specific scene described above, no generic or unrelated stock-photo filler"

// Now that the target canvas is 4:5 portrait (see PORTRAIT_DIMENSIONS
// above), Instagram's profile-grid preview crops it further to 3:4 — tighter
// than the 4:5 feed view. Keeping the subject and any key visual detail
// centered means it survives that extra crop instead of being clipped at
// the top/bottom edges.
export const CENTERED_COMPOSITION_GUARD = "keep the main subject, text, logos, and key visual elements centered in the frame — avoid placing them in the outer ~10% margin on any side"

// The only two genuinely unbounded pieces of the assembled prompt below —
// everything else (niche setting, negative guard, photography style,
// quality boilerplate) is a short, fixed, code-authored string. Capping
// these two directly (rather than checking the assembled total after the
// fact) guarantees the combined prompt can never silently balloon
// regardless of how verbose a future LLM response or a brand's
// target_audience field gets. generatePostImageSchema's own zod .max()
// (lib/validations/ai.ts) already rejects anything over the same limit
// before it reaches here, but this pipeline is reachable without going
// through that specific client path (e.g. "Regenerate image"), so it needs
// its own server-side floor — never trust a length limit enforced only by
// the caller.
//
// Was 600 -- shorter than the prompt-authoring stage's real target output
// (80-150 words, lib/ai/image-prompt-writer.ts), so a genuine, complete
// AI-authored prompt was being cut off before ever reaching the image
// provider -- the direct cause of the "generated prompt is too short/cut off" image
// quality issue this constant exists to guard against, not to cause. 1500
// gives real headroom above that target length while still bounding
// worst-case (e.g. a hand-pasted essay) length.
const MAX_IMAGE_PROMPT_CHARS = 1500
const MAX_TARGET_AUDIENCE_CHARS = 150

// Cuts at the last sentence boundary within budget, not mid-sentence/
// mid-word -- a raw slice() previously here could (and did) chop a
// complete AI-authored prompt off mid-clause, handing the image provider a
// garbled trailing fragment instead of a clean, complete description. Falls back
// to a word boundary when no sentence end falls in the back half of the
// budget (e.g. one unbroken run-on clause), and only cuts mid-word as an
// absolute last resort (a single "word" longer than the entire budget).
function capLength(text: string, max: number): string {
  if (text.length <= max) return text
  const truncated = text.slice(0, max)
  const lastSentenceEnd = Math.max(truncated.lastIndexOf(". "), truncated.lastIndexOf("! "), truncated.lastIndexOf("? "))
  if (lastSentenceEnd > max * 0.5) return truncated.slice(0, lastSentenceEnd + 1).trim()
  const lastSpace = truncated.lastIndexOf(" ")
  return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated).trim()
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

// When a real product photo is attached as an image-to-image reference
// (see lib/ai/image-provider.ts's images.edit call), the prompt needs to describe
// the SCENE/setting/lighting around the product rather than re-describing
// the product's own appearance — the LLM-generated imagePrompt does the
// latter by design (IMAGE_PROMPT_INSTRUCTION in prompts.ts explicitly asks
// for "the actual skincare product/routine/texture"), which would
// otherwise fight the reference image with conflicting appearance
// language. Wraps rather than strips, since that LLM-generated text still
// carries genuinely useful context (the post's specific message/theme)
// beyond just what the product looks like.
//
// Confirmed live (2026-08-27): this reference-image path — and only this
// path, matching the "some posts, not every post" report exactly, since
// it's the one case where productImageUrl is actually set — was
// intermittently coming back as a split/collage panel (two distinct
// scenes side by side) instead of one seamless photo. The prior wording
// ("keep its real appearance... completely unchanged... Place it into
// this new scene") asks for two things that read as two separate states
// — "unchanged from the reference" and "placed into a new scene" — a
// known image-to-image failure mode is rendering both states at once
// (the reference as shown, plus its new placement) rather than one
// integrated shot. Rewritten to ask for a single output unambiguously,
// with explicit negative language against the exact artifact seen,
// matching how POST_IMAGE_QUALITY_AND_NEGATIVE_GUARD above already
// pairs a positive target with its specific negative opposite rather
// than trusting a generic quality phrase to cover it.
//
// Separately observed (2026-08-26), after the split-panel fix above was
// verified live: across several generations the reference product itself
// wasn't always clearly recognizable in the finished scene — the
// product-fidelity instruction was frontloaded once, then followed by
// `sceneDescription`'s own large block of unrelated styling/negative-guard
// text (PHOTOGRAPHY_STYLE, POST_IMAGE_QUALITY_AND_NEGATIVE_GUARD, etc.),
// diluting how much weight the model gave it. Reinforced the instruction a
// second time at the end of the prompt (immediately alongside the
// single-photo language, the other place this function already asks for
// something the model must not drop), with explicit negative language
// against the product being omitted, obscured, or swapped — same
// positive+negative pairing convention as the rest of this file.
export function wrapForReferenceImage(sceneDescription: string): string {
  return `The attached reference photo shows the real product — replicate its exact appearance (shape, color, packaging, and label) faithfully into a single new photograph of this scene: ${sceneDescription}. The reference product must be clearly visible, in focus, and recognizable as the central subject — do not omit it, crop it out of frame, obscure it behind other objects, or substitute a different item in its place. Output must be ONE seamless photograph only, photographed once from a single camera angle — not a comparison, not a before/after, not a split image, not a side-by-side, not a collage, not multiple panels or frames; one continuous scene with the exact reference product naturally placed in it and clearly visible.`
}

function simplifyPrompt(prompt: string, brandNiche: string | null, hasReferenceImage: boolean): string {
  const core = prompt.split(",")[0]?.trim() || prompt.slice(0, 150)
  const sceneDescription = [
    core,
    brandNiche ? `${brandNiche} brand` : "",
    resolveNicheSetting(brandNiche),
    PHOTOGRAPHY_STYLE,
    hasReferenceImage ? REFERENCE_IMAGE_PEOPLE_GUARD : NO_PEOPLE_BY_DEFAULT_GUARD,
    CENTERED_COMPOSITION_GUARD,
    POST_IMAGE_QUALITY_AND_NEGATIVE_GUARD,
  ].filter(Boolean).join(", ")
  return hasReferenceImage ? wrapForReferenceImage(sceneDescription) : sceneDescription
}

export type BackgroundImageResult =
  | { success: true; buffer: Buffer; mimeType: string; provider: typeof IMAGE_PROVIDER; attempts: ImageGenerationAttempt[] }
  | { success: false; error: string; attempts: ImageGenerationAttempt[] }

/**
 * Fetches a single background image buffer via OpenAI's gpt-image-2 (see
 * lib/ai/image-provider.ts) — every plan, every trial, no provider
 * branching — retrying once with `fallbackPrompt` on failure. Never
 * throws. This is the shared "get me a good image buffer" half of
 * generatePostImage below, minus its niche-specific prompt-building and
 * template compositing — reused as-is by any caller that just wants a
 * plain, uncomposited background image (e.g. carousel slide backgrounds in
 * lib/ai/carousel-slide-background.ts).
 *
 * `plan`/`isInternalUnlimitedUser` are kept as parameters (unused for
 * provider selection now that every plan resolves to the same provider)
 * rather than removed, since every call site still has them on hand from
 * resolving the caller's plan for credit-charging purposes, and removing
 * them here would just be a cosmetic signature change across every caller
 * for no behavioral gain.
 */
export async function fetchBackgroundImage(
  prompt: string,
  fallbackPrompt: string,
  _plan: UserPlan,
  _isInternalUnlimitedUser: boolean,
  dimensions: ImageDimensions = PORTRAIT_DIMENSIONS,
  /** Real uploaded product photo (products.image_urls[0]) — sent as an
   * image-to-image reference via OpenAI's images.edit endpoint (see
   * lib/ai/image-provider.ts). */
  productImageUrl?: string | null
): Promise<BackgroundImageResult> {
  console.log(`[post-image-pipeline] fetchBackgroundImage provider=${IMAGE_PROVIDER} dimensions=${dimensions.width}x${dimensions.height} productReference=${productImageUrl ? "yes" : "no"}`)

  // One entry per real attempt (not just the final outcome) — this is what
  // makes "how often does the near-blank/near-black check trip, and at
  // which attempt" answerable going forward once the caller persists it
  // (see app/api/v1/ai/post-image/generate/route.ts). Previously only the
  // whole call's outcome was ever logged, so a moderate silent-retry rate
  // inside this function was invisible in the data entirely.
  const attempts: ImageGenerationAttempt[] = []

  let attempt = await fetchAndCheckImage(prompt, "1-primary", dimensions, productImageUrl)
  attempts.push({ attemptNumber: 1, provider: IMAGE_PROVIDER, promptVariant: "primary", success: !("error" in attempt), failureReason: "error" in attempt ? attempt.reason : null, errorMessage: "error" in attempt ? attempt.error : null, costUsd: attempt.costUsd })

  if ("error" in attempt && attempt.timedOut) {
    // A simplified prompt doesn't make the provider any faster -- a second
    // attempt after a timeout would just double the wait before failing.
    console.error(`[post-image-pipeline] first attempt timed out, skipping the fallback attempt:`, attempt.error)
    return { success: false, error: `Couldn't generate a usable image. Attempt 1 (primary): ${attempt.error}`, attempts }
  }

  if ("error" in attempt) {
    const firstError = attempt.error
    console.error(`[post-image-pipeline] first attempt failed:`, attempt.error)
    attempt = await fetchAndCheckImage(fallbackPrompt, "2-fallback", dimensions, productImageUrl)
    attempts.push({ attemptNumber: 2, provider: IMAGE_PROVIDER, promptVariant: "fallback", success: !("error" in attempt), failureReason: "error" in attempt ? attempt.reason : null, errorMessage: "error" in attempt ? attempt.error : null, costUsd: attempt.costUsd })

    if ("error" in attempt) {
      console.error(`[post-image-pipeline] retry also failed:`, attempt.error)
      // Both attempts' errors, not just the last -- they can differ (e.g. a
      // moderation block, then a timeout).
      return { success: false, error: `Couldn't generate a usable image after two attempts. Attempt 1 (primary): ${firstError} | Attempt 2 (fallback): ${attempt.error}`, attempts }
    }
  }

  return { success: true, buffer: attempt.buffer, mimeType: "image/png", provider: IMAGE_PROVIDER, attempts }
}

export interface GeneratePostImageOptions {
  imagePrompt: string
  brandNiche: string | null
  targetAudience: string | null
  template: PostTemplateId
  colorTheme: ColorTheme
  /** The one piece of user-typed text to composite onto the image — fully
   * optional. Omitted/empty means no text overlay of any kind: no
   * auto-filled headline from a picked hook, no auto-filled CTA from
   * brand.cta_phrase, nothing generated ever gets stamped on the photo
   * unless the caller explicitly provides this. */
  captionText?: string | null
  /** Which curated font (lib/design/fonts.ts) renders captionText, if any
   * is provided — falls back to the pre-existing Anton font when omitted. */
  fontId?: string
  /** Multiplies captionText's headline font size — falls back to 1.0 (the
   * pre-existing fixed sizes) when omitted. See CompositePostImageOptions'
   * own comment for why this can't overflow the template's box. */
  textSizeScale?: number | null
  logoUrl: string | null
  /** Kept for credit-charging/logging call sites that already have this on
   * hand -- every plan resolves to the same provider now (see fetchBackgroundImage). */
  plan: UserPlan
  /** Internal owner-bypass -- same reasoning as `plan` above, no longer
   * changes which provider is used. */
  isInternalUnlimitedUser: boolean
  /** Real uploaded product photo (products.image_urls[0]), if the user
   * picked a product for this post. Used as an image-to-image
   * reference (see lib/ai/image-provider.ts) -- also switches the assembled
   * prompt onto the scene-focused hasReferenceImage path below rather than
   * re-describing the product's appearance from scratch. */
  productImageUrl?: string | null
  /** Client-chosen aspect ratio (generatePostImageSchema's aspectRatio) —
   * only actually changes the output when there's no text overlay
   * (captionText empty). See resolvePostImageDimensions and the
   * willCompositeText branch below. Omitted defaults to 4:5 portrait. */
  aspectRatio?: "4:5" | "1:1" | "9:16"
  /** Which background style to render -- PHOTOGRAPHY_STYLE (photorealistic
   * studio product shot) or EDITORIAL_GRAPHIC_STYLE (flat editorial
   * composition). Omitted defaults to PHOTOGRAPHY_STYLE, today's existing
   * behavior, so every caller that doesn't pass this (Carousel, Story,
   * Autopilot) is unaffected. */
  visualStyle?: "studio_scene" | "editorial_graphic"
  /** Only meaningful when template is "hard_truth_checklist" -- the
   * caption's own checklist_* fields (see types/app.ts's GeneratedCaption),
   * threaded straight through to lib/image/post-compositor.ts's
   * compositeHardTruthChecklist. This template has no photo at all, so
   * imagePrompt/captionText/aspectRatio/visualStyle above are all ignored
   * for it -- see generatePostImage's own early-exit branch. Omitted (or
   * checklistHeadline empty) falls through to the normal AI-image path
   * instead of a broken empty checklist card -- see that branch's own
   * comment for why. */
  checklistHeadline?: string
  checklistHighlightedPhrase?: string | null
  checklistWrongItems?: string[]
  checklistRightItems?: string[]
  checklistClosingLine?: string | null
}

/**
 * Generates the base image via OpenAI's gpt-image-2 (see
 * lib/ai/image-provider.ts) — every plan, no provider branching — retrying
 * once with a simplified prompt if the first attempt fails outright or
 * comes back low-quality — capped at 1 auto-retry, 2 attempts total — then
 * composites the chosen template's overlay onto it. Never throws — every
 * failure mode returns { success: false } so the route can surface a clean
 * inline error instead of a silent blank preview.
 */
export async function generatePostImage(options: GeneratePostImageOptions): Promise<PostImagePipelineResult> {
  // hard_truth_checklist has no photo at all -- a flat card composited
  // entirely from its own checklist_* fields, never from imagePrompt/
  // captionText. Skips fetchBackgroundImage (and the AI-image credit
  // spend that comes with it) entirely -- real credits saved per
  // generation for this template, not just a visual choice. Guarded on
  // checklistHeadline actually being present (not just the template id)
  // so a caller that picked this template but never forwarded checklist
  // data (there's exactly one today -- app/api/v1/dashboard/
  // generate-daily-draft/route.ts, which never composites ANY text
  // overlay for ANY template) falls through to the existing "no caption
  // text" plain-background path below instead of producing a broken,
  // empty checklist card.
  if (options.template === "hard_truth_checklist" && options.checklistHeadline?.trim()) {
    try {
      const composited = await compositeHardTruthChecklist({
        colorTheme: options.colorTheme,
        logoUrl: options.logoUrl,
        fontId: options.fontId,
        textSizeScale: options.textSizeScale ?? undefined,
        headline: options.checklistHeadline,
        highlightedPhrase: options.checklistHighlightedPhrase ?? null,
        wrongItems: options.checklistWrongItems ?? [],
        rightItems: options.checklistRightItems ?? [],
        closingLine: options.checklistClosingLine ?? null,
      })
      console.log(`[post-image-pipeline] hard_truth_checklist composited successfully: ${composited.length} bytes (no AI image call made)`)
      return {
        success: true,
        buffer: composited,
        mimeType: "image/png",
        fullPrompt: "hard_truth_checklist (flat card, no AI photo)",
        provider: "none",
        attempts: [],
        textComposited: true,
      }
    } catch (err) {
      console.error("[post-image-pipeline] hard_truth_checklist compositing failed:", err instanceof Error ? `${err.name}: ${err.message}` : err)
      return { success: false, error: "Couldn't finish styling the generated image. Please try again.", attempts: [] }
    }
  }

  // Deterministic grounding, independent of how well the LLM-generated
  // imagePrompt followed instructions — every image gets an
  // industry-appropriate setting, a consistent premium photography style,
  // and (for non-tech niches) a guard against generic corporate stock-photo
  // compositions, regardless of what the model itself produced. The two
  // caller-supplied pieces are length-capped before joining so neither an
  // unusually long LLM-generated imagePrompt nor a verbose brand
  // target_audience can push the assembled prompt toward an unwieldy
  // length — every other piece here is a short, fixed string.
  const cappedImagePrompt = capLength(options.imagePrompt, MAX_IMAGE_PROMPT_CHARS)
  const cappedTargetAudience = options.targetAudience ? capLength(options.targetAudience, MAX_TARGET_AUDIENCE_CHARS) : null
  const hasReferenceImage = !!options.productImageUrl
  const captionText = options.captionText?.trim() || ""
  const willCompositeText = !!captionText && options.template !== "blank"

  const sceneDescription = [
    cappedImagePrompt,
    options.brandNiche ? `${options.brandNiche} brand` : "",
    resolveNicheSetting(options.brandNiche),
    cappedTargetAudience ? `styled to appeal to ${cappedTargetAudience}` : "",
    options.visualStyle === "editorial_graphic" ? EDITORIAL_GRAPHIC_STYLE : PHOTOGRAPHY_STYLE,
    hasReferenceImage ? REFERENCE_IMAGE_PEOPLE_GUARD : NO_PEOPLE_BY_DEFAULT_GUARD,
    buildNegativeGuard(options.brandNiche),
    // Only relevant when there's actually going to be a text overlay —
    // biasing every image toward a simpler lower third no longer makes
    // sense now that a clean, text-free image is the default (Commit 2:
    // text overlay is opt-in, not auto-injected).
    willCompositeText ? "leave the lower third of the frame visually simpler and less busy for a text overlay" : "",
    CENTERED_COMPOSITION_GUARD,
    POST_IMAGE_QUALITY_AND_NEGATIVE_GUARD,
  ].filter(Boolean).join(", ")
  const fullPrompt = hasReferenceImage ? wrapForReferenceImage(sceneDescription) : sceneDescription

  // Passes the UNwrapped sceneDescription, not fullPrompt -- simplifyPrompt
  // extracts its "core" topic from the first comma-separated segment, and
  // wrapForReferenceImage's own wrapper text starts with a comma right
  // after "reference photo", which would hijack that extraction if passed
  // the already-wrapped fullPrompt. simplifyPrompt applies the same
  // wrapping itself, once it has the real core.
  const retryPrompt = simplifyPrompt(sceneDescription, options.brandNiche, hasReferenceImage)
  const requestedDimensions = resolvePostImageDimensions(options.aspectRatio)
  const result = await fetchBackgroundImage(fullPrompt, retryPrompt, options.plan, options.isInternalUnlimitedUser, requestedDimensions, options.productImageUrl)
  if (!result.success) return result

  // No caption text (the new default) — skip compositePostImage entirely
  // rather than compositing an empty/placeholder overlay. Still needs the
  // same resize-to-target-canvas normalization compositePostImage's own
  // sharp call does, so the output is consistent regardless of which path
  // ran (and regardless of what resolution the provider actually returned).
  // This is the one path that actually honors a non-default aspectRatio —
  // see requestedDimensions above and the composited branch's comment below.
  if (!willCompositeText) {
    console.log(`[post-image-pipeline] no caption text provided -- skipping text compositing, returning plain background at ${requestedDimensions.aspectRatio}`)
    try {
      const normalized = await sharp(result.buffer).resize(requestedDimensions.width, requestedDimensions.height, { fit: "cover" }).png().toBuffer()
      return { success: true, buffer: normalized, mimeType: "image/png", fullPrompt, provider: result.provider, attempts: result.attempts, textComposited: false }
    } catch (err) {
      console.error("[post-image-pipeline] normalizing plain background failed:", err instanceof Error ? `${err.name}: ${err.message}` : err)
      return { success: false, error: "Couldn't finish preparing the generated image. Please try again.", attempts: result.attempts }
    }
  }

  // compositePostImage's SVG templates use fixed pixel anchors tuned for
  // the 1080x1350 canvas (see lib/image/post-compositor.ts's CANVAS_WIDTH/
  // CANVAS_HEIGHT) -- a requested 1:1 or 9:16 aspectRatio is silently
  // ignored on this path until the templates themselves become
  // dimension-aware. Logged (not surfaced as an error) since a captioned
  // image at 4:5 is still a fully valid, working result -- just not the
  // exact ratio asked for.
  if (options.aspectRatio && options.aspectRatio !== "4:5") {
    console.log(`[post-image-pipeline] aspectRatio=${options.aspectRatio} requested but ignored -- text compositing templates are locked to 4:5 for now`)
  }

  console.log(
    `[post-image-pipeline] compositing: template=${options.template} colorTheme=${options.colorTheme.id} logoUrl=${options.logoUrl ? "present" : "none"} captionLen=${captionText.length}`
  )

  try {
    const composited = await compositePostImage(result.buffer, {
      template: options.template,
      colorTheme: options.colorTheme,
      captionText,
      logoUrl: options.logoUrl,
      fontId: options.fontId,
      textSizeScale: options.textSizeScale ?? undefined,
    })
    console.log(`[post-image-pipeline] composited successfully: ${composited.length} bytes`)
    return { success: true, buffer: composited, mimeType: "image/png", fullPrompt, provider: result.provider, attempts: result.attempts, textComposited: true }
  } catch (err) {
    console.error("[post-image-pipeline] compositing failed:", err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : err)
    return { success: false, error: "Couldn't finish styling the generated image. Please try again.", attempts: result.attempts }
  }
}
