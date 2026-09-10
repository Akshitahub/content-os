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
  /** Uniform font-size multiplier for this slide -- see
   * CarouselSlideRich.text_size_scale's own comment. */
  text_size_scale?: number | null
}

/** Returns one data: URL PNG per slide (imageUrls, for the download flow
 * below) plus the same PNGs re-hosted as small public HTTPS URLs
 * (hostedUrls, for ScheduleAction.tsx to send instead of several MB of
 * base64) -- null on any failure. hostedUrls is itself null if the render
 * succeeded but any individual upload failed. */
export async function renderCarouselSlides(brandName: string, slides: CarouselExportSlide[]): Promise<{ imageUrls: string[]; hostedUrls: string[] | null } | null> {
  try {
    const res = await fetch("/api/v1/ai/carousel/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brandName, slides }),
    })
    if (!res.ok) return null
    const json = await res.json() as { data?: { imageUrls?: string[]; hostedUrls?: string[] | null } }
    if (!json.data?.imageUrls) return null
    return { imageUrls: json.data.imageUrls, hostedUrls: json.data.hostedUrls ?? null }
  } catch {
    return null
  }
}

function triggerDownload(dataUrl: string, filename: string) {
  const link = document.createElement("a")
  link.download = filename
  link.href = dataUrl
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export async function downloadCarouselSlideAsImage(brandName: string, slide: CarouselExportSlide, filename: string): Promise<boolean> {
  const rendered = await renderCarouselSlides(brandName, [slide])
  // triggerDownload needs a data: URL to force a same-tab download, so this
  // always uses imageUrls -- never hostedUrls (a real https URL would just
  // navigate the tab there instead of downloading).
  if (!rendered || rendered.imageUrls.length === 0) return false
  triggerDownload(rendered.imageUrls[0]!, `${filename}.png`)
  return true
}

export async function downloadCarouselSlidesAsImages(brandName: string, slides: CarouselExportSlide[], filenamePrefix: string): Promise<boolean> {
  const rendered = await renderCarouselSlides(brandName, slides)
  if (!rendered || rendered.imageUrls.length !== slides.length) return false
  const urls = rendered.imageUrls
  for (let i = 0; i < urls.length; i++) {
    triggerDownload(urls[i]!, `${filenamePrefix}-${i + 1}.png`)
    // Staggered the same way story-export.ts's downloadStorySlidesAsImages
    // is -- back-to-back <a download> clicks are unreliable in some
    // browsers otherwise.
    if (i < urls.length - 1) await new Promise<void>((resolve) => setTimeout(resolve, 600))
  }
  return true
}
