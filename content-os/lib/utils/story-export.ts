// Real, high-resolution story export -- replaces the old DOM-screenshot
// approach (html-to-image's toPng() capturing the live phone-frame editing
// preview verbatim, rounded corners and all, at only 2x of a 220x390 CSS
// box). Renders server-side via lib/image/story-compositor.ts instead, at
// the real 1080x1920 Instagram Story resolution with no phone-frame chrome
// baked in. Used by both "Save as PNG" and the real Zernio schedule/
// publish path (ScheduleAction.tsx) -- the one thing that actually reaches
// real Instagram stories.

export interface StoryExportSlide {
  type: "hook" | "reveal" | "buildup" | "cta"
  text: string
  subtext: string
  background: string
  text_position: "top" | "center" | "bottom"
  has_poll: boolean
  poll_options?: string[]
  background_image_url?: string | null
  custom_background_colors?: string[] | null
  /** Product/uploaded photo for this specific slide -- an http(s) URL or a
   * data: URL, either works. Only actually rendered on reveal/cta slides
   * (or hook, for a single-slide sequence); safe to always pass, the
   * compositor applies that gating itself. */
  productImageSource?: string | null
  /** Free-drag override for the text block's position -- see
   * StorySlide.text_position_x/y's own comment. Threaded through here so
   * the real server-side render (this file's whole reason to exist)
   * actually reflects a dragged position instead of only the live editor
   * preview. */
  text_position_x?: number
  text_position_y?: number
  /** Whether to actually render productImageSource, already resolved by
   * the caller (StorySequence.tsx's toExportSlide) from
   * StorySlide.show_product_overlay ?? background_image_provider !==
   * "flux" -- the server-side compositor has no idea what provider
   * generated the background, so the default has to be decided
   * client-side before this ever reaches it. */
  show_product_overlay?: boolean
  /** Free-drag override for the product photo overlay's position -- same
   * convention as text_position_x/y, just for the separate image block.
   * See StorySlide.product_position_x/y's own comment. */
  product_position_x?: number
  product_position_y?: number
  /** Exact user-picked hex for the headline/subtext text -- see
   * StorySlide.custom_text_color's own comment. Threaded through here so
   * the real server-side render reflects a custom text color instead of
   * only the live editor preview. */
  custom_text_color?: string | null
  /** Which curated font renders this slide's text -- see
   * StorySlide.font_id's own comment. Threaded through here so the real
   * server-side render reflects the picked font. */
  font_id?: string | null
  /** Uniform font-size multiplier for this slide -- see
   * StorySlide.text_size_scale's own comment. */
  text_size_scale?: number | null
}

/** Returns one data: URL PNG per slide (imageUrls, for the download flow
 * below) plus the same PNGs re-hosted as small public HTTPS URLs
 * (hostedUrls, for ScheduleAction.tsx to send instead of several MB of
 * base64) -- null on any failure. hostedUrls is itself null if the render
 * succeeded but any individual upload failed. */
export async function renderStorySlides(slides: StoryExportSlide[]): Promise<{ imageUrls: string[]; hostedUrls: string[] | null } | null> {
  try {
    const res = await fetch("/api/v1/ai/stories/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slides }),
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

export async function downloadStorySlideAsImage(slide: StoryExportSlide, filename: string): Promise<boolean> {
  const rendered = await renderStorySlides([slide])
  // triggerDownload needs a data: URL to force a same-tab download, so this
  // always uses imageUrls -- never hostedUrls (a real https URL would just
  // navigate the tab there instead of downloading).
  if (!rendered || rendered.imageUrls.length === 0) return false
  triggerDownload(rendered.imageUrls[0]!, `${filename}.png`)
  return true
}

export async function downloadStorySlidesAsImages(slides: StoryExportSlide[], filenamePrefix: string): Promise<boolean> {
  const rendered = await renderStorySlides(slides)
  if (!rendered || rendered.imageUrls.length !== slides.length) return false
  const urls = rendered.imageUrls
  for (let i = 0; i < urls.length; i++) {
    triggerDownload(urls[i]!, `${filenamePrefix}-${i + 1}.png`)
    // Staggered the same way downloadMultipleAsImages (download-as-image.ts)
    // always did -- back-to-back <a download> clicks are unreliable in some
    // browsers otherwise.
    if (i < urls.length - 1) await new Promise<void>((resolve) => setTimeout(resolve, 600))
  }
  return true
}
