import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import sharp from "sharp"
import { Resvg } from "@resvg/resvg-js"
import { decompress } from "wawoff2"

// Real Instagram Story canvas — confirmed against Meta's own Stories spec
// (1080x1920, 9:16) and already documented as the intended target in
// components/generate/StorySequence.tsx's STORY_SAFE_ZONE_PX comment. Not
// the same as Carousel/Post's 1080x1080/1080x1350 canvases — stories are a
// distinct, taller format.
const CANVAS_WIDTH = 1080
const CANVAS_HEIGHT = 1920

// Instagram's own Stories UI overlays the top (profile/username) and
// bottom (reply bar, link stickers) of the real canvas — text needs to
// stay clear of the outer ~250px on each side, independent of
// text_position (which only controls alignment within this already-safe
// interior). Matches StorySequence.tsx's live-preview math exactly
// (250/1920 of total height).
const SAFE_ZONE = 250

// Same cached-TTF pattern as lib/image/carousel-compositor.ts — resvg-js's
// font loader only accepts raw TrueType, not the woff2 @fontsource ships,
// so it's decompressed once and cached in /tmp across warm serverless
// invocations. Reuses Anton (no new font family), same as every other
// compositor in this codebase.
let cachedFontPath: string | null = null

async function getFontPath(): Promise<string> {
  if (cachedFontPath && existsSync(cachedFontPath)) return cachedFontPath

  const woff2Path = join(process.cwd(), "node_modules/@fontsource/anton/files/anton-latin-400-normal.woff2")
  const ttfBuffer = await decompress(readFileSync(woff2Path))

  const ttfPath = join(tmpdir(), "story-compositor-anton.ttf")
  writeFileSync(ttfPath, ttfBuffer)
  cachedFontPath = ttfPath
  return ttfPath
}

