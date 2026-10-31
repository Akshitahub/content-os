// Real, high-resolution carousel export -- replaces the old DOM-screenshot
// approach (html-to-image's toPng() capturing the live SlidePreview
// editing preview verbatim, only available while that exact editor page
// is open -- meaning scheduling a carousel later from My Content had
// nothing to screenshot and fell back to the bare, uncomposited AI
// background photo instead). Renders server-side via
// lib/image/carousel-compositor.ts instead, at the real 1080x1350
// resolution. Used by "Save as PNG"/"Download all slides" and the real
// Zernio schedule/publish path alike (both from CarouselBuilder.tsx right
// after generating, and from the Library's ContentDetailPanel) -- the one
// thing that actually reaches real Instagram carousels. Mirrors
// lib/utils/story-export.ts exactly.

import type { TextStyle } from "@/lib/design/text-style"
import type { TextLayoutId } from "@/lib/design/text-layouts"
import type { BrandPalette } from "@/lib/design/color-themes"
import type { CarouselFrame } from "@/lib/design/carousel-frames"

export interface CarouselExportSlide {
  type: "cover" | "content" | "cta"
  headline: string
  subtext?: string | null
  points?: string[] | null
  ctaText?: string | null
  ctaHandle?: string | null
  background_style?: string | null
  image_url?: string | null
  custom_background_colors?: string[] | null
  text_position_x?: number | null
  text_position_y?: number | null
  /** Product/uploaded photo for this specific slide -- an http(s) URL or a
   * data: URL, either works. */
  productImageSource?: string | null
  /** Which curated font renders this slide's text -- see
   * CarouselSlideRich.font_id's own comment. */
  font_id?: string | null
  /** The brand's body font -- see the compositor's body_font_id. */
  body_font_id?: string | null
  /** How to draw text over image_url -- see the compositor's text_style. */
  text_style?: TextStyle | null
  /** Content-matched layout + extras (lib/design/text-layouts.ts); absent = the original layout. */
  text_layout?: TextLayoutId | null
  kicker?: string | null
  highlight?: string | null
  accent_color?: string | null
  /** The brand's 4-role palette (lib/design/color-themes.ts) -- see the compositor's palette. */
  palette?: BrandPalette | null
  /** Uniform font-size multiplier for this slide -- see
   * CarouselSlideRich.text_size_scale's own comment. */
  text_size_scale?: number | null
  /** A framed slide (lib/design/carousel-frames.ts) -- drawn by the story
   * frame compositor; absent = the original compositor. */
  frame?: CarouselFrame | null
  seed?: number | null
  tape?: boolean | null
  brand_mark?: boolean | null
}

/** The frame fields of a saved slide, for an export. */
export function exportFrameFields(s: { frame?: unknown; seed?: unknown; tape?: unknown; brand_mark?: unknown }): Pick<CarouselExportSlide, "frame" | "seed" | "tape" | "brand_mark"> {
  return {
    frame: s.frame === "hook" || s.frame === "slide_photo" || s.frame === "slide_type" || s.frame === "cta" ? s.frame : null,
    seed: typeof s.seed === "number" ? s.seed : null,
    tape: typeof s.tape === "boolean" ? s.tape : null,
    brand_mark: typeof s.brand_mark === "boolean" ? s.brand_mark : null,
  }
}

/** Returns one data: URL PNG per slide (imageUrls, for the download flow
 * below) plus the same PNGs re-hosted as small public HTTPS URLs
 * (hostedUrls, for ScheduleAction.tsx to send instead of several MB of
 * base64) -- null on any failure. hostedUrls is itself null if the render
 * succeeded but any individual upload failed. */
export async function renderCarouselSlides(brandName: string, slides: CarouselExportSlide[], brandId?: string, opts: { preview?: boolean } = {}): Promise<{ imageUrls: string[]; hostedUrls: string[] | null } | null> {
  try {
    const res = await fetch("/api/v1/ai/carousel/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // brandId: framed slides draw the brand's logo and heading font from its row.
      body: JSON.stringify({ brandName, slides, ...(brandId ? { brandId } : {}), ...(opts.preview ? { preview: true } : {}) }),
    })
    if (!res.ok) return null
    const json = await res.json() as { data?: { imageUrls?: string[]; hostedUrls?: string[] | null } }
    if (!json.data?.imageUrls) return null
    return { imageUrls: json.data.imageUrls, hostedUrls: json.data.hostedUrls ?? null }
  } catch {
    return null
  }
}

/** Framed slides come back as JPEGs, the rest as PNGs. */
const extOf = (dataUrl: string) => (dataUrl.startsWith("data:image/jpeg") ? "jpg" : "png")

function triggerDownload(dataUrl: string, filename: string) {
  const link = document.createElement("a")
  link.download = `${filename}.${extOf(dataUrl)}`
  link.href = dataUrl
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export async function downloadCarouselSlideAsImage(brandName: string, slide: CarouselExportSlide, filename: string, brandId?: string): Promise<boolean> {
  const rendered = await renderCarouselSlides(brandName, [slide], brandId)
  // triggerDownload needs a data: URL to force a same-tab download, so this
  // always uses imageUrls -- never hostedUrls (a real https URL would just
  // navigate the tab there instead of downloading).
  if (!rendered || rendered.imageUrls.length === 0) return false
  triggerDownload(rendered.imageUrls[0]!, filename)
  return true
}

export async function downloadCarouselSlidesAsImages(brandName: string, slides: CarouselExportSlide[], filenamePrefix: string, brandId?: string): Promise<boolean> {
  const rendered = await renderCarouselSlides(brandName, slides, brandId)
  if (!rendered || rendered.imageUrls.length !== slides.length) return false
  const urls = rendered.imageUrls
  for (let i = 0; i < urls.length; i++) {
    triggerDownload(urls[i]!, `${filenamePrefix}-${i + 1}`)
    // Staggered the same way story-export.ts's downloadStorySlidesAsImages
    // is -- back-to-back <a download> clicks are unreliable in some
    // browsers otherwise.
    if (i < urls.length - 1) await new Promise<void>((resolve) => setTimeout(resolve, 600))
  }
  return true
}

/** One-file alternative to downloadCarouselSlidesAsImages above -- same
 * server-rendered slide images (renderCarouselSlides), just paginated into
 * a single PDF instead of triggering one <a download> per slide. jsPDF is
 * imported dynamically so it never lands in the main bundle for users who
 * never export a PDF. */
export async function downloadCarouselSlidesAsPdf(brandName: string, slides: CarouselExportSlide[], filename: string, brandId?: string): Promise<boolean> {
  const rendered = await renderCarouselSlides(brandName, slides, brandId)
  if (!rendered || rendered.imageUrls.length !== slides.length) return false
  const { jsPDF } = await import("jspdf")
  const doc = new jsPDF({ orientation: "portrait", unit: "px", format: [1080, 1350] })
  rendered.imageUrls.forEach((dataUrl, i) => {
    if (i > 0) doc.addPage([1080, 1350], "portrait")
    doc.addImage(dataUrl, extOf(dataUrl) === "jpg" ? "JPEG" : "PNG", 0, 0, 1080, 1350)
  })
  doc.save(`${filename}.pdf`)
  return true
}
