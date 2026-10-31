import type { BrandPalette } from "@/lib/design/color-themes"
import { isFontId, type FontId } from "@/lib/design/fonts"
import { FEED_CANVAS, renderFrame, type FrameKind } from "@/lib/image/story-frame-compositor"
import type { CarouselFrame } from "@/lib/design/carousel-frames"
import type { SubjectBox } from "@/lib/image/subject-boxes"
import { frameLogo, type FrameLogo } from "@/lib/design/logo-settings"

/**
 * One framed carousel slide (lib/design/carousel-frames.ts) drawn at
 * 1080x1350 by the story frame compositor -- the builder's preview, its
 * download / schedule export and Autopilot all render through this.
 */
export interface CarouselFrameSlide {
  frame: CarouselFrame
  headline: string
  subtext?: string | null
  cta?: string | null
  image_url?: string | null
  seed?: number | null
  tape?: boolean | null
  brand_mark?: boolean | null
  font_id?: FontId | string | null
  /** The photo's subject boxes when already known; else stored / detected at render. */
  subject_boxes?: SubjectBox[] | null
}

const KIND: Record<CarouselFrame, FrameKind> = { hook: "hook", slide_photo: "slide_photo", slide_type: "slide_type", cta: "cta" }

/** The slide as a JPEG. Throws only if the canvas itself can't be drawn. */
export function renderCarouselFrame(
  s: CarouselFrameSlide,
  brand: { name: string; logo_url?: string | null; palette: BrandPalette; fontId: FontId } & Partial<FrameLogo>,
): Promise<Buffer> {
  const handwritten = s.frame === "hook" || s.frame === "cta"
  return renderFrame({
    frame: KIND[s.frame],
    big_words: s.headline,
    script_line: handwritten ? s.subtext ?? null : null,
    body: handwritten ? null : s.subtext ?? null,
    cta_label: s.frame === "cta" ? s.cta ?? null : null,
    seed: s.seed ?? 1,
    brand_mark: !!s.brand_mark,
    // A type-led slide is drawn on the brand's colour, never a photo.
    background_image_url: s.frame === "slide_type" ? null : s.image_url ?? null,
    subject_boxes: s.subject_boxes ?? null,
    palette: brand.palette,
    font_id: isFontId(s.font_id) ? s.font_id : brand.fontId,
    brand_name: brand.name,
    ...frameLogo(brand),
  }, FEED_CANVAS)
}
