import { generateStorySlideBackground } from "./story-slide-background"
import { AGREE_MIN, slidePhotoAgreement } from "./slide-photo-check"

/**
 * A story's closing (cta) frame sells a product, so its photo must show that
 * product clearly and recognisably -- the whole linen shirt, never a close
 * crop of a neck and collar. The cta frame is generated with its subject
 * (lib/ai/story-slide-background.ts ctaProductLine), then checked by the same
 * item check carousel slides use (lib/ai/slide-photo-check.ts). The score is
 * logged and returned as `agree`; the photo is kept either way -- no second
 * image is generated (same as generateCheckedSlide). Other frames, or a cta
 * with no subject, are generated as before.
 */

type StoryOptions = Parameters<typeof generateStorySlideBackground>[0]
type StoryResult = Awaited<ReturnType<typeof generateStorySlideBackground>>

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export async function generateCheckedStoryFrame(options: StoryOptions, label: string, productName?: string | null): Promise<StoryResult & { agree?: number; checkCostUsd?: number | null }> {
  const subject = options.role === "cta" ? options.ctaSubject?.trim() : null
  const first = await generateStorySlideBackground(options)
  if (!subject || !first.success) return first
  const copy = { headline: title(subject), body: `the whole ${subject}, clearly visible and recognisable -- not a close-up of a collar, a sleeve or the fabric`, productName }
  const check = await slidePhotoAgreement(options.brand, first.buffer, first.mimeType, copy, `${label} cta`)
  if (check && check.agree < AGREE_MIN) console.log(`[story-cta-photo] ${label}: the cta photo doesn't show the ${subject} (show_item ${check.agree}) -- kept, no retry`)
  return { ...first, agree: check?.agree, checkCostUsd: check?.costUsd ?? null }
}
