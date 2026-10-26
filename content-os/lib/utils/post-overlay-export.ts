// Browser-only (DOM canvas) -- import from client components only.
import type { FontId } from "@/lib/design/fonts"
import { PREVIEW_FONT_FAMILY } from "@/lib/design/preview-fonts"
//
// The Post tool's client-side text overlay: flattens the clean, text-free
// AI background + the user's editable headline into one PNG. Moved here
// verbatim from components/generate/FullPostGenerator.tsx so the calendar's
// "Edit text on image" action (components/calendar/CalendarEntryPanel.tsx)
// re-renders a scheduled post byte-for-byte the same way Create -> Full
// Post did -- never a second, drifting implementation.

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

// Shared word-wrap: greedily packs words onto lines up to maxWidth,
// stopping once maxLines is hit (the last line keeps whatever didn't fit,
// never ellipsized). ctx.font must already be set by the caller before
// calling this.
function wrapTextLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(" ")
  const lines: string[] = []
  let cur = ""
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word
    if (ctx.measureText(test).width > maxWidth) {
      if (cur) lines.push(cur)
      cur = word
      if (lines.length >= maxLines) break
    } else {
      cur = test
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur)
  return lines
}

/**
 * Flattens the clean AI-generated background + the client-editable headline
 * overlay into a single downloadable/shareable PNG — the client-side
 * "compositing" step the Post tool's architecture calls for, run only when
 * the user actually wants an exported file (Download / Schedule), not on
 * every keystroke while editing. No credits are spent here: this never
 * calls generatePostImageMutate, it only draws on a canvas from an image
 * already sitting in the browser.
 */
export async function flattenOverlayImage(
  imageUrl: string,
  headlineText: string,
  /** PNG by default (Create -> Full Post, unchanged). The calendar's
   * re-edit sends JPEG instead: a PNG of a photo this size can approach
   * the platform's request-body limit once base64-encoded. */
  output: { type: "image/png" } | { type: "image/jpeg"; quality: number } = { type: "image/png" },
  /** The headline's typeface (the Post's suggested_font_id, or the user's
   * pick). Omitted = the system bold sans this always used, so entries
   * scheduled before fonts existed re-render unchanged. */
  fontId?: FontId
): Promise<string> {
  const encode = (c: HTMLCanvasElement) => (output.type === "image/jpeg" ? c.toDataURL("image/jpeg", output.quality) : c.toDataURL("image/png"))
  const img = await loadImage(imageUrl)
  const canvas = document.createElement("canvas")
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(img, 0, 0)

  const trimmed = headlineText.trim()
  if (!trimmed) return encode(canvas)

  const w = canvas.width
  const h = canvas.height
  // Bottom-third scrim, same visual language as the server-side templates
  // (a darkened band behind the headline) but drawn fresh here rather than
  // ported pixel-for-pixel from post-compositor.ts's SVG anchors — this is
  // a genuinely separate rendering surface (HTML/canvas, not SVG), not a
  // port of those exact coordinates.
  const scrimTop = h * 0.62
  const grad = ctx.createLinearGradient(0, scrimTop, 0, h)
  grad.addColorStop(0, "rgba(0,0,0,0)")
  grad.addColorStop(0.35, "rgba(0,0,0,0.55)")
  grad.addColorStop(1, "rgba(0,0,0,0.65)")
  ctx.fillStyle = grad
  ctx.fillRect(0, scrimTop, w, h - scrimTop)

  ctx.fillStyle = "#ffffff"
  ctx.textAlign = "left"
  ctx.textBaseline = "alphabetic"
  const fontSize = Math.round(w * 0.062)
  let fontSpec = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
  if (fontId) {
    const { family, weight } = PREVIEW_FONT_FAMILY[fontId]
    fontSpec = `${weight} ${fontSize}px ${family}, sans-serif`
    // A canvas draws with whatever is loaded right now -- wait for the face
    // so the first export isn't silently in the fallback font.
    try { await document.fonts.load(fontSpec, trimmed) } catch { /* draw with the fallback */ }
  }
  ctx.font = fontSpec
  const padX = w * 0.07
  const lines = wrapTextLines(ctx, trimmed, w - padX * 2, 3)
  const lineH = fontSize * 1.18
  const startY = h - h * 0.09 - (lines.length - 1) * lineH
  lines.forEach((line, i) => ctx.fillText(line, padX, startY + i * lineH))

  return encode(canvas)
}
