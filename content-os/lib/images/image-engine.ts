import { fetchBackgroundImage, type ImageDimensions } from "@/lib/ai/post-image-pipeline"
import type { UserPlan } from "@/types/app"

// Not currently imported/called anywhere in this codebase (confirmed via
// repo-wide search) -- fixed as part of the Pollinations removal since it
// was explicitly named in that cleanup, not because anything depends on it
// today. Kept as a real, working Replicate/Flux implementation (not just
// deleted) in case a future caller reaches for this module by name.

export type ImageFormat = "square" | "portrait" | "story" | "landscape"

export interface ImageRequest {
  format: ImageFormat
  vibe?: string
  brand: {
    name: string
    niche?: string | null
    primary_color?: string | null
    vibe?: string | null
  }
  product?: {
    name: string
    description?: string | null
    image_url?: string
  }
  custom_prompt?: string
  /** Required now that generation is a real, credit-metered Replicate/Flux
   * call rather than a free, keyless Pollinations URL -- fetchBackgroundImage
   * needs these for its own logging even though every plan resolves to
   * Flux (see that function's own doc comment). */
  plan: UserPlan
  isInternalUnlimitedUser: boolean
}

export type ImageResult =
  | { success: true; buffer: Buffer; mimeType: string; fullPrompt: string }
  | { success: false; error: string }

const VIBE_STYLES: Record<string, string> = {
  fun_playful: "bright colorful photography, vibrant, fun energy, joyful",
  clean_minimal: "minimal white studio photography, clean aesthetic, elegant, simple",
  bold_dramatic: "dark dramatic photography, high contrast, moody, powerful editorial",
  warm_cozy: "warm golden hour photography, cozy lifestyle, inviting, soft light",
  professional: "professional corporate photography, clean business aesthetic, credible",
  trendy_genz: "trendy aesthetic photography, gen z vibes, editorial fresh, colourful",
}

// Replicate/Flux's own aspect_ratio enum (see post-image-pipeline.ts) has
// no "landscape 16:9 at 1920x1080" tier as such -- "16:9" is the closest
// valid value, same substitution post-image-pipeline.ts already makes for
// "4:5" -> "3:4".
const FORMAT_DIMENSIONS: Record<ImageFormat, ImageDimensions> = {
  square: { width: 1080, height: 1080, aspectRatio: "1:1" },
  portrait: { width: 1080, height: 1350, aspectRatio: "3:4" },
  story: { width: 1080, height: 1920, aspectRatio: "9:16" },
  landscape: { width: 1920, height: 1080, aspectRatio: "16:9" },
}

function buildPrompt(request: ImageRequest): string {
  if (request.custom_prompt) {
    return `${request.custom_prompt}, no text, no watermarks, no people, professional, 8K ultra HD`
  }

  const vibeKey = request.vibe ?? request.brand.vibe ?? "fun_playful"
  const vibeStyle = VIBE_STYLES[vibeKey] ?? VIBE_STYLES.fun_playful
  const niche = request.brand.niche ?? "lifestyle brand"
  const productCtx = request.product
    ? `${request.product.name}${request.product.description ? `, ${request.product.description.slice(0, 80)}` : ""},`
    : ""

  return `${productCtx} ${vibeStyle}, ${niche}, no people, no text, no watermarks, photorealistic, 8K ultra HD`
}

export async function generateImage(request: ImageRequest): Promise<ImageResult> {
  const prompt = buildPrompt(request)
  const dimensions = FORMAT_DIMENSIONS[request.format]
  const result = await fetchBackgroundImage(prompt, prompt, request.plan, request.isInternalUnlimitedUser, dimensions, request.product?.image_url ?? null)
  if (!result.success) return { success: false, error: result.error }
  return { success: true, buffer: result.buffer, mimeType: result.mimeType, fullPrompt: prompt }
}
