import {
  fetchBackgroundImage,
  wrapForReferenceImage,
  PHOTOGRAPHY_STYLE,
  REFERENCE_IMAGE_PEOPLE_GUARD,
  POST_IMAGE_QUALITY_AND_NEGATIVE_GUARD,
  type ImageDimensions,
} from "./post-image-pipeline"
import type { ImageQuality } from "./image-provider"
import { type Vibe, DEFAULT_VIBE, VIBE_BACKGROUND_STYLES, VIBE_FALLBACK_COLORS, ABSTRACT_SAFETY_BOILERPLATE, describeColor } from "./vibe-background-styles"
import type { UserPlan } from "@/types/app"
import { SPLIT_LABEL_GUARD, briefScene as sharedBriefScene, briefUsesProductReference, halfBrief, halfUsesProductReference, type VisualBrief, artDirectionColors, artDirectionImageClause, artDirectionShortClause } from "./visual-brief"
import { generateWithSplitLayer, type SplitBackgroundResult } from "./split-layer"
import type { BrandRow } from "@/types/database"
import { artDirectionFrom } from "./brand-brain"

export type StoryVibe = Vibe

// Instagram Stories' native canvas — tall portrait, unlike carousel's
// square slides. Passed through to fetchBackgroundImage so the provider is
// asked for the right shape instead of a square crop.
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

