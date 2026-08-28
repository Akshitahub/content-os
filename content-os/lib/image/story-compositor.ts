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

function textLines(lines: string[], startY: number, lineHeight: number, fontSize: number, color: string, weight: number): string {
  return lines
    .map((line, i) => `<text x="50%" y="${startY + i * lineHeight}" text-anchor="middle" font-family="StoryFont, sans-serif" font-weight="${weight}" font-size="${fontSize}" fill="${color}">${escapeXml(line)}</text>`)
    .join("")
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

/** object-contain equivalent: the photo is letterboxed to fit the full
 * canvas without cropping, with the same rgba(0,0,0,0.35) fill the live
 * preview uses behind it, visible in the letterbox bars. */
async function buildProductLayer(source: string): Promise<Buffer | null> {
  const photo = await fetchImageBuffer(source)
  if (!photo) return null
  try {
    return await sharp(photo)
      .resize(CANVAS_WIDTH, CANVAS_HEIGHT, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0.35 } })
      .png()
      .toBuffer()
  } catch {
    return null
  }
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

  const interiorTop = SAFE_ZONE
  const interiorBottom = CANVAS_HEIGHT - SAFE_ZONE
  const interiorHeight = interiorBottom - interiorTop

  const blockStartY =
    slide.text_position === "top" ? interiorTop :
    slide.text_position === "bottom" ? interiorBottom - totalBlockHeight :
    interiorTop + (interiorHeight - totalBlockHeight) / 2

  let cursorY = blockStartY
  const headlineSvg = textLines(headlineLines, cursorY + headlineFontSize * 0.85, headlineLineHeight, headlineFontSize, textColor, 900)
  cursorY += headlineBlockHeight + gapToSubtext

  const subtextSvg = subtextLines.length > 0
    ? textLines(subtextLines, cursorY + SUBTEXT_FONT_SIZE * 0.85, subtextLineHeight, SUBTEXT_FONT_SIZE, subColor, 600)
    : ""
  cursorY += subtextBlockHeight + gapToPoll

  const pollSvg = pollLines.length > 0
    ? textLines(pollLines, cursorY + POLL_FONT_SIZE * 0.85, pollLineHeight, POLL_FONT_SIZE, subColor, 700)
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

      if (shouldShowProductImage(slide.type, total) && slide.productImageSource) {
        const productLayer = await buildProductLayer(slide.productImageSource)
        if (productLayer) layers.push({ input: productLayer, top: 0, left: 0 })
      }

      const textOverlayPng = await svgToPngBuffer(buildTextOverlaySvg(slide, textColor, subColor))
      layers.push({ input: textOverlayPng, top: 0, left: 0 })

      return sharp(backgroundLayer).composite(layers).png().toBuffer()
    })
  )
}
