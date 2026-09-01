import {
  fetchBackgroundImage,
  wrapForReferenceImage,
  PHOTOGRAPHY_STYLE,
  REFERENCE_IMAGE_PEOPLE_GUARD,
  POST_IMAGE_QUALITY_AND_NEGATIVE_GUARD,
  type BackgroundImageResult,
} from "./post-image-pipeline"
import { type Vibe, DEFAULT_VIBE, VIBE_BACKGROUND_STYLES, VIBE_FALLBACK_COLORS, ABSTRACT_SAFETY_BOILERPLATE, describeColor } from "./vibe-background-styles"
import type { UserPlan } from "@/types/app"
import type { BrandRow } from "@/types/database"

// Preserves the pre-existing export name for callers (e.g.
// app/api/v1/ai/carousel/slide-image/generate/route.ts) — the type itself
// now lives in vibe-background-styles.ts, shared with
// lib/ai/story-slide-background.ts.
export type CarouselVibe = Vibe

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

// Confirmed live (2026-08-27): generated several real carousels and found
// hallucinated on-image text on CTA slides (e.g. a background that
// rendered "Upgrade Your Commute" and "with Noise" as real, legible
// typography). The fix at the time was to stop quoting the CTA's literal
// tagline and describe a generic closing mood instead, on the theory that
// a hook's headline is safely "topic-shaped" (e.g. "5 Morning Habits for
// Productivity") rather than a quotable branded line.
//
// Confirmed live AGAIN (2026-08-29): that theory was wrong. Reproduced a
// hook slide whose headline ("Your brand voice, AI-enhanced") is itself
// punchy, tagline-shaped copy — this function's old
// `evokes the mood of: "${headline}"` line quoted it directly, and the
// diffusion model rendered it as literal on-image text, at a different
// position than SlidePreview's real overlaid <h2>. The two together read
// as duplicated, offset text on the same slide (the actual bug report).
// "Topic-shaped vs. tagline-shaped" isn't a reliable distinction to make
// from the headline text alone, so both roles now get the same
// treatment: never quote the literal headline into the prompt. Brand
// niche (already a short, generic category descriptor like "skincare" or
// "handmade jewelry" — not a message anyone would expect rendered as
// text) replaces it for whatever topical grounding is still useful,
// falling back to the vibe/colors alone when a brand has no niche set.
// Names the region reserved for the productImage corner overlay
// CarouselBuilder.tsx's SlidePreview already draws per slide type (see its
// "Product image — cover: right side; content: top-right badge; cta:
// centered top" comment) as the one to keep visually simple, so a real
// photorealistic background doesn't compete with that overlay for the same
// space. Falls back to a generic calm-negative-space line for a slide type
// this function doesn't otherwise recognize.
function resolveProductSafeZoneGuard(slideType?: "cover" | "content" | "cta"): string {
  if (slideType === "cover") {
    return "the product fills the right two-thirds of the frame, keeping the left third simple and uncluttered for a text overlay"
  }
  if (slideType === "content") {
    return "keep the top-right corner of the frame simple and reserved for a small badge overlay, with the product and scene filling the rest of the frame"
  }
  if (slideType === "cta") {
    return "the product occupies the upper-center of the frame, keeping the lower two-thirds of the frame calm and uncluttered for a text overlay"
  }
  return "leave generous calm negative space for a text overlay"
}

function buildSlidePrompt(niche: string | null, vibe: Vibe, colors: string[], role: "hook" | "cta" | "body", productImageUrl?: string | null, slideType?: "cover" | "content" | "cta"): string {
  // Descriptive color names, not raw hex — diffusion models reliably follow
  // "a vibrant orange-red" but ignore "#FF5733" outright, confirmed via real
  // testing (see docs/research/seedream-5-lite-evaluation.md).
  const colorNames = colors.map(describeColor).filter((c): c is string => !!c).slice(0, 3)

  // A real uploaded product photo switches this from an abstract gradient
  // background to a genuine photorealistic scene with the product placed
  // in it (same reference-image prompt pieces Post/Ad Maker/Stories
  // already use, see lib/ai/post-image-pipeline.ts) — the slide's own
  // headline/CTA text is still overlaid client-side afterward
  // (CarouselBuilder.tsx's SlidePreview), so this only needs to keep that
  // text's (and the productImage overlay's) safe zone calm, not avoid
  // rendering text itself the way the abstract-only prompt below does.
  if (productImageUrl) {
    const sceneDescription = [
      PHOTOGRAPHY_STYLE,
      REFERENCE_IMAGE_PEOPLE_GUARD,
      niche ? `${niche} brand` : "",
      VIBE_BACKGROUND_STYLES[vibe],
      colorNames.length > 0 ? `color palette inspired by ${colorNames.join(" and ")}` : "",
      resolveProductSafeZoneGuard(slideType),
      POST_IMAGE_QUALITY_AND_NEGATIVE_GUARD,
    ].filter(Boolean).join(", ")
    return wrapForReferenceImage(sceneDescription)
  }

  return [
    "abstract atmospheric background image for a social media carousel slide",
    VIBE_BACKGROUND_STYLES[vibe],
    colorNames.length > 0 ? `color palette inspired by ${colorNames.join(" and ")}` : "",
    niche ? `evokes the mood of a ${niche} brand` : "",
    role === "cta" ? "evokes a warm, inviting, confident closing/call-to-action mood" : "",
    "no text, no words, no letters, no numbers, no logos anywhere in the image",
    "no rendered slogans, taglines, or typography of any kind, however short",
    "no literal photos of people, products, or objects — purely abstract shapes, gradients, and textures",
    "leave calm, uncluttered negative space so text stays readable when overlaid on top",
    "keep the composition's key visual interest centered in the frame — avoid placing it in the outer ~10% margin on any side",
    ABSTRACT_SAFETY_BOILERPLATE,
  ].filter(Boolean).join(", ")
}