function buildStorySlidePrompt(niche: string | null, vibe: Vibe, colors: string[], productImageUrl?: string | null, textPosition?: "top" | "center" | "bottom", customPrompt?: string): string {
  // Descriptive color names, not raw hex — diffusion models reliably follow
  // "a vibrant orange-red" but ignore "#FF5733" outright, confirmed via real
  // testing (see docs/research/seedream-5-lite-evaluation.md).
  const colorNames = colors.map(describeColor).filter((c): c is string => !!c).slice(0, 3)
  const trimmedCustom = customPrompt?.trim()

  // A real uploaded product photo switches this from an abstract gradient
  // background to a genuine photorealistic scene with the product placed
  // in it (same reference-image prompt pieces Post/Ad Maker already use,
  // see lib/ai/post-image-pipeline.ts) — the slide's own text is still
  // overlaid client-side afterward (StorySequence.tsx), so this only needs
  // to keep the text's own safe zone calm, not avoid rendering text itself
  // the way the abstract-only prompt below does.
  if (productImageUrl) {
    const sceneDescription = [
      trimmedCustom,
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

  // The SocioPosts-authored (and possibly user-edited) scene, when present,
  // replaces the generic "abstract atmospheric vertical background..."
  // opener as the creative core -- every guard after it (vibe style, color
  // palette, and critically the hard "no text/words/letters" rule) still
  // applies in code exactly as before regardless of what that opener says,
  // for the same on-image-text-hallucination reason documented above this
  // function.
  return [
    trimmedCustom || "abstract atmospheric vertical background image for a full-screen phone story slide",
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

function simplifyStorySlidePrompt(vibe: Vibe, productImageUrl?: string | null, customPrompt?: string): string {
  const trimmedCustom = customPrompt?.trim()
  // Same shorter/simplified spirit as the abstract-only fallback below,
  // just reference-aware -- a retry with a real product photo attached
  // still needs to stay in the photorealistic reference-image path (see
  // buildStorySlidePrompt above), not fall back to an abstract gradient
  // that would drop the product from the scene entirely.
  if (productImageUrl) {
    return wrapForReferenceImage([trimmedCustom, PHOTOGRAPHY_STYLE, REFERENCE_IMAGE_PEOPLE_GUARD, VIBE_BACKGROUND_STYLES[vibe]].filter(Boolean).join(", "))
  }
  return [
    trimmedCustom || "abstract atmospheric vertical gradient background",
    VIBE_BACKGROUND_STYLES[vibe],
    "no text, no words, no letters",
  ].join(", ")
}

// ─── Per-frame visual briefs ────────────────────────────────────────────────
// Same structure as lib/ai/carousel-slide-background.ts: every non-hook
// frame with a visual brief (already sanitized, never combined with the
// frame's text) gets its OWN scene from it instead of the one shared
// customPrompt scene. Every no-text/typography guard stays, and the
// text-overlay safe zone is always applied -- the frame's text_position is
// known. Only the "purely abstract" line is dropped for concrete kinds.

const STORY_ABSTRACT_OPENER = "abstract atmospheric vertical background image for a full-screen phone story slide"
const VERTICAL_COMPOSITION = "vertical 9:16 phone-screen composition, subject stacked vertically rather than a wide landscape scene"

function briefScene(brief: VisualBrief): string {
  return sharedBriefScene(brief, STORY_ABSTRACT_OPENER)
}


// The user's own typed scene text (never the AI-expanded customPrompt),
// kept as soft direction on a brief-driven image -- capped at 300 chars.
function userDirectionLine(userDirection?: string | null): string {
  const text = userDirection?.trim().slice(0, 300)
  return text ? `user direction: ${text}` : ""
}

function buildBriefStorySlidePrompt(brief: VisualBrief, niche: string | null, vibe: Vibe, colors: string[], productImageUrl?: string | null, textPosition?: "top" | "center" | "bottom", userDirection?: string | null): string {
  const colorNames = colors.map(describeColor).filter((c): c is string => !!c).slice(0, 3)
  const composition = brief.composition ? `composition: ${brief.composition}` : ""
  const direction = userDirectionLine(userDirection)
  const isSplit = brief.kind === "side_by_side" || brief.kind === "before_after"
  const noText = [
    "no text, no words, no letters, no numbers, no logos anywhere in the image",
    "no rendered slogans, taglines, or typography of any kind, however short",
  ]

  // product_scene / detail_closeup / before_after with a real product photo
  // attached -- same reference-image path as buildStorySlidePrompt, with the
  // brief as the scene and the hard no-text lines added on top.
  if (productImageUrl) {
    return wrapForReferenceImage([
      briefScene(brief),
      composition,
      direction,
      VERTICAL_COMPOSITION,
      PHOTOGRAPHY_STYLE,
      REFERENCE_IMAGE_PEOPLE_GUARD,
      niche ? `${niche} brand` : "",
      VIBE_BACKGROUND_STYLES[vibe],
      colorNames.length > 0 ? `color palette inspired by ${colorNames.join(" and ")}` : "",
      ...noText,
      isSplit ? SPLIT_LABEL_GUARD : "",
      resolveTextSafeZoneGuard(textPosition),
      POST_IMAGE_QUALITY_AND_NEGATIVE_GUARD,
    ].filter(Boolean).join(", "))
  }

  return [
    briefScene(brief),
    composition,
    direction,
    VERTICAL_COMPOSITION,
    VIBE_BACKGROUND_STYLES[vibe],
    colorNames.length > 0 ? `color palette inspired by ${colorNames.join(" and ")}` : "",
    niche ? `evokes the mood of a ${niche} brand` : "",
    ...noText,
    brief.kind === "abstract_mood" ? "no literal photos of people, products, or objects — purely abstract shapes, gradients, and textures" : "",
    isSplit ? SPLIT_LABEL_GUARD : "",
    resolveTextSafeZoneGuard(textPosition),
    ABSTRACT_SAFETY_BOILERPLATE,
  ].filter(Boolean).join(", ")
}

function simplifyBriefStorySlidePrompt(brief: VisualBrief, vibe: Vibe, productImageUrl?: string | null): string {
  if (productImageUrl) {
    return wrapForReferenceImage([briefScene(brief), VERTICAL_COMPOSITION, PHOTOGRAPHY_STYLE, REFERENCE_IMAGE_PEOPLE_GUARD, VIBE_BACKGROUND_STYLES[vibe], "no text, no words, no letters"].join(", "))
  }
  return [
    briefScene(brief),
    VERTICAL_COMPOSITION,
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
   * fetchBackgroundImage as a genuine image-to-image reference. */
  productImageUrl?: string | null
  /** The slide's own text_position, already known by the caller before
   * this request fires — used only to pick which region of the
   * photorealistic scene to keep calm for the text overlay (see
   * resolveTextSafeZoneGuard); has no effect on the abstract-only prompt. */
  textPosition?: "top" | "center" | "bottom"
  /** SocioPosts-authored (and possibly user-edited) visual scene from the
   * new prompt-writing stage (see lib/ai/image-prompt-writer.ts and
   * StorySequence.tsx) -- replaces the generic abstract-background opener
   * (or is prepended alongside PHOTOGRAPHY_STYLE on the reference-image
   * path) as the creative core, but every guard in
   * buildStorySlidePrompt/simplifyStorySlidePrompt below still applies
   * exactly as before regardless of what this contains. */
  customPrompt?: string
  /** The user's own raw typed scene text (null/omitted if they typed
   * nothing) -- appended as "user direction: ..." on a brief-driven image.
   * The AI-expanded customPrompt is never used once a brief exists. */
  userDirection?: string | null
  /** This frame's own visual brief (already run through
   * sanitizeVisualBrief). On any non-hook frame it replaces customPrompt as
   * the scene -- the hook keeps the user-reviewed shared scene. Omitted =
   * today's behaviour. */
  visualBrief?: VisualBrief
  /** gpt-image-2 quality; omitted = "medium". The slide-image route
   * passes "low" (text is composited on top); raised to "medium" when
   * productImageUrl is set. */
  quality?: ImageQuality
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
): Promise<SplitBackgroundResult> {
  const vibe = options.vibe ?? DEFAULT_VIBE
  const brandColors = resolveBrandColors(options.brand)
  // Brand art direction (lib/ai/visual-brief.ts): its palette replaces the
  // generic vibe palette for a brand with no colours, and every prompt --
  // halves of a split included -- carries its clause. None = unchanged.
  const art = artDirectionFrom(options.brand)
  const withArt = (p: string) => [p, artDirectionImageClause(art)].filter(Boolean).join(", ")
  const withArtShort = (p: string) => [p, artDirectionShortClause(art)].filter(Boolean).join(", ")
  const colors = brandColors.length > 0 ? brandColors : art ? artDirectionColors(art) : VIBE_FALLBACK_COLORS[vibe]

  // Any frame with a brief -- the first included -- gets its scene from it;
  // the AI-expanded customPrompt is then not used at all, only the user's own
  // typed text as direction. Frames without a brief keep the old behaviour.
  const brief = options.visualBrief
  if (brief) {
    const productImageUrl = briefUsesProductReference(brief) ? options.productImageUrl : undefined
    const prompt = withArt(buildBriefStorySlidePrompt(brief, options.brand.niche, vibe, colors, productImageUrl, options.textPosition, options.userDirection))
    const fallbackPrompt = withArtShort(simplifyBriefStorySlidePrompt(brief, vibe, productImageUrl))
    // A split brief with both halves becomes two images composited side by
    // side (lib/ai/split-layer.ts); anything else is the single prompt.
    return generateWithSplitLayer({
      brief, dims: STORY_DIMENSIONS, plan: options.plan, isInternalUnlimitedUser: options.isInternalUnlimitedUser, quality: options.quality,
      buildHalf: (text, side) => {
        const half = halfBrief(text)
        const ref = halfUsesProductReference(brief, side) ? options.productImageUrl : undefined
        return {
          prompt: withArt(buildBriefStorySlidePrompt(half, options.brand.niche, vibe, colors, ref, options.textPosition, options.userDirection)),
          fallbackPrompt: withArtShort(simplifyBriefStorySlidePrompt(half, vibe, ref)),
          productImageUrl: ref,
        }
      },
      fetchImage: fetchBackgroundImage,
      single: () => fetchBackgroundImage(prompt, fallbackPrompt, options.plan, options.isInternalUnlimitedUser, STORY_DIMENSIONS, productImageUrl, options.quality),
    })
  }

  const prompt = withArt(buildStorySlidePrompt(options.brand.niche, vibe, colors, options.productImageUrl, options.textPosition, options.customPrompt))
  const fallbackPrompt = withArtShort(simplifyStorySlidePrompt(vibe, options.productImageUrl, options.customPrompt))

  return fetchBackgroundImage(prompt, fallbackPrompt, options.plan, options.isInternalUnlimitedUser, STORY_DIMENSIONS, options.productImageUrl, options.quality)
}
