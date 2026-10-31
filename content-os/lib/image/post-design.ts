import type { BrandRow } from "@/types/database"
import { resolveBrandPalette } from "@/lib/design/color-themes"
import { resolveTypography } from "@/lib/design/fonts"
import { FEED_CANVAS, STORY_CANVAS, renderFrame, type FrameCanvas, type PostFrame } from "@/lib/image/story-frame-compositor"
import { POST_DESIGN_TEMPLATES, clampPostDesign, initialPostDesign, isPostDesignTemplate, type PostDesign, type PostDesignCaptionFields } from "@/lib/design/post-design-fields"
import { uploadMediaToStorage } from "@/lib/storage/upload-media"
import type { SubjectBox } from "@/lib/image/subject-boxes"

/**
 * A feed post in the story frame language (lib/image/story-frame-compositor.ts):
 * the clean base photo stays stored (re-editable, never re-generated) and the
 * designed post -- 1-4 display words, a script line, tape / sticker, the
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
    tape: d.template !== "minimal",
    background_image_url: baseImageUrl,
    subject_boxes: subjectBoxes ?? null,
    palette: resolveBrandPalette(brand),
    font_id: resolveTypography(brand as BrandRow).heading,
    brand_name: brand.name,
    logo_url: brand.logo_url ?? null,
  }, canvasForAspect(aspect))
}

export interface PostDesignFields extends PostDesignCaptionFields {
  template?: string | null
  hasProduct: boolean
  fallbackWords: (string | null | undefined)[]
}

/**
 * The design for a generated post, or null with no words. Autopilot / the
 * daily draft had no on-image text before: an undesignable template falls
 * back to the post's own look. `template` overrides the caption's pick (an
 * Autopilot candidate in another look).
 */
export function postDesignFor(fields: PostDesignFields, template?: PostDesign["template"], seed?: number): PostDesign | null {
  const picked = template ?? (isPostDesignTemplate(fields.template) ? fields.template : fields.hasProduct ? "product_focus" : "bold_statement")
  const design = initialPostDesign(picked, fields, seed)
  return design ? { ...design, aspect: "4:5" } : null
}

/** Up to `count` designs in different looks -- the caption's pick first. */
export function candidatePostDesigns(fields: PostDesignFields, count: number): PostDesign[] {
  const first = postDesignFor(fields)
  if (!first) return []
  const others = (["bold_statement", "product_focus", "quote_card"] as const).filter((t) => t !== first.template && (t !== "product_focus" || fields.hasProduct))
  return [first, ...others.map((t, i) => postDesignFor(fields, t, first.seed + 7919 * (i + 1))!)].slice(0, Math.max(1, count))
}

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
