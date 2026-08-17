import { fetchBackgroundImage, type BackgroundImageResult } from "./post-image-pipeline"
import type { UserPlan } from "@/types/app"
import type { BrandRow } from "@/types/database"

// Deliberately NOT lib/ai/prompts.ts's IMAGE_QUALITY_SAFETY_BOILERPLATE —
// that one opens with "professional photography" and includes an anatomy
// clause, both aimed at literal photographic content (post images,
// products, memes). Reusing it here would fight the abstract-only
// direction these prompts are built around.
const SAFETY_BOILERPLATE = "no watermarks, no illegible text or symbols, clean high-resolution render, sharp focus"

export type CarouselVibe =
  | "fun_playful"
  | "clean_minimal"
  | "bold_dramatic"
  | "warm_cozy"
  | "professional"
  | "trendy_genz"

const DEFAULT_VIBE: CarouselVibe = "clean_minimal"

// Abstract/atmospheric direction per vibe — deliberately NOT literal product
// or scene photography (unlike post-image-pipeline.ts's PHOTOGRAPHY_STYLE),
// since these sit directly behind live text and need to stay uncluttered.
const VIBE_BACKGROUND_STYLES: Record<CarouselVibe, string> = {
  fun_playful: "vibrant abstract gradient background with playful organic blob shapes, bright energetic color transitions, soft glowing light",
  clean_minimal: "minimalist abstract background, soft subtle gradient, generous negative space, gentle geometric shapes, understated texture",
  bold_dramatic: "high-contrast abstract gradient background, dramatic dark tones with a bold streak of accent color, moody atmospheric lighting, strong geometric shapes",
  warm_cozy: "warm abstract gradient background, soft glowing light, cozy amber and terracotta tones, gentle organic texture",
  professional: "sophisticated abstract gradient background, subtle geometric pattern, muted corporate-appropriate tones, clean structured composition",
  trendy_genz: "vibrant holographic abstract gradient background, iridescent color shift, bold abstract shapes, glossy Y2K-inspired texture",
}

// Same fallback swatches components/shared/VibePicker.tsx shows the user
// per vibe — duplicated here (rather than imported) since that component is
// a "use client" file and this runs server-side. Only used when the brand
// has no colors of its own set yet.
const VIBE_FALLBACK_COLORS: Record<CarouselVibe, string[]> = {
  fun_playful: ["#FF6B6B", "#FFE66D", "#4ECDC4"],
  clean_minimal: ["#FFFFFF", "#F5F5F5", "#333333"],
  bold_dramatic: ["#000000", "#6366F1", "#EC4899"],
  warm_cozy: ["#F59E0B", "#EF4444", "#FEF3C7"],
  professional: ["#1E40AF", "#FFFFFF", "#1F2937"],
  trendy_genz: ["#7C3AED", "#EC4899", "#06B6D4"],
}

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

function buildSlidePrompt(headline: string, vibe: CarouselVibe, colors: string[]): string {
  return [
    "abstract atmospheric background image for a social media carousel slide",
    VIBE_BACKGROUND_STYLES[vibe],
    colors.length > 0 ? `color palette centered around ${colors.slice(0, 3).join(", ")}` : "",
    `evokes the mood of: "${headline}"`,
    "no text, no words, no letters, no numbers, no logos anywhere in the image",
    "no literal photos of people, products, or objects — purely abstract shapes, gradients, and textures",
    "leave calm, uncluttered negative space so text stays readable when overlaid on top",
    SAFETY_BOILERPLATE,
  ].filter(Boolean).join(", ")
}

function simplifySlidePrompt(vibe: CarouselVibe): string {
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
