import type { BrandRow } from "@/types/database"
import { critiquePost } from "./critic"
import { generateCarouselSlideBackground } from "./carousel-slide-background"

/**
 * A carousel slide's photo must show THAT slide's point (the olive slide
 * shows the olive chinos; a pairing slide shows that exact pairing). After
 * a slide's photo is generated, the critic checks it against the slide's
 * own words; when they don't agree (image_copy_agree below AGREE_MIN) the
 * photo is generated once more with the critic's fix, and the better of
 * the two is kept. No critic (no key / an error) = the first photo, as
 * before. Brand photos are already matched per slide by photo-fit.
 */

export const AGREE_MIN = 5

export interface SlideCopy { headline: string; body?: string | null }

/** The critic's image/copy agreement (1-10) for a slide photo and its words; null when it can't score. */
export async function slidePhotoAgreement(brand: BrandRow, image: Buffer, mimeType: string, copy: SlideCopy, label: string): Promise<{ agree: number; fix: string; costUsd: number | null } | null> {
  const verdict = await critiquePost(brand, {
    imageUrl: `data:${mimeType};base64,${image.toString("base64")}`,
    caption: copy.body ?? "",
    hook: copy.headline,
    format: "carousel",
  }, `${label} slide-photo`)
  if (!verdict) return null
  return { agree: verdict.scores.image_copy_agree.score, fix: verdict.scores.image_copy_agree.reason || verdict.top_fix, costUsd: verdict.costUsd }
}

type SlideOptions = Parameters<typeof generateCarouselSlideBackground>[0]
type SlideResult = Awaited<ReturnType<typeof generateCarouselSlideBackground>>

/**
 * generateCarouselSlideBackground, then the per-slide agreement check and
 * at most one regeneration with the fix. `copy` absent = no check. Every
 * billed attempt is kept on the result.
 */
export async function generateCheckedSlide(options: SlideOptions, copy: SlideCopy | null | undefined, label: string, canRetry: () => boolean = () => true): Promise<SlideResult & { agree?: number; checkCostUsd?: number | null }> {
  const first = await generateCarouselSlideBackground(options)
  if (!first.success || !copy?.headline?.trim()) return first
  const check = await slidePhotoAgreement(options.brand, first.buffer, first.mimeType, copy, label)
  if (!check || check.agree >= AGREE_MIN || !canRetry()) return { ...first, agree: check?.agree, checkCostUsd: check?.costUsd ?? null }
  console.log(`[slide-photo-check] ${label}: photo doesn't show the slide's point (agree ${check.agree}) -- one more try`)
  const direction = [options.userDirection, `the photo must show exactly this: ${copy.headline}${copy.body ? ` -- ${copy.body}` : ""}. Fix: ${check.fix}`].filter(Boolean).join(". ")
  const second = await generateCarouselSlideBackground({ ...options, userDirection: direction })
  if (!second.success) return { ...first, attempts: [...first.attempts, ...second.attempts], agree: check.agree, checkCostUsd: check.costUsd }
  const recheck = await slidePhotoAgreement(options.brand, second.buffer, second.mimeType, copy, `${label} retry`)
  const cost = (check.costUsd ?? 0) + (recheck?.costUsd ?? 0)
  const better = !recheck || recheck.agree >= check.agree ? second : first
  return { ...better, attempts: [...first.attempts, ...second.attempts], agree: better === second ? recheck?.agree : check.agree, checkCostUsd: cost }
}
