import { z } from "zod"

/**
 * How text should be drawn over one generated background, computed ONCE
 * from the image where it's generated (lib/image/text-contrast.ts) and
 * stored next to its image_url. Every renderer -- the three server
 * compositors, the builder previews, the FullPost overlay export and Ad
 * Maker's canvas -- draws from the same values, so preview = export.
 * Absent (content from before this existed) = each renderer's old fixed
 * white-text gradient scrim.
 */
export interface TextStyle {
  text_color: "light" | "dark"
  /** Uniform scrim over the whole image: black under light text, white under dark. */
  scrim_opacity: number
  /** Busy region (or a scrim past the cap): also draw a soft panel behind the text block. */
  needs_backing: boolean
}

export const textStyleSchema = z.object({
  text_color: z.enum(["light", "dark"]),
  scrim_opacity: z.number().min(0).max(0.75),
  needs_backing: z.boolean(),
})

export function isTextStyle(value: unknown): value is TextStyle {
  return textStyleSchema.safeParse(value).success
}

/** Where the text sits, as fractions of the image (0-1). */
export interface TextRegion {
  x: number
  y: number
  w: number
  h: number
}

export const TEXT_STYLE_PALETTE = {
  light: { text: "#ffffff", sub: "rgba(255,255,255,0.85)", scrimRgb: "0,0,0", backingRgb: "0,0,0" },
  dark: { text: "#111827", sub: "rgba(17,24,39,0.85)", scrimRgb: "255,255,255", backingRgb: "255,255,255" },
} as const

// Strong enough to carry the text on its own when the region is busy.
export const BACKING_OPACITY = 0.55

export function scrimRgba(style: TextStyle): string {
  return `rgba(${TEXT_STYLE_PALETTE[style.text_color].scrimRgb},${style.scrim_opacity})`
}

export function backingRgba(style: TextStyle): string {
  return `rgba(${TEXT_STYLE_PALETTE[style.text_color].backingRgb},${BACKING_OPACITY})`
}

// ─── Text regions per format ────────────────────────────────────────────────

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

function centeredRegion(cx: number, cy: number, w: number, h: number): TextRegion {
  const x = clamp01(cx - w / 2)
  const y = clamp01(cy - h / 2)
  return { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) }
}

/** Carousel (4:5): the block is centered on text_position_x/y (default dead center). */
export function carouselTextRegion(pos?: { x?: number | null; y?: number | null }): TextRegion {
  return centeredRegion((pos?.x ?? 50) / 100, (pos?.y ?? 50) / 100, 0.8, 0.4)
}

/** Story (9:16): matches story-compositor's defaultTextCenter for each text_position. */
export function storyTextRegion(position?: "top" | "center" | "bottom" | null): TextRegion {
  const cy = position === "top" ? 0.23 : position === "bottom" ? 0.77 : 0.5
  return centeredRegion(0.5, cy, 0.84, 0.3)
}

/** Ad Maker (1:1): compositeAd puts the text block in the top, middle or bottom third. */
export function adTextRegion(position?: "top" | "center" | "bottom" | null): TextRegion {
  const cy = position === "top" ? 0.2 : position === "bottom" ? 0.8 : 0.5
  return centeredRegion(0.5, cy, 0.86, 0.3)
}

/** Post (4:5): each template's text zone; no caption = the FullPost bottom-third overlay. */
export function postTextRegion(template: string | null | undefined, hasCaption: boolean): TextRegion {
  if (!hasCaption || template === "blank") return { x: 0.07, y: 0.62, w: 0.86, h: 0.32 }
  if (template === "quote_card") return { x: 0.08, y: 0.3, w: 0.84, h: 0.4 }
  if (template === "product_focus") return { x: 0.06, y: 0.56, w: 0.88, h: 0.18 }
  if (template === "minimal") return { x: 0.06, y: 0.8, w: 0.88, h: 0.18 }
  // bold_statement
  return { x: 0.05, y: 0.55, w: 0.9, h: 0.3 }
}
