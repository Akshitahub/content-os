// Browser-only (DOM canvas) -- import from client components only.
import type { FontId } from "@/lib/design/fonts"
import { PREVIEW_FONT_FAMILY } from "@/lib/design/preview-fonts"
import { BACKING_OPACITY, type TextStyle } from "@/lib/design/text-style"
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

// Shared word-wrap: greedily packs words onto lines up to maxWidth and
// returns EVERY line -- it used to stop at maxLines and silently drop the
// rest of the headline. ctx.font must already be set by the caller.
function wrapTextLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ""
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur)
      cur = word
    } else {
      cur = test
    }
  }
  if (cur) lines.push(cur)
  return lines
}

// Headline budget: 3 lines, stepping the size down to a 24px-at-1080 floor
// before going past it (then every line is kept anyway).
const OVERLAY_MAX_LINES = 3

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
  fontId?: FontId,
  /** From the post-image response (lib/design/text-style.ts): scrim strength
   * and backing panel for this image. Omitted = the fixed bottom scrim. */
  textStyle?: TextStyle | null
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
  // With a text_style (white text, so measured with preferLight) the scrim
  // is as strong as this photo needs at the text.
  const { top: scrimTopRatio, mid, end } = overlayScrimStops(textStyle)
  const scrimTop = h * scrimTopRatio
  const grad = ctx.createLinearGradient(0, scrimTop, 0, h)
  grad.addColorStop(0, "rgba(0,0,0,0)")
  grad.addColorStop(0.35, `rgba(0,0,0,${mid})`)
  grad.addColorStop(1, `rgba(0,0,0,${end})`)
  ctx.fillStyle = grad
  ctx.fillRect(0, scrimTop, w, h - scrimTop)

  ctx.textAlign = "left"
  ctx.textBaseline = "alphabetic"
  const fontFor = (size: number) => {
    if (!fontId) return `700 ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
    const { family, weight } = PREVIEW_FONT_FAMILY[fontId]
    return `${weight} ${size}px ${family}, sans-serif`
  }
  if (fontId) {
    // A canvas draws with whatever is loaded right now -- wait for the face
    // so the first export isn't silently in the fallback font.
    try { await document.fonts.load(fontFor(Math.round(w * 0.062)), trimmed) } catch { /* draw with the fallback */ }
  }
  // Inside the 6% safe edge on both sides.
  const padX = w * 0.07
  const floor = Math.max(12, Math.round(w * (24 / 1080)))
  let fontSize = Math.round(w * 0.062)
  ctx.font = fontFor(fontSize)
  let lines = wrapTextLines(ctx, trimmed, w - padX * 2)
  while (lines.length > OVERLAY_MAX_LINES && fontSize > floor) {
    fontSize = Math.max(floor, Math.round(fontSize * 0.92))
    ctx.font = fontFor(fontSize)
    lines = wrapTextLines(ctx, trimmed, w - padX * 2)
  }
  const lineH = fontSize * 1.18
  // The last line sits 9% above the bottom; more lines grow upward, never
  // past the 6% top edge.
  const startY = Math.max(h * 0.06 + fontSize, h - h * 0.09 - (lines.length - 1) * lineH)

  if (textStyle?.needs_backing) {
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width))
    const pad = fontSize * 0.5
    ctx.fillStyle = `rgba(0,0,0,${BACKING_OPACITY})`
    ctx.beginPath()
    ctx.roundRect(padX - pad, startY - fontSize - pad * 0.6, widest + pad * 2, (lines.length - 1) * lineH + fontSize * 1.3 + pad * 1.2, fontSize * 0.35)
    ctx.fill()
  }

  ctx.fillStyle = "#ffffff"
  lines.forEach((line, i) => ctx.fillText(line, padX, startY + i * lineH))

  return encode(canvas)
}

/** The bottom scrim's gradient (shared with FullPostGenerator's live preview
 * so preview = export): the fixed 0.55 / 0.65 band without a text_style. */
export function overlayScrimStops(textStyle?: TextStyle | null): { top: number; mid: number; end: number } {
  if (!textStyle) return { top: 0.62, mid: 0.55, end: 0.65 }
  const strength = Math.max(0.25, textStyle.scrim_opacity)
  return { top: 0.62, mid: strength, end: Math.min(0.85, strength + 0.1) }
}
