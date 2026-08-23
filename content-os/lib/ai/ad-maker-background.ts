import { fetchBackgroundImage, type BackgroundImageResult, type ImageDimensions } from "./post-image-pipeline"
import type { UserPlan } from "@/types/app"

// Kept in sync with the SCENE_PROMPTS dict in components/generate/AdMaker.tsx
// (that file stays "use client" for its own preset picker UI, so this
// server-only module carries its own copy rather than importing across that
// boundary) -- same preset ids, same descriptions.
const SCENE_PROMPTS: Record<string, string> = {
  white_studio: "pure white studio background, soft box lighting, minimal shadows, professional product photography, no props",
  dark_studio: "dark charcoal studio background, dramatic side lighting, luxury product photography, moody atmosphere",
  marble_surface: "white marble surface, soft window light, minimal aesthetic, luxury lifestyle photography, elegant",
  wooden_table: "rustic wooden table, warm morning sunlight, cozy lifestyle photography, natural wood texture",
  nature_green: "lush green nature background, golden hour sunlight, bokeh effect, organic lifestyle photography",
  beach_summer: "sandy beach, turquoise water, bright summer day, lifestyle photography, fun and vibrant",
  urban_street: "urban city street, brick wall background, trendy editorial fashion photography, street art",
  cozy_cafe: "cozy cafe interior, warm lighting, wooden tables, coffee aesthetic, lifestyle photography",
  diwali_glow: "Diwali festival decoration, earthen diyas, marigold flowers, warm golden light, Indian festive celebration",
  christmas: "Christmas decorations, pine branches, fairy lights, warm bokeh, festive gifting photography",
  party_fun: "colorful party background, balloons, confetti, celebration, fun and energetic",
}

export type AdMakerFormat = "square" | "portrait" | "story"

const FORMAT_DIMENSIONS: Record<AdMakerFormat, ImageDimensions> = {
  square: { width: 1080, height: 1080, aspectRatio: "1:1" },
  portrait: { width: 1080, height: 1350, aspectRatio: "3:4" },
  story: { width: 1080, height: 1920, aspectRatio: "9:16" },
}

function resolveSceneDescription(scene: string, customScene?: string): string {
  if (scene === "custom") return customScene?.trim() || SCENE_PROMPTS.white_studio
  return SCENE_PROMPTS[scene] ?? SCENE_PROMPTS.white_studio
}

export interface GenerateAdMakerBackgroundOptions {
  scene: string
  customScene?: string
  brandNiche: string | null
  format: AdMakerFormat
  plan: UserPlan
  isInternalUnlimitedUser: boolean
}

/**
 * Fetches Ad Maker's background image via the shared fetchBackgroundImage
 * pipeline (plan-based Pollinations/Flux resolution, retry-with-fallback,
 * blur/near-black/near-blank quality checks) instead of Ad Maker's old
 * client-side, Pollinations-only, bespoke-retry fetch. Never throws --
 * same never-throw contract as fetchBackgroundImage.
 */
export async function generateAdMakerBackground(
  options: GenerateAdMakerBackgroundOptions
): Promise<BackgroundImageResult> {
  const sceneDesc = resolveSceneDescription(options.scene, options.customScene)
  const niche = options.brandNiche || "lifestyle brand"
  const prompt = `${sceneDesc}, ${niche} brand, no people, no text, no watermarks, no logos, photorealistic, 8K`
  const fallbackPrompt = `${sceneDesc}, ${niche} brand, no text, no watermarks`
  const dimensions = FORMAT_DIMENSIONS[options.format] ?? FORMAT_DIMENSIONS.square

  return fetchBackgroundImage(prompt, fallbackPrompt, options.plan, options.isInternalUnlimitedUser, dimensions)
}
