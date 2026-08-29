import { fetchBackgroundImage, type BackgroundImageResult } from "./post-image-pipeline"
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
function buildSlidePrompt(niche: string | null, vibe: Vibe, colors: string[], role: "hook" | "cta" | "body"): string {
  // Descriptive color names, not raw hex — diffusion models reliably follow
  // "a vibrant orange-red" but ignore "#FF5733" outright, confirmed via real
  // testing (see docs/research/seedream-5-lite-evaluation.md).
  const colorNames = colors.map(describeColor).filter((c): c is string => !!c).slice(0, 3)
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

function simplifySlidePrompt(vibe: Vibe): string {
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

  const prompt = buildSlidePrompt(options.brand.niche, vibe, colors, options.role)
  const fallbackPrompt = simplifySlidePrompt(vibe)

  return fetchBackgroundImage(prompt, fallbackPrompt, options.plan, options.isInternalUnlimitedUser)
}
