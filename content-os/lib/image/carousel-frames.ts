import type { BrandPalette } from "@/lib/design/color-themes"
import { isFontId, type FontId } from "@/lib/design/fonts"
import sharp from "sharp"
import { FEED_CANVAS, renderFrame, renderFrameLayers, type FrameKind, type StoryFrameSlide } from "@/lib/image/story-frame-compositor"
import { hasLayoutRun, type CarouselFrame, type CarouselLayout } from "@/lib/design/carousel-frames"
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
  /** The planned layout (lib/design/carousel-frames.ts carouselLayoutFor). */
  layout_hint?: CarouselLayout | null
  /** The photo's subject boxes when already known; else stored / detected at render. */
  subject_boxes?: SubjectBox[] | null
  /** A listicle item's position (lib/design/carousel-frames.ts) -- its numeral on a type-led slide. */
  list_index?: number | null
  /** A type-led slide with no photo of its own: the product photo, shown as a detail. */
  detail_image_url?: string | null
}

const KIND: Record<CarouselFrame, FrameKind> = { hook: "hook", slide_photo: "slide_photo", slide_type: "slide_type", cta: "cta" }

/** A slide as the frame compositor takes it. */
function toFrame(s: CarouselFrameSlide, brand: { name: string; palette: BrandPalette; fontId: FontId } & Partial<FrameLogo>): StoryFrameSlide {
  const handwritten = s.frame === "hook" || s.frame === "cta"
  return {
    frame: KIND[s.frame],
    big_words: s.headline,
    script_line: handwritten ? s.subtext ?? null : null,
    body: handwritten ? null : s.subtext ?? null,
    cta_label: s.frame === "cta" ? s.cta ?? null : null,
    seed: s.seed ?? 1,
    brand_mark: !!s.brand_mark,
    background_image_url: s.image_url ?? null,
    subject_boxes: s.subject_boxes ?? null,
    layout_hint: s.layout_hint ?? null,
    list_index: s.list_index ?? null,
    detail_image_url: s.detail_image_url ?? null,
    palette: brand.palette,
    font_id: isFontId(s.font_id) ? s.font_id : brand.fontId,
    brand_name: brand.name,
    ...frameLogo(brand),
  }
}

/** The slide as a JPEG. Throws only if the canvas itself can't be drawn. */
export function renderCarouselFrame(
  s: CarouselFrameSlide,
  brand: { name: string; logo_url?: string | null; palette: BrandPalette; fontId: FontId } & Partial<FrameLogo>,
): Promise<Buffer> {
  return renderFrame(toFrame(s, brand), FEED_CANVAS)
}

/** One type scale for a carousel's headlines (px on the 1080-wide feed canvas). */
export const CAROUSEL_HEADLINE_PX = 118

/**
 * A whole carousel in one system: the same margins and type scale, the
 * logo in one spot (the brand's chosen corner, else bottom-left when it's
 * free), a "2/5" counter on every slide, a subtle swipe cue on the cover,
 * and the layout rhythm checked -- if a fallback ever leaves the same
 * layout three slides in a row, the middle one is redrawn type-led.
 */
export async function renderCarouselFrames(
  slides: CarouselFrameSlide[],
  brand: { name: string; logo_url?: string | null; palette: BrandPalette; fontId: FontId } & Partial<FrameLogo>,
): Promise<{ jpg: Buffer; layout: string; labels: string[] }[]> {
  const n = slides.length
  const logo = frameLogo(brand)
  const spot = logo.logo_position === "auto" ? "bottom-left" : logo.logo_position
  const draw = async (s: CarouselFrameSlide, i: number) => {
    // A photo-led middle slide whose photo couldn't be made (a failed or
    // refused generation) is type-led -- never a bare gradient.
    const slide: CarouselFrameSlide = s.frame === "slide_photo" && !s.image_url ? { ...s, frame: "slide_type", layout_hint: "type" } : s
    const frame: StoryFrameSlide = {
      ...toFrame(slide, brand),
      logo_position: spot,
      type_scale: CAROUSEL_HEADLINE_PX,
      counter: n > 1 ? `${i + 1}/${n}` : null,
      swipe_cue: n > 1 && i === 0,
    }
    const layers = await renderFrameLayers(frame, FEED_CANVAS)
    const jpg = await sharp(layers.base).composite([{ input: layers.overlay, top: 0, left: 0 }]).jpeg({ quality: 90, mozjpeg: true }).toBuffer()
    return { jpg, layout: layers.layout === "free" || layers.layout === "full" || layers.layout === "cutout" ? "full" : layers.layout === "band" ? "split" : layers.layout, labels: layers.labels }
  }
  const out = await Promise.all(slides.map((s, i) => draw(s, i)))
  for (let i = 2; i < n; i++) {
    if (hasLayoutRun(out.slice(i - 2, i + 1).map((o) => o.layout))) {
      const mid = slides[i - 1]!
      if (mid.frame === "hook" || mid.frame === "cta") continue
      // Three type slides: the middle one goes split when it has a photo
      // to show; otherwise (nothing to show) it stays as it is.
      if (out[i]!.layout === "type") {
        if (mid.image_url) out[i - 1] = await draw({ ...mid, frame: "slide_photo", layout_hint: "split" }, i - 1)
        continue
      }
      out[i - 1] = await draw({ ...mid, frame: "slide_type", layout_hint: "type" }, i - 1)
    }
  }
  return out
}