function simplifySlidePrompt(vibe: Vibe, productImageUrl?: string | null): string {
  // Same shorter/simplified spirit as the abstract-only fallback below,
  // just reference-aware -- a retry with a real product photo attached
  // still needs to stay in the photorealistic reference-image path (see
  // buildSlidePrompt above), not fall back to an abstract gradient that
  // would drop the product from the scene entirely.
  if (productImageUrl) {
    return wrapForReferenceImage([PHOTOGRAPHY_STYLE, REFERENCE_IMAGE_PEOPLE_GUARD, VIBE_BACKGROUND_STYLES[vibe]].join(", "))
  }
  return [
    "abstract atmospheric gradient background",
    VIBE_BACKGROUND_STYLES[vibe],
    "no text, no words, no letters",
    "keep the composition centered, avoid the outer ~10% margin",
  ].join(", ")
}

export interface GenerateCarouselSlideBackgroundOptions {
  vibe?: CarouselVibe
  brand: BrandRow
  plan: UserPlan
  isInternalUnlimitedUser: boolean
  /** Which slide this background is for -- see buildSlidePrompt's comment
   * for why this changes the prompt, not just which plans can call this.
   * "body" (any content slide, not the cover or closing slide) is the
   * optional "AI background for every slide" mode -- unlike hook/cta,
   * generating one always costs real credits (see
   * lib/usage/credit-costs.ts's CAROUSEL_SLIDE_AI_BACKGROUND and the
   * charging logic in this route's caller). */
  role: "hook" | "cta" | "body"
  /** Real uploaded product photo, if the user attached one — switches the
   * prompt from abstract-only to a photorealistic reference-image scene
   * (see buildSlidePrompt) and is passed through to fetchBackgroundImage
   * as a genuine Flux image-to-image reference. */
  productImageUrl?: string | null
  /** Which corner/region CarouselBuilder.tsx's SlidePreview will draw the
   * productImage overlay in for this slide -- used only to pick the
   * matching safe-zone line in the photorealistic prompt (see
   * resolveProductSafeZoneGuard); has no effect on the abstract-only
   * prompt. */
  slideType?: "cover" | "content" | "cta"
}

/**
 * Generates an abstract, on-brand background image for a carousel slide
 * (hook, CTA, or an opted-in body slide) — reuses fetchBackgroundImage's
 * existing Pollinations/Flux provider resolution, retry, and quality-check
 * logic as-is; this module only owns the carousel-specific prompt (brand
 * niche + vibe + brand colors, deliberately abstract rather than literal
 * photography). Never throws — same never-throw contract as
 * fetchBackgroundImage. Deliberately takes no headline/caption text at
 * all — see buildSlidePrompt's comment for why quoting any specific slide
 * text into the prompt is what caused real on-image text hallucination.
 */
export async function generateCarouselSlideBackground(
  options: GenerateCarouselSlideBackgroundOptions
): Promise<BackgroundImageResult> {
  const vibe = options.vibe ?? DEFAULT_VIBE
  const brandColors = resolveBrandColors(options.brand)
  const colors = brandColors.length > 0 ? brandColors : VIBE_FALLBACK_COLORS[vibe]

  const prompt = buildSlidePrompt(options.brand.niche, vibe, colors, options.role, options.productImageUrl, options.slideType)
  const fallbackPrompt = simplifySlidePrompt(vibe, options.productImageUrl)

  return fetchBackgroundImage(prompt, fallbackPrompt, options.plan, options.isInternalUnlimitedUser, undefined, options.productImageUrl)
}
