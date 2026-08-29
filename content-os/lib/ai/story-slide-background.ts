import { fetchBackgroundImage, type BackgroundImageResult, type ImageDimensions } from "./post-image-pipeline"
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
function buildStorySlidePrompt(niche: string | null, vibe: Vibe, colors: string[]): string {
  // Descriptive color names, not raw hex — diffusion models reliably follow
  // "a vibrant orange-red" but ignore "#FF5733" outright, confirmed via real
  // testing (see docs/research/seedream-5-lite-evaluation.md).
  const colorNames = colors.map(describeColor).filter((c): c is string => !!c).slice(0, 3)
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

  const prompt = buildStorySlidePrompt(options.brand.niche, vibe, colors)
  const fallbackPrompt = simplifyStorySlidePrompt(vibe)

  return fetchBackgroundImage(prompt, fallbackPrompt, options.plan, options.isInternalUnlimitedUser, STORY_DIMENSIONS)
}
