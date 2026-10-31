import type { BrandRow } from "@/types/database"
import { PHOTO_KINDS_FOR } from "@/lib/brand-photos"
import { chooseFittingPhotos, photoFitItem } from "./photo-fit"
import { carouselFrameNeedsPhoto } from "@/lib/design/carousel-frames"
import { sanitizeVisualBrief } from "./visual-brief"

/**
 * Real photos first for a carousel's photo-led slides (lib/ai/photo-fit.ts):
 * each gets the brand photo that FITS its brief and copy (fit 4+), never the
 * same photo twice in one carousel and never another product's. Slides
 * nothing fits keep no image_url -- the caller generates those. Type-led
 * slides never get one. Fail-soft: on any error the slides come back as-is.
 */
export async function assignCarouselBrandPhotos(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  brand: Pick<BrandRow, "id">,
  slides: Record<string, unknown>[],
  opts: { productId?: string | null; productName?: string | null; label: string },
): Promise<Record<string, unknown>[]> {
  const wanted = slides.map((s, i) => ({ s, i })).filter(({ s }) => carouselFrameNeedsPhoto(s.frame) && !s.image_url)
  if (wanted.length === 0) return slides
  const photos = await chooseFittingPhotos(db, brand, {
    productId: opts.productId ?? null, productName: opts.productName ?? null, kinds: PHOTO_KINDS_FOR.post,
    items: wanted.map(({ s }) => photoFitItem(sanitizeVisualBrief(s.visual) ?? null, null, [s.headline as string | undefined, s.subtext as string | undefined])),
    label: opts.label,
  })
  const out = [...slides]
  wanted.forEach(({ i }, k) => {
    const photo = photos[k]
    if (photo) out[i] = { ...out[i], image_url: photo.url, background_image_provider: "brand_photo", text_style: null }
  })
  return out
}
