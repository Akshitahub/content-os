import {
  fetchBackgroundImage,
  wrapForReferenceImage,
  PHOTOGRAPHY_STYLE,
  REFERENCE_IMAGE_PEOPLE_GUARD,
  POST_IMAGE_QUALITY_AND_NEGATIVE_GUARD,
  type BackgroundImageResult,
  type ImageDimensions,
} from "./post-image-pipeline"
import { type Vibe, DEFAULT_VIBE, VIBE_BACKGROUND_STYLES, VIBE_FALLBACK_COLORS, ABSTRACT_SAFETY_BOILERPLATE, describeColor } from "./vibe-background-styles"
import type { UserPlan } from "@/types/app"
import type { BrandRow } from "@/types/database"

export type StoryVibe = Vibe

// Instagram Stories' native canvas — tall portrait, unlike carousel's
// square slides. Passed through to fetchBackgroundImage so Pollinations/
// Flux are asked for the right shape instead of a square crop.
const STORY_DIMENSIONS: ImageDimensions = { width: 1080, height: 1920, aspectRatio: "9:16" }

function resolveBrandColors(brand: BrandRow): string[] {
  const colors: string[] = []
  if (brand.primary_color) colors.push(brand.primary_color)
  if (Array.isArray(brand.color_palette)) {
    for (const c of brand.color_palette) {
      if (typeof c === "string" && c && !colors.includes(c)) colors.push(c)
    }
  }
  return colors
}

// Confirmed live (2026-08-29) via the identical bug in
// lib/ai/carousel-slide-background.ts: quoting a slide's own text
// directly into the prompt (`evokes the mood of: "${text}"`) reads to a
// diffusion model as "render this text," not "evoke this mood" — even
// against the "no text" guard below. That fix (real content-generation
// text is never a reliable "safe to quote" vs. "tagline, don't quote"
// split — some short, punchy hook/CTA-style lines get rendered as
// on-image text regardless of role) applies exactly the same way here:
// StorySequence.tsx's PhoneStory overlays the real text on top of this
// image, so a hallucinated copy of it in the photo itself would read as
// duplicated, offset text on the slide, same as the Carousel bug. Brand
// niche (a short, generic category descriptor, not a message anyone
// would expect rendered as text) replaces the slide's own text for
// whatever topical grounding is still useful.
// Names the region OPPOSITE the slide's own text_position as the one to
// keep visually calm — a "top" slide overlays its text near the top, so
// the product/scene detail is free to be busier there as long as the top
// stays clear, and vice versa. Mirrors the abstract prompt's "keep the
// vertical center calm" line, just position-aware instead of always
// centering, since a real photograph (unlike an abstract gradient) has
// actual subject detail worth NOT flattening everywhere.
function resolveTextSafeZoneGuard(textPosition?: "top" | "center" | "bottom"): string {
  if (textPosition === "top") {
    return "leave the lower two-thirds of the frame simpler so the product remains the visual focus, keeping the top third calm and uncluttered for a text overlay"
  }
  if (textPosition === "bottom") {
    return "leave the upper two-thirds of the frame simpler so the product remains the visual focus, keeping the bottom third calm and uncluttered for a text overlay"
  }
  return "leave generous calm negative space around the vertical center for a text overlay"
}

