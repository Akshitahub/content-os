import sharp from "sharp"
// Types only: post-image-pipeline itself uses this module, so the fetch
// function is passed in (fetchImage) rather than imported.
import type { BackgroundImageResult, ImageGenerationAttempt, fetchBackgroundImage } from "./post-image-pipeline"
import type { ImageDimensions, ImageQuality } from "./image-provider"
import type { UserPlan } from "@/types/app"
import { hasSplitHalves, type VisualBrief } from "./visual-brief"

// Deterministic split layouts (side_by_side / before_after): instead of
// asking one image for "two halves" -- which round 1 showed can come back
// as a single, non-split scene -- each half is generated as its own normal
// single-subject image and the two are composited side by side here.
//
// Credit price is unchanged for now: the second image is absorbed (both
// halves' real costs still land on the caller's attempts, so they're
// logged). Kill switch: SPLIT_LAYER_ENABLED=false restores the single-image
// split prompt everywhere.

export function splitLayerEnabled(): boolean {
  return process.env.SPLIT_LAYER_ENABLED !== "false"
}

// A light, neutral seam -- reads as a deliberate diptych, not a label.
const GUTTER_COLOR = { r: 236, g: 233, b: 228 }
const GUTTER_RATIO = 0.012

export interface HalfPrompt {
  prompt: string
  fallbackPrompt: string
  /** Product reference for this half only (null = text-only generation). */
  productImageUrl?: string | null
}

/** What the split layer did for one image (recorded by the harnesses). */
export interface SplitLayerInfo {
  used: boolean
  halfPrompts: { left: string; right: string }
  /** Why the single-image prompt ran instead (a half failed). */
  fallbackReason?: string
}

export type SplitBackgroundResult = BackgroundImageResult & { split?: SplitLayerInfo }

/** Half-canvas dimensions for one side (the provider picks its closest native size). */
function halfDimensions(dims: ImageDimensions): ImageDimensions {
  return { width: Math.round(dims.width / 2), height: dims.height, aspectRatio: `half ${dims.aspectRatio}` }
}

/** Two images -> one canvas of `dims`, each cover-fitted into its half with a thin gutter. */
export async function compositeHalves(left: Buffer, right: Buffer, dims: ImageDimensions): Promise<Buffer> {
  const gutter = Math.max(4, Math.round(dims.width * GUTTER_RATIO))
  const leftW = Math.floor((dims.width - gutter) / 2)
  const rightW = dims.width - gutter - leftW
  const [l, r] = await Promise.all([
    sharp(left).resize(leftW, dims.height, { fit: "cover" }).png().toBuffer(),
    sharp(right).resize(rightW, dims.height, { fit: "cover" }).png().toBuffer(),
  ])
  return sharp({ create: { width: dims.width, height: dims.height, channels: 3, background: GUTTER_COLOR } })
    .composite([{ input: l, left: 0, top: 0 }, { input: r, left: leftW + gutter, top: 0 }])
    .png()
    .toBuffer()
}

/**
 * Runs `single` (today's one-image split prompt) unless the brief is a split
 * kind with both halves and the layer is enabled -- then generates the two
 * halves concurrently (same plan and quality as the slide) and composites
 * them at `dims`. If either half fails, falls back to `single`; every
 * billed attempt, halves included, is kept on the result.
 */
export async function generateWithSplitLayer(options: {
  brief: VisualBrief | undefined
  dims: ImageDimensions
  plan: UserPlan
  isInternalUnlimitedUser: boolean
  quality?: ImageQuality
  buildHalf: (text: string, side: "left" | "right") => HalfPrompt
  single: () => Promise<BackgroundImageResult>
  /** fetchBackgroundImage (injected -- see the import above). */
  fetchImage: typeof fetchBackgroundImage
}): Promise<SplitBackgroundResult> {
  const { brief } = options
  if (!hasSplitHalves(brief) || !splitLayerEnabled()) return options.single()

  const left = options.buildHalf(brief.left, "left")
  const right = options.buildHalf(brief.right, "right")
  const halfPrompts = { left: left.prompt, right: right.prompt }
  const dims = halfDimensions(options.dims)
  const [l, r] = await Promise.all([left, right].map((h) =>
    options.fetchImage(h.prompt, h.fallbackPrompt, options.plan, options.isInternalUnlimitedUser, dims, h.productImageUrl, options.quality)
  ))
  const halfAttempts: ImageGenerationAttempt[] = [...l!.attempts, ...r!.attempts]

  if (l!.success && r!.success) {
    try {
      const buffer = await compositeHalves(l!.buffer, r!.buffer, options.dims)
      console.log(`[split-layer] composited ${brief.kind} from two halves (${halfAttempts.length} attempts)`)
      return { success: true, buffer, mimeType: "image/png", provider: l!.provider, attempts: halfAttempts, split: { used: true, halfPrompts } }
    } catch (err) {
      return fallback(err instanceof Error ? err.message : "composite failed")
    }
  }
  return fallback([l, r].map((x, i) => (x!.success ? null : `${i ? "right" : "left"}: ${x!.error}`)).filter(Boolean).join("; "))

  async function fallback(reason: string): Promise<SplitBackgroundResult> {
    console.error(`[split-layer] a half failed, falling back to the single-image split prompt: ${reason}`)
    const single = await options.single()
    return { ...single, attempts: [...halfAttempts, ...single.attempts], split: { used: false, halfPrompts, fallbackReason: reason } }
  }
}
