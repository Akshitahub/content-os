import { fetchBackgroundImage, type BackgroundImageResult } from "./post-image-pipeline"
import { type Vibe, DEFAULT_VIBE, VIBE_BACKGROUND_STYLES, VIBE_FALLBACK_COLORS, ABSTRACT_SAFETY_BOILERPLATE } from "./vibe-background-styles"
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

function buildSlidePrompt(headline: string, vibe: Vibe, colors: string[]): string {
  return [
    "abstract atmospheric background image for a social media carousel slide",
    VIBE_BACKGROUND_STYLES[vibe],
    colors.length > 0 ? `color palette centered around ${colors.slice(0, 3).join(", ")}` : "",
    `evokes the mood of: "${headline}"`,
    "no text, no words, no letters, no numbers, no logos anywhere in the image",
    "no literal photos of people, products, or objects — purely abstract shapes, gradients, and textures",
    "leave calm, uncluttered negative space so text stays readable when overlaid on top",
    ABSTRACT_SAFETY_BOILERPLATE,
  ].filter(Boolean).join(", ")
}

function simplifySlidePrompt(vibe: Vibe): string {
  return [
    "abstract atmospheric gradient background",
    VIBE_BACKGROUND_STYLES[vibe],
    "no text, no words, no letters",
  ].join(", ")
}

export interface GenerateCarouselSlideBackgroundOptions {
  headline: string
  vibe?: CarouselVibe
  brand: BrandRow
  plan: UserPlan
  isInternalUnlimitedUser: boolean
}

/**
 * Generates an abstract, on-brand background image for a carousel slide
 * (hook or CTA) — reuses fetchBackgroundImage's existing Pollinations/Flux
 * provider resolution, retry, and quality-check logic as-is; this module
 * only owns the carousel-specific prompt (headline mood + vibe + brand
 * colors, deliberately abstract rather than literal photography). Never
 * throws — same never-throw contract as fetchBackgroundImage.
 */
export async function generateCarouselSlideBackground(
  options: GenerateCarouselSlideBackgroundOptions
): Promise<BackgroundImageResult> {
  const vibe = options.vibe ?? DEFAULT_VIBE
  const brandColors = resolveBrandColors(options.brand)
  const colors = brandColors.length > 0 ? brandColors : VIBE_FALLBACK_COLORS[vibe]

  const prompt = buildSlidePrompt(options.headline, vibe, colors)
  const fallbackPrompt = simplifySlidePrompt(vibe)

  return fetchBackgroundImage(prompt, fallbackPrompt, options.plan, options.isInternalUnlimitedUser)
}