function buildStorySlidePrompt(niche: string | null, vibe: Vibe, colors: string[], productImageUrl?: string | null, textPosition?: "top" | "center" | "bottom"): string {
  // Descriptive color names, not raw hex — diffusion models reliably follow
  // "a vibrant orange-red" but ignore "#FF5733" outright, confirmed via real
  // testing (see docs/research/seedream-5-lite-evaluation.md).
  const colorNames = colors.map(describeColor).filter((c): c is string => !!c).slice(0, 3)

  // A real uploaded product photo switches this from an abstract gradient
  // background to a genuine photorealistic scene with the product placed
  // in it (same reference-image prompt pieces Post/Ad Maker already use,
  // see lib/ai/post-image-pipeline.ts) — the slide's own text is still
  // overlaid client-side afterward (StorySequence.tsx), so this only needs
  // to keep the text's own safe zone calm, not avoid rendering text itself
  // the way the abstract-only prompt below does.
  if (productImageUrl) {
    const sceneDescription = [
      PHOTOGRAPHY_STYLE,
      REFERENCE_IMAGE_PEOPLE_GUARD,
      niche ? `${niche} brand` : "",
      VIBE_BACKGROUND_STYLES[vibe],
      colorNames.length > 0 ? `color palette inspired by ${colorNames.join(" and ")}` : "",
      resolveTextSafeZoneGuard(textPosition),
      POST_IMAGE_QUALITY_AND_NEGATIVE_GUARD,
    ].filter(Boolean).join(", ")
    return wrapForReferenceImage(sceneDescription)
  }

  return [
    "abstract atmospheric vertical background image for a full-screen phone story slide",
    VIBE_BACKGROUND_STYLES[vibe],
    colorNames.length > 0 ? `color palette inspired by ${colorNames.join(" and ")}` : "",
    niche ? `evokes the mood of a ${niche} brand` : "",
    "no text, no words, no letters, no numbers, no logos anywhere in the image",
    "no rendered slogans, taglines, or typography of any kind, however short",
    "no literal photos of people, products, or objects — purely abstract shapes, gradients, and textures",
    "keep the vertical center calm and uncluttered so text stays readable when overlaid on top",
    ABSTRACT_SAFETY_BOILERPLATE,
  ].filter(Boolean).join(", ")
}

function simplifyStorySlidePrompt(vibe: Vibe): string {
  return [
    "abstract atmospheric vertical gradient background",
    VIBE_BACKGROUND_STYLES[vibe],
    "no text, no words, no letters",
  ].join(", ")
}

export interface GenerateStorySlideBackgroundOptions {
  vibe?: StoryVibe
  brand: BrandRow
  plan: UserPlan
  isInternalUnlimitedUser: boolean
  /** Which slide this background is for. "body" (reveal/buildup — any
   * slide that isn't the hook or the closing cta) is the optional "AI
   * background for every slide" mode -- unlike hook/cta, generating one
   * always costs real credits (see lib/usage/credit-costs.ts's
   * STORY_SLIDE_AI_BACKGROUND and the charging logic in this function's
   * caller). Doesn't change the prompt itself (unlike Carousel's cta-only
   * closing-mood line, Stories' prompt has never varied by role) — kept
   * only so the route can log/meter by role. */
  role: "hook" | "cta" | "body"
  /** Real uploaded product photo, if the user attached one — switches the
   * prompt from abstract-only to a photorealistic reference-image scene
   * (see buildStorySlidePrompt) and is passed through to
   * fetchBackgroundImage as a genuine Flux image-to-image reference. */
  productImageUrl?: string | null
  /** The slide's own text_position, already known by the caller before
   * this request fires — used only to pick which region of the
   * photorealistic scene to keep calm for the text overlay (see
   * resolveTextSafeZoneGuard); has no effect on the abstract-only prompt. */
  textPosition?: "top" | "center" | "bottom"
}

/**
 * Generates an abstract, on-brand portrait background image for a story
 * slide (hook, cta, or an opted-in body slide) — same prompt construction
 * as lib/ai/carousel-slide-background.ts (vibe + brand color + niche,
 * deliberately abstract rather than literal photography), just framed for
 * Stories' 9:16 canvas instead of a square. Reuses fetchBackgroundImage's
 * provider resolution, retry, and quality-check logic as-is — no
 * duplicated fetch/retry/fallback code. Never throws. Deliberately takes
 * no slide text at all — see buildStorySlidePrompt's comment for why
 * quoting any specific slide text into the prompt is what caused real
 * on-image text hallucination.
 */
export async function generateStorySlideBackground(
  options: GenerateStorySlideBackgroundOptions
): Promise<BackgroundImageResult> {
  const vibe = options.vibe ?? DEFAULT_VIBE
  const brandColors = resolveBrandColors(options.brand)
  const colors = brandColors.length > 0 ? brandColors : VIBE_FALLBACK_COLORS[vibe]

  const prompt = buildStorySlidePrompt(options.brand.niche, vibe, colors, options.productImageUrl, options.textPosition)
  const fallbackPrompt = simplifyStorySlidePrompt(vibe)

  return fetchBackgroundImage(prompt, fallbackPrompt, options.plan, options.isInternalUnlimitedUser, STORY_DIMENSIONS, options.productImageUrl)
}
