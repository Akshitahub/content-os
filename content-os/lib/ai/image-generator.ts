import type { BrandRow, ProductRow } from "@/types/database"
import type { AspectRatio, ImageStyle, UserPlan } from "@/types/app"
import { buildImagePrompt } from "./prompts"
import { fetchBackgroundImage, type ImageDimensions } from "./post-image-pipeline"

// Matches this tab's existing, long-standing 1024x1024 output. Note the
// caller-supplied `aspectRatio` option below was never actually wired into
// the old hardcoded Pollinations URL either (it always requested
// width=1024&height=1024 regardless) -- preserved as-is here rather than
// silently adding real aspect-ratio support, since that's a separate
// feature change outside this migration's scope.
const IMAGE_TAB_DIMENSIONS: ImageDimensions = { width: 1024, height: 1024, aspectRatio: "1:1" }

export type GenerateImageResult =
  | { success: true; buffer: Buffer; mimeType: string; fullPrompt: string; provider: "pollinations" | "flux" }
  | { success: false; error: string }

/**
 * Now routes through lib/ai/post-image-pipeline.ts's fetchBackgroundImage
 * instead of its own hand-rolled Pollinations-only fetch -- that duplicate
 * implementation bypassed the shared pipeline's plan-based provider
 * resolution (Free -> Pollinations, paid+internal -> Flux), retry-with-
 * fallback-prompt, and blur/near-black/near-blank quality checks entirely,
 * which is why paying users got Pollinations-only quality on this specific
 * tab regardless of plan. Never throws -- every failure mode returns
 * { success: false } instead, matching fetchBackgroundImage's own contract
 * (see app/api/v1/ai/images/generate/route.ts for how the caller checks
 * `.success` rather than try/catch now).
 */
export async function generateImage(
  brand: BrandRow,
  options: {
    prompt: string
    style?: ImageStyle
    aspectRatio: AspectRatio
    product?: ProductRow | null
    plan: UserPlan
    isInternalUnlimitedUser: boolean
  }
): Promise<GenerateImageResult> {
  const fullPrompt = buildImagePrompt(brand, {
    prompt: options.prompt,
    style: options.style,
    product: options.product,
  })
  const fallbackPrompt = buildImagePrompt(brand, {
    prompt: options.prompt,
    style: options.style,
    simplified: true,
  })

  // products.image_urls[0] -- the real uploaded product photo, now used as
  // a Flux image-to-image reference the same way Commit 1 wired it into
  // the Create -> Full Post pipeline. Pollinations ignores it (no
  // image-to-image capability there).
  const productImageUrl = options.product?.image_urls?.[0] ?? null

  const result = await fetchBackgroundImage(
    fullPrompt,
    fallbackPrompt,
    options.plan,
    options.isInternalUnlimitedUser,
    IMAGE_TAB_DIMENSIONS,
    productImageUrl
  )

  if (!result.success) {
    return { success: false, error: result.error }
  }

  return { success: true, buffer: result.buffer, mimeType: result.mimeType, fullPrompt, provider: result.provider }
}
