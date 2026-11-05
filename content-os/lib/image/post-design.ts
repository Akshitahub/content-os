import type { BrandRow } from "@/types/database"
import { resolveBrandPalette } from "@/lib/design/color-themes"
import { resolveTypography } from "@/lib/design/fonts"
import { FEED_CANVAS, STORY_CANVAS, renderFrame, type FrameCanvas, type PostFrame } from "@/lib/image/story-frame-compositor"
import { POST_DESIGN_TEMPLATES, clampPostDesign, postDesignFor, type PostDesign, type PostDesignFields } from "@/lib/design/post-design-fields"
import { uploadMediaToStorage } from "@/lib/storage/upload-media"
import type { SubjectBox } from "@/lib/image/subject-boxes"
import { frameLogo } from "@/lib/design/logo-settings"

/**
 * A feed post in the story frame language (lib/image/story-frame-compositor.ts):
 * the clean base photo stays stored (re-editable, never re-generated) and the
 * designed post -- 1-4 display words, a script line, the
 * brand's mark and colours -- is rendered from it. Used by the post render
 * route (Full Post preview, calendar re-edit), Autopilot and the daily draft.
 * The brand's palette, heading font, logo and name always come from the
 * brand row, never the client.
 */

const FRAME_FOR: Record<(typeof POST_DESIGN_TEMPLATES)[number], PostFrame> = {
  bold_statement: "post_bold",
  product_focus: "post_product",
  quote_card: "post_quote",
  minimal: "post_minimal",
  listicle_cover: "post_listicle",
  festive_poster: "post_festive",
  review_card: "post_review",
}

const SQUARE_CANVAS: FrameCanvas = { w: 1080, h: 1080, safeTop: 80, safeBottom: 80, side: 72 }

export function canvasForAspect(aspect: "4:5" | "1:1" | "9:16" | null | undefined): FrameCanvas {
  return aspect === "1:1" ? SQUARE_CANVAS : aspect === "9:16" ? STORY_CANVAS : FEED_CANVAS
}

/** The designed post as a JPEG. Throws only if the canvas itself can't be drawn. */
export async function renderPostDesign(
  brand: Pick<BrandRow, "name" | "logo_url" | "primary_color" | "color_palette" | "brand_brain" | "vibe"> & Partial<BrandRow>,
  baseImageUrl: string | null,
  design: PostDesign,
  aspect?: "4:5" | "1:1" | "9:16" | null,
  /** The photo's subject boxes when already known (lib/image/subject-boxes.ts); else stored / detected. */
  subjectBoxes?: SubjectBox[] | null,
): Promise<Buffer> {
  const d = clampPostDesign(design)
  return renderFrame({
    frame: FRAME_FOR[d.template],
    big_words: d.big_words,
    script_line: d.script_line,
    badge: d.badge ?? null,
    quote: d.quote ?? null,
    seed: d.seed,
    callouts: d.items ?? null,
    background_image_url: baseImageUrl,
    subject_boxes: subjectBoxes ?? null,
    palette: resolveBrandPalette(brand),
    font_id: resolveTypography(brand as BrandRow).heading,
    brand_name: brand.name,
    ...frameLogo(brand),
  }, canvasForAspect(aspect))
}

// The designs themselves (pure, client-safe) live in lib/design/post-design-fields.ts.
export { candidatePostDesigns, postDesignFor, type PostDesignFields } from "@/lib/design/post-design-fields"

/** Hosts a rendered post. Null (logged) on failure. */
export async function uploadDesignedPost(brand: Pick<BrandRow, "id">, jpg: Buffer, label: string): Promise<string | null> {
  const upload = await uploadMediaToStorage({ kind: "buffer", buffer: jpg, mimeType: "image/jpeg" }, `${brand.id}/designed-post-${Date.now()}`, { generatedImage: true })
  if ("error" in upload) {
    console.error(`[post-design] ${label}: upload failed (keeping the clean image):`, upload.error)
    return null
  }
  return upload.publicUrl
}

/**
 * The daily draft: the caption's design drawn on the clean base, uploaded.
 * Null when there are no words or anything fails -- the caller then keeps
 * the clean image as before. Never throws.
 */
export async function designAndUploadPost(
  brand: Parameters<typeof renderPostDesign>[0] & Pick<BrandRow, "id">,
  baseImageUrl: string,
  fields: PostDesignFields,
  label: string,
): Promise<{ imageUrl: string; design: PostDesign } | null> {
  try {
    const design = postDesignFor(fields)
    if (!design) return null
    const imageUrl = await uploadDesignedPost(brand, await renderPostDesign(brand, baseImageUrl, design, "4:5"), label)
    return imageUrl ? { imageUrl, design } : null
  } catch (err) {
    console.error(`[post-design] ${label}: render failed (keeping the clean image):`, err instanceof Error ? err.message : err)
    return null
  }
}