async function svgToPngBuffer(svg: string): Promise<Buffer> {
  const fontPath = await getFontPath()
  const resvg = new Resvg(svg, {
    font: { fontFiles: [fontPath], loadSystemFonts: false, defaultFontFamily: "StoryFont" },
  })
  return Buffer.from(resvg.render().asPng())
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function wrapText(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines.slice(0, maxLines)
}

function textLines(lines: string[], startY: number, lineHeight: number, fontSize: number, color: string, weight: number, xAttr: string): string {
  return lines
    .map((line, i) => `<text x="${xAttr}" y="${startY + i * lineHeight}" text-anchor="middle" font-family="StoryFont, sans-serif" font-weight="${weight}" font-size="${fontSize}" fill="${color}">${escapeXml(line)}</text>`)
    .join("")
}

// Mirrors StorySequence.tsx's PhoneStory.defaultStoryTextPosition exactly
// (same SAFE_ZONE ratio, same +4/+6 inward nudge) -- a slide that's never
// been dragged (no text_position_x/y) should render at the same spot the
// live editor preview already showed it, not jump once it's actually
// exported/published.
function defaultTextCenter(pos: StoryCompositeSlide["text_position"]): { x: number; y: number } {
  const safeZonePct = (SAFE_ZONE / CANVAS_HEIGHT) * 100
  const minY = safeZonePct + 4
  const maxY = 100 - safeZonePct - 4
  if (pos === "top") return { x: 50, y: minY + 6 }
  if (pos === "bottom") return { x: 50, y: maxY - 6 }
  return { x: 50, y: 50 }
}

// ─── Backgrounds ────────────────────────────────────────────────────────────

// Mirrors STORY_BG in components/generate/StorySequence.tsx exactly — same
// 8 named presets, same top-to-bottom gradient direction
// (Tailwind's bg-gradient-to-b), real hex stops for the Tailwind shades
// that CSS used as classes. Text colors match each preset's `text`/`sub`
// pairing there too ("white" is the one preset with dark text on a light
// background; every other preset is white text at varying opacity).
const STORY_BG_PRESETS: Record<string, { stops: [string, string, string]; text: string; sub: string }> = {
  gradient_violet: { stops: ["#7c3aed", "#9333ea", "#4338ca"], text: "#ffffff", sub: "rgba(255,255,255,0.7)" },
  gradient_pink: { stops: ["#ec4899", "#f43f5e", "#ef4444"], text: "#ffffff", sub: "rgba(255,255,255,0.7)" },
  gradient_dark: { stops: ["#111827", "#1f2937", "#000000"], text: "#ffffff", sub: "rgba(255,255,255,0.6)" },
  gradient_warm: { stops: ["#fbbf24", "#f97316", "#dc2626"], text: "#ffffff", sub: "rgba(255,255,255,0.7)" },
  white: { stops: ["#ffffff", "#ffffff", "#ffffff"], text: "#111827", sub: "#6b7280" },
  vibe_fun_playful: { stops: ["#fb923c", "#facc15", "#2dd4bf"], text: "#ffffff", sub: "rgba(255,255,255,0.7)" },
  vibe_professional: { stops: ["#1e3a8a", "#1e293b", "#111827"], text: "#ffffff", sub: "rgba(255,255,255,0.7)" },
  vibe_trendy_genz: { stops: ["#8b5cf6", "#d946ef", "#22d3ee"], text: "#ffffff", sub: "rgba(255,255,255,0.8)" },
}
const DEFAULT_PRESET = "gradient_violet"

// Dark scrim so text stays readable over a photo or custom color/gradient
// background — mirrors the live preview's exact
// `bg-gradient-to-t from-black/75 via-black/25 to-black/45` (bottom
// darkest, lighter in the middle, medium at the top). Named presets never
// get this — they're already curated for contrast, same as the preview.
const SCRIM_SVG = `<defs><linearGradient id="scrim" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="#000000" stop-opacity="0.75"/><stop offset="50%" stop-color="#000000" stop-opacity="0.25"/><stop offset="100%" stop-color="#000000" stop-opacity="0.45"/></linearGradient></defs><rect width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="url(#scrim)"/>`

// cssBackgroundFromColors' server-side equivalent (components/shared/
// ColorWheelPicker.tsx): 1 hex = solid fill, 2 = a diagonal gradient. Same
// diagonal (x1=0,y1=0 -> x2=1,y2=1) carousel-compositor.ts already uses
// for its own gradient, standing in for CSS's `135deg`.
function customBackgroundFill(colors: string[]): string {
  if (colors.length === 1) return `<rect width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="${colors[0]}"/>`
  return `<defs><linearGradient id="custom" x1="0" y1="0" x2="1" y2="1">${colors
    .map((c, i) => `<stop offset="${(i / (colors.length - 1)) * 100}%" stop-color="${c}"/>`)
    .join("")}</linearGradient></defs><rect width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="url(#custom)"/>`
}

async function fetchImageBuffer(source: string): Promise<Buffer | null> {
  try {
    if (source.startsWith("data:")) {
      const base64 = source.split(",")[1]
      return base64 ? Buffer.from(base64, "base64") : null
    }
    const res = await fetch(source)
    if (!res.ok) return null
    return Buffer.from(await res.arrayBuffer())
  } catch {
    return null
  }
}

/** Priority matches the live preview exactly: an AI/uploaded photo
 * (background_image_url) beats a custom color/gradient, which beats the
 * named preset. Photo and custom-color both get the dark scrim; presets
 * never do. */
async function buildBackgroundLayer(slide: StoryCompositeSlide): Promise<{ buffer: Buffer; textColor: string; subColor: string }> {
  const preset = STORY_BG_PRESETS[slide.background] ?? STORY_BG_PRESETS[DEFAULT_PRESET]!
  const customColors = (slide.custom_background_colors ?? []).filter(Boolean)

  if (slide.background_image_url) {
    const photo = await fetchImageBuffer(slide.background_image_url)
    if (photo) {
      const base = await sharp(photo).resize(CANVAS_WIDTH, CANVAS_HEIGHT, { fit: "cover" }).png().toBuffer()
      const scrimPng = await svgToPngBuffer(`<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">${SCRIM_SVG}</svg>`)
      const buffer = await sharp(base).composite([{ input: scrimPng, top: 0, left: 0 }]).png().toBuffer()
      return { buffer, textColor: "#ffffff", subColor: "rgba(255,255,255,0.7)" }
    }
    // Photo failed to fetch — fall through to custom color / preset below
    // rather than leaving the slide with no background at all.
  }

  if (customColors.length > 0) {
    const svg = `<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">${customBackgroundFill(customColors)}${SCRIM_SVG}</svg>`
    const buffer = await svgToPngBuffer(svg)
    return { buffer, textColor: "#ffffff", subColor: "rgba(255,255,255,0.7)" }
  }

  const [c1, c2, c3] = preset.stops
  const svg = `<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="preset" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${c1}"/><stop offset="50%" stop-color="${c2}"/><stop offset="100%" stop-color="${c3}"/></linearGradient></defs><rect width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="url(#preset)"/></svg>`
  const buffer = await svgToPngBuffer(svg)
  return { buffer, textColor: preset.text, subColor: preset.sub }
}

// Same gating StorySequence.tsx's live preview uses: buildStoryTypeSequence
// only produces a "reveal" slide when storyCount >= 3, so a single-slide
// sequence ("hook" only) falls back to showing the product photo there
// instead — otherwise it would never appear at all.
function shouldShowProductImage(type: StoryCompositeSlide["type"], total: number): boolean {
  return type === "reveal" || type === "cta" || (total === 1 && type === "hook")
}

// Matches PhoneStory's own default -- see StorySequence.tsx's
// DEFAULT_PRODUCT_POSITION and PRODUCT_IMAGE_BOUNDS comments.
const PRODUCT_BOX_WIDTH_RATIO = 0.55
const DEFAULT_PRODUCT_POSITION = { x: 50, y: 65 }
const PRODUCT_SHADOW_OFFSET_PX = 6

/** Resized to PRODUCT_BOX_WIDTH_RATIO of the canvas width with auto height
 * (aspect-ratio preserved) -- object-contain equivalent for a box whose
 * height isn't fixed, matching PhoneStory's `width: 55%; height: auto`
 * live-preview box exactly, instead of the old full-bleed letterboxed
 * layer. Also builds a soft drop-shadow silhouette (blurred, zeroed-out
 * RGB, alpha preserved) approximating the live preview's CSS
 * `drop-shadow-lg` on the same cutout. */
async function buildProductLayer(source: string): Promise<{ image: Buffer; shadow: Buffer; width: number; height: number } | null> {
  const photo = await fetchImageBuffer(source)
  if (!photo) return null
  try {
    const boxWidthPx = Math.round(CANVAS_WIDTH * PRODUCT_BOX_WIDTH_RATIO)
    const image = await sharp(photo).resize({ width: boxWidthPx }).png().toBuffer()
    const meta = await sharp(image).metadata()
    const width = meta.width ?? boxWidthPx
    const height = meta.height ?? boxWidthPx

    // linear(0, 0) zeroes RGB (without touching alpha) -- a black
    // silhouette in the cutout's exact shape, then blurred into a shadow.
    const shadow = await sharp(image).linear(0, 0).blur(10).png().toBuffer()

    return { image, shadow, width, height }
  } catch {
    return null
  }
}

/** sharp's composite() throws unless an overlay is fully contained within
 * the base image -- but PRODUCT_IMAGE_BOUNDS (StorySequence.tsx) deliberately
 * lets the box's drag position push it partway off-canvas (minX/maxX of
 * 10/90 against a box half-width of ~27.5%), the same way the live editor
 * preview just clips the overflow via the phone frame's own
 * overflow-hidden. Crops to whatever slice actually falls on-canvas and
 * re-anchors it there, instead of erroring or silently refusing to render
 * the whole slide. Returns null when nothing is left on-canvas at all. */
async function clampLayerForComposite(buffer: Buffer, left: number, top: number): Promise<{ input: Buffer; top: number; left: number } | null> {
  const meta = await sharp(buffer).metadata()
  const w = meta.width ?? 0
  const h = meta.height ?? 0
  if (w === 0 || h === 0) return null

  const visibleLeft = Math.max(0, left)
  const visibleTop = Math.max(0, top)
  const visibleRight = Math.min(CANVAS_WIDTH, left + w)
  const visibleBottom = Math.min(CANVAS_HEIGHT, top + h)
  const visibleWidth = Math.round(visibleRight - visibleLeft)
  const visibleHeight = Math.round(visibleBottom - visibleTop)
  if (visibleWidth <= 0 || visibleHeight <= 0) return null

  const cropped = await sharp(buffer)
    .extract({ left: Math.round(visibleLeft - left), top: Math.round(visibleTop - top), width: visibleWidth, height: visibleHeight })
    .png()
    .toBuffer()
  return { input: cropped, top: Math.round(visibleTop), left: Math.round(visibleLeft) }
}

// ─── Text ───────────────────────────────────────────────────────────────────

function headlineStyle(text: string): { fontSize: number; maxChars: number } {
  if (text.length < 20) return { fontSize: 92, maxChars: 15 }
  if (text.length < 40) return { fontSize: 72, maxChars: 19 }
  if (text.length < 70) return { fontSize: 56, maxChars: 24 }
  return { fontSize: 44, maxChars: 30 }
}

const SUBTEXT_FONT_SIZE = 42
const POLL_FONT_SIZE = 34

function buildTextOverlaySvg(slide: StoryCompositeSlide, textColor: string, subColor: string): string {
  const maxWidthChars = { headline: headlineStyle(slide.text).maxChars, subtext: 36, poll: 40 }

  const { fontSize: headlineFontSize } = headlineStyle(slide.text)
  const headlineLines = wrapText(slide.text, maxWidthChars.headline, 4)
  const headlineLineHeight = headlineFontSize * 1.15

  const subtextLines = slide.subtext.trim() ? wrapText(slide.subtext, maxWidthChars.subtext, 3) : []
  const subtextLineHeight = SUBTEXT_FONT_SIZE * 1.4

  // Plain centered text, not an interactive sticker -- baked into the
  // image file, this can't actually collect taps/votes once published, so
  // it shouldn't be styled to look like a button (matches the live
  // preview's own fix for this: a single <p>, no pill/chip chrome).
  const pollText = slide.has_poll && slide.poll_options && slide.poll_options.length > 0
    ? slide.poll_options.join("  ·  ")
    : ""
  const pollLines = pollText ? wrapText(pollText, maxWidthChars.poll, 2) : []
  const pollLineHeight = POLL_FONT_SIZE * 1.4

  const headlineBlockHeight = headlineLines.length * headlineLineHeight
  const subtextBlockHeight = subtextLines.length * subtextLineHeight
  const pollBlockHeight = pollLines.length * pollLineHeight
  const gapToSubtext = subtextLines.length > 0 ? 28 : 0
  const gapToPoll = pollLines.length > 0 ? 64 : 0
  const totalBlockHeight = headlineBlockHeight + gapToSubtext + subtextBlockHeight + gapToPoll + pollBlockHeight

  // Free-drag position (percentages, block CENTER) takes over completely
  // once set -- see StoryCompositeSlide.text_position_x/y's own comment.
  // Falls back to deriving a center point from text_position for any
  // slide that's never been dragged, via the same formula the live
  // preview defaults to (defaultTextCenter above), so nothing jumps
  // between editor and real export.
  const center = slide.text_position_x !== undefined && slide.text_position_y !== undefined
    ? { x: slide.text_position_x, y: slide.text_position_y }
    : defaultTextCenter(slide.text_position)
  const centerXAttr = `${center.x}%`
  const centerYPx = (center.y / 100) * CANVAS_HEIGHT
  const blockStartY = centerYPx - totalBlockHeight / 2

  let cursorY = blockStartY
  const headlineSvg = textLines(headlineLines, cursorY + headlineFontSize * 0.85, headlineLineHeight, headlineFontSize, textColor, 900, centerXAttr)
  cursorY += headlineBlockHeight + gapToSubtext

  const subtextSvg = subtextLines.length > 0
    ? textLines(subtextLines, cursorY + SUBTEXT_FONT_SIZE * 0.85, subtextLineHeight, SUBTEXT_FONT_SIZE, subColor, 600, centerXAttr)
    : ""
  cursorY += subtextBlockHeight + gapToPoll

  const pollSvg = pollLines.length > 0
    ? textLines(pollLines, cursorY + POLL_FONT_SIZE * 0.85, pollLineHeight, POLL_FONT_SIZE, subColor, 700, centerXAttr)
    : ""

  return `<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">${headlineSvg}${subtextSvg}${pollSvg}</svg>`
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface StoryCompositeSlide {
  type: "hook" | "reveal" | "buildup" | "cta"
  text: string
  subtext: string
  background: string
  text_position: "top" | "center" | "bottom"
  has_poll: boolean
  poll_options?: string[]
  background_image_url?: string | null
  custom_background_colors?: string[] | null
  /** Product/uploaded photo for this specific slide (StorySequence.tsx
   * resolves this per-slide from either a single picked product applied
   * to every slide, or up to 3 individually-uploaded photos by index) —
   * an http(s) URL or a data: URL, either works. Only actually rendered
   * when shouldShowProductImage(type, total) is true, same as the live
   * preview. */
  productImageSource?: string | null
  /** Free-drag override for where the text block sits -- percentages
   * (0-100 of this canvas's own width/height, marking the block's
   * center), matching exactly what StorySequence.tsx's PhoneStory drags
   * against (see components/shared/useDraggableText.ts). Absent falls
   * back to deriving a position from text_position above, same as the
   * live preview's own fallback -- see buildTextOverlaySvg below. */
  text_position_x?: number
  text_position_y?: number
  /** Whether to actually composite productImageSource -- resolved by the
   * client (StorySequence.tsx's toExportSlide) from
   * StorySlide.show_product_overlay ?? background_image_provider !==
   * "flux", since this file has no idea what provider generated
   * background_image_url. Absent (an older cached slide from before this
   * field existed) defaults to shown, same as this file's own prior
   * always-on behavior. */
  show_product_overlay?: boolean
  /** Free-drag override for where the product photo overlay sits --
   * percentages (0-100, marking the box's center), same convention as
   * text_position_x/y above. Absent falls back to DEFAULT_PRODUCT_POSITION,
   * matching PhoneStory's own fallback. */
  product_position_x?: number
  product_position_y?: number
}

/**
 * SVG/resvg equivalent of StorySequence.tsx's PhoneStory preview — same
 * layout, colors, and text, but a clean full-bleed 1080x1920 raster with
 * no phone-frame chrome (rounded corners, notch, "tap to continue" hint)
 * baked in. Instagram's own Stories UI already renders that chrome
 * natively; baking a fake copy into the image doubles it up once actually
 * published. This is what "Save as PNG" and the real Zernio publish path
 * both render from now — the phone-frame preview in the editor is
 * untouched and still a plain DOM screenshot, since that's a legitimate
 * in-app "here's roughly how it'll look" aid, not the exported asset.
 */
export async function renderStorySlidesToPng(slides: StoryCompositeSlide[]): Promise<Buffer[]> {
  const total = slides.length
  if (total === 0) return []

  return Promise.all(
    slides.map(async (slide) => {
      const { buffer: backgroundLayer, textColor, subColor } = await buildBackgroundLayer(slide)

      const layers: { input: Buffer; top: number; left: number }[] = []

      // show_product_overlay !== false (not a plain truthiness check) so
      // an older cached/persisted slide from before this field existed --
      // absent, not explicitly false -- still defaults to shown, matching
      // this file's own prior always-on behavior.
      if (shouldShowProductImage(slide.type, total) && slide.show_product_overlay !== false && slide.productImageSource) {
        const productLayer = await buildProductLayer(slide.productImageSource)
        if (productLayer) {
          const center = slide.product_position_x !== undefined && slide.product_position_y !== undefined
            ? { x: slide.product_position_x, y: slide.product_position_y }
            : DEFAULT_PRODUCT_POSITION
          const left = Math.round((center.x / 100) * CANVAS_WIDTH - productLayer.width / 2)
          const top = Math.round((center.y / 100) * CANVAS_HEIGHT - productLayer.height / 2)
          const shadowLayer = await clampLayerForComposite(productLayer.shadow, left + PRODUCT_SHADOW_OFFSET_PX, top + PRODUCT_SHADOW_OFFSET_PX)
          if (shadowLayer) layers.push(shadowLayer)
          const imageLayer = await clampLayerForComposite(productLayer.image, left, top)
          if (imageLayer) layers.push(imageLayer)
        }
      }

      const textOverlayPng = await svgToPngBuffer(buildTextOverlaySvg(slide, textColor, subColor))
      layers.push({ input: textOverlayPng, top: 0, left: 0 })

      return sharp(backgroundLayer).composite(layers).png().toBuffer()
    })
  )
}
