import { generateStorySlideBackground } from "./story-slide-background"
import { AGREE_MIN, slidePhotoAgreement } from "./slide-photo-check"

/**
 * A story's closing (cta) frame sells a product, so its photo must show that
 * product clearly and recognisably -- the whole linen shirt, never a close
 * crop of a neck and collar. The cta frame is generated with its subject
 * (lib/ai/story-slide-background.ts ctaProductLine), then checked by the same
 * item check carousel slides use (lib/ai/slide-photo-check.ts); below
 * AGREE_MIN it is generated once more with the miss spelled out and the
 * better of the two kept. Other frames, or a cta with no subject, are
 * generated as before.
 */

type StoryOptions = Parameters<typeof generateStorySlideBackground>[0]
type StoryResult = Awaited<ReturnType<typeof generateStorySlideBackground>>

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export async function generateCheckedStoryFrame(options: StoryOptions, label: string, productName?: string | null, canRetry: () => boolean = () => true): Promise<StoryResult & { agree?: number; checkCostUsd?: number | null }> {
  const subject = options.role === "cta" ? options.ctaSubject?.trim() : null
  const first = await generateStorySlideBackground(options)
  if (!subject || !first.success) return first
  const copy = { headline: title(subject), body: `the whole ${subject}, clearly visible and recognisable -- not a close-up of a collar, a sleeve or the fabric`, productName }
  const check = await slidePhotoAgreement(options.brand, first.buffer, first.mimeType, copy, `${label} cta`)
  if (!check || check.agree >= AGREE_MIN || !canRetry()) return { ...first, agree: check?.agree, checkCostUsd: check?.costUsd ?? null }
  console.log(`[story-cta-photo] ${label}: the cta photo doesn't show the ${subject} (show_item ${check.agree}) -- one more try`)
  const direction = [options.userDirection, `show the whole ${subject}, fully in frame, worn or held and instantly recognisable; not a close crop${check.fix ? `. Fix: ${check.fix}` : ""}`].filter(Boolean).join(". ")
  // A frame without a brief reads its scene from customPrompt, not userDirection.
  const second = await generateStorySlideBackground({ ...options, userDirection: direction, customPrompt: options.visualBrief ? options.customPrompt : [options.customPrompt, direction].filter(Boolean).join(". ") })
  if (!second.success) return { ...first, attempts: [...first.attempts, ...second.attempts], agree: check.agree, checkCostUsd: check.costUsd }
  const recheck = await slidePhotoAgreement(options.brand, second.buffer, second.mimeType, copy, `${label} cta retry`)
  const better = !recheck || recheck.agree >= check.agree ? second : first
  return { ...better, attempts: [...first.attempts, ...second.attempts], agree: better === second ? recheck?.agree : check.agree, checkCostUsd: (check.costUsd ?? 0) + (recheck?.costUsd ?? 0) }
}
