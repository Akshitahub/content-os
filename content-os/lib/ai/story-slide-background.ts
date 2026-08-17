import { fetchBackgroundImage, type BackgroundImageResult, type ImageDimensions } from "./post-image-pipeline"
import { type Vibe, DEFAULT_VIBE, VIBE_BACKGROUND_STYLES, VIBE_FALLBACK_COLORS, ABSTRACT_SAFETY_BOILERPLATE } from "./vibe-background-styles"
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

function buildStorySlidePrompt(text: string, vibe: Vibe, colors: string[]): string {
  return [
    "abstract atmospheric vertical background image for a full-screen phone story slide",
    VIBE_BACKGROUND_STYLES[vibe],
    colors.length > 0 ? `color palette centered around ${colors.slice(0, 3).join(", ")}` : "",
    `evokes the mood of: "${text}"`,
    "no text, no words, no letters, no numbers, no logos anywhere in the image",
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
  text: string
  vibe?: StoryVibe
  brand: BrandRow
  plan: UserPlan
  isInternalUnlimitedUser: boolean
}

/**
 * Generates an abstract, on-brand portrait background image for a story
 * slide (hook or CTA) — same prompt construction as
 * lib/ai/carousel-slide-background.ts (vibe + brand color + content mood,
 * deliberately abstract rather than literal photography), just framed for
 * Stories' 9:16 canvas instead of a square. Reuses fetchBackgroundImage's
 * provider resolution, retry, and quality-check logic as-is — no
 * duplicated fetch/retry/fallback code. Never throws.
 */
export async function generateStorySlideBackground(
  options: GenerateStorySlideBackgroundOptions
): Promise<BackgroundImageResult> {
  const vibe = options.vibe ?? DEFAULT_VIBE
  const brandColors = resolveBrandColors(options.brand)
  const colors = brandColors.length > 0 ? brandColors : VIBE_FALLBACK_COLORS[vibe]

  const prompt = buildStorySlidePrompt(options.text, vibe, colors)
  const fallbackPrompt = simplifyStorySlidePrompt(vibe)

  return fetchBackgroundImage(prompt, fallbackPrompt, options.plan, options.isInternalUnlimitedUser, STORY_DIMENSIONS)
}
