import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import sharp from "sharp"
import { Resvg } from "@resvg/resvg-js"
import { decompress } from "wawoff2"
import { getPrimaryColor, getSecondaryColor } from "@/lib/design/post-card-generator"
import type { CarouselSlide } from "@/lib/design/post-card-generator"
import type { BrandRow } from "@/types/database"

const CANVAS_SIZE = 1080

// Same cached-TTF pattern as lib/image/meme-compositor.ts and
// lib/image/post-compositor.ts — resvg-js's font loader only accepts raw
// TrueType, not the woff2 @fontsource/anton ships, so it's decompressed
// once and cached in /tmp across warm serverless invocations. Reuses Anton
// rather than adding a second font family (same project decision as
// post-compositor.ts — no fonts besides Anton are bundled).
let cachedFontPath: string | null = null

async function getFontPath(): Promise<string> {
  if (cachedFontPath && existsSync(cachedFontPath)) return cachedFontPath

  const woff2Path = join(process.cwd(), "node_modules/@fontsource/anton/files/anton-latin-400-normal.woff2")
  const ttfBuffer = await decompress(readFileSync(woff2Path))

  const ttfPath = join(tmpdir(), "carousel-compositor-anton.ttf")
  writeFileSync(ttfPath, ttfBuffer)
  cachedFontPath = ttfPath
  return ttfPath
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

function textLines(lines: string[], startY: number, lineHeight: number, fontSize: number, color: string, weight: number, xAttr: string = "50%"): string {
  return lines
    .map((line, i) => `<text x="${xAttr}" y="${startY + i * lineHeight}" text-anchor="middle" font-family="CarouselFont, sans-serif" font-weight="${weight}" font-size="${fontSize}" fill="${color}">${escapeXml(line)}</text>`)
    .join("")
}

interface SlideRenderParams {
  index: number
  total: number
  isCover: boolean
  isLast: boolean
  headline: string
  body: string
  brandName: string
  primary: string
  secondary: string
}

// Mirrors generateCarouselHtml's layout (lib/design/post-card-generator.ts):
// cover and last slide get the brand gradient + white text, inner slides
// get a white background with the headline in the brand's primary color —
// same visual language, rebuilt as SVG so it can be rasterized via resvg
// instead of requiring an HTML/CSS renderer this app doesn't have.
function buildSlideSvg(params: SlideRenderParams): string {
  const { index, total, isCover, isLast, headline, body, brandName, primary, secondary } = params
  const useGradient = isCover || isLast

  const bg = useGradient
    ? `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${primary}"/><stop offset="100%" stop-color="${secondary}"/></linearGradient></defs><rect width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" fill="url(#bg)"/>`
    : `<rect width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" fill="#ffffff"/>`

  const headlineColor = useGradient ? "#ffffff" : primary
  const bodyColor = useGradient ? "rgba(255,255,255,0.85)" : "#555555"
  const brandColor = useGradient ? "rgba(255,255,255,0.5)" : "#bbbbbb"
  const numColor = useGradient ? "rgba(255,255,255,0.45)" : "#dddddd"

  const numSvg = `<text x="${CANVAS_SIZE - 52}" y="70" text-anchor="end" font-family="CarouselFont, sans-serif" font-weight="400" font-size="22" fill="${numColor}">${index + 1} / ${total}</text>`
  const swipeSvg = `<text x="${CANVAS_SIZE - 52}" y="70" text-anchor="end" font-family="CarouselFont, sans-serif" font-weight="400" font-size="20" fill="rgba(255,255,255,0.6)">SWIPE &#8594;</text>`
  const brandSvg = `<text x="50%" y="${CANVAS_SIZE - 56}" text-anchor="middle" font-family="CarouselFont, sans-serif" font-weight="400" font-size="22" fill="${brandColor}">${escapeXml(brandName.toUpperCase())}</text>`

  const headlineFontSize = headline.length < 40 ? 68 : headline.length < 80 ? 56 : 44
  const headlineLines = wrapText(headline, isCover ? 20 : 18, 4)
  const headlineLineHeight = headlineFontSize * 1.18

  const bodyFontSize = 32
  const bodyLineHeight = bodyFontSize * 1.5
  const bodyLines = body ? wrapText(body, 42, 8) : []

  const headlineBlockHeight = headlineLines.length * headlineLineHeight
  const bodyBlockHeight = bodyLines.length * bodyLineHeight
  const gap = bodyLines.length > 0 ? 40 : 0
  const totalBlockHeight = headlineBlockHeight + gap + bodyBlockHeight

  const blockStartY = CANVAS_SIZE / 2 - totalBlockHeight / 2
  const headlineStartY = blockStartY + headlineFontSize * 0.85
  const headlineSvg = textLines(headlineLines, headlineStartY, headlineLineHeight, headlineFontSize, headlineColor, 800)

  const bodyStartY = blockStartY + headlineBlockHeight + gap + bodyFontSize * 0.85
  const bodySvg = textLines(bodyLines, bodyStartY, bodyLineHeight, bodyFontSize, bodyColor, 400)

  const seriesSvg = isCover
    ? `<text x="90" y="${blockStartY - 40}" font-family="CarouselFont, sans-serif" font-weight="400" font-size="18" fill="rgba(255,255,255,0.6)">${escapeXml(`${total}-PART SERIES`)}</text>`
    : ""

  return `<svg width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" xmlns="http://www.w3.org/2000/svg">${bg}${isCover ? swipeSvg : numSvg}${seriesSvg}${headlineSvg}${bodySvg}${brandSvg}</svg>`
}

export interface RenderCarouselSlidesOptions {
  brand: BrandRow
  coverHook: string
  slides: CarouselSlide[]
}

/**
 * SVG/resvg equivalent of generateCarouselHtml — same layout, same brand
 * colors, but rasterized to real PNG buffers (one per slide) instead of an
 * HTML string, so a carousel can actually be uploaded and published rather
 * than only previewed in an iframe. generateCarouselHtml itself is
 * untouched and still used for that on-screen preview
 * (components/calendar/CalendarEntryPanel.tsx).
 */
export async function renderCarouselSlidesToPng(options: RenderCarouselSlidesOptions): Promise<Buffer[]> {
  const { brand, coverHook, slides } = options
  if (slides.length === 0) return []

  const primary = getPrimaryColor(brand)
  const secondary = getSecondaryColor(brand)
  const brandName = brand.name
  const total = slides.length
  const fontPath = await getFontPath()

  return Promise.all(
    slides.map((slide, i) => {
      const isCover = i === 0
      const isLast = i === slides.length - 1

      const svg = buildSlideSvg({
        index: i,
        total,
        isCover,
        isLast,
        headline: isCover ? coverHook : slide.headline,
        body: isCover ? "" : slide.body,
        brandName,
        primary,
        secondary,
      })

      const resvg = new Resvg(svg, {
        font: { fontFiles: [fontPath], loadSystemFonts: false, defaultFontFamily: "CarouselFont" },
      })
      return resvg.render().asPng()
    })
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Rich carousel compositor — for CarouselBuilder.tsx's manual, per-slide
// content (points, background_style, a real AI photo, custom colors, drag
// positioning), a genuinely different and richer shape than the Autopilot
// pipeline's plain {headline, body} above. That simpler renderer stays
// completely untouched (fastlane.ts and calendar/[entryId]/regenerate
// still call it exactly as before) — this is a second, additive export.
//
// CONFIRMED root cause (2026-08-29) this exists to fix: CarouselBuilder's
// real download/schedule path was an html-to-image DOM screenshot of the
// live SlidePreview element -- which only exists while that exact editor
// page is open. Scheduling later from My Content (a different page, no
// live SlidePreview DOM at all) instead scheduled slides[i].image_url
// directly: the bare AI-generated BACKGROUND PHOTO with no headline/body
// text ever composited onto it (SlidePreview only ever overlaid that text
// via HTML/CSS on screen, never baked it into a raster), and only for
// whichever slides happen to have one -- by default just the hook/cta
// slides, since a body slide never gets an image_url unless "AI
// background for every slide" was opted into. That's the exact reported
// defect: text missing from the published image, and slides beyond the
// first missing outright. Confirmed via a real generated+saved+scheduled
// carousel, not assumed -- see the commit message for the full trace.
//
// The fix mirrors lib/image/story-compositor.ts exactly: one real
// server-side compositor, visually matching CarouselBuilder.tsx's
// SlidePreview, used by EVERY export path (live download, live schedule,
// and Library/My Content schedule alike) so there is no second "what the
// editor showed" path to drift out of sync with what actually gets
// persisted/published -- the same structural fix already applied to
// Stories earlier, now applied here too.

const RICH_CANVAS_WIDTH = 1080
// Matches PORTRAIT_DIMENSIONS in lib/ai/post-image-pipeline.ts (1080x1350,
// 4:5) -- the actual resolution CarouselBuilder's AI backgrounds are
// generated at, and the same aspect-[4/5] SlidePreview renders live.
const RICH_CANVAS_HEIGHT = 1350

// Mirrors CAROUSEL_BG_STYLES in lib/design/carousel-slide-styles.ts
// exactly (same 8 named presets, same diagonal bg-gradient-to-br
// direction) -- real hex stops for the Tailwind shades that CSS used as
// classes there. Kept as a literal, separately-maintained mirror rather
// than importing Tailwind class strings and parsing them, same approach
// story-compositor.ts already takes for its own STORY_BG_PRESETS.
const RICH_BG_PRESETS: Record<string, { stops: [string, string, string]; text: string; subtext: string }> = {
  gradient_dark: { stops: ["#4c1d95", "#581c87", "#1e1b4b"], text: "#ffffff", subtext: "rgba(255,255,255,0.7)" },
  gradient_light: { stops: ["#f5f3ff", "#eef2ff", "#ffffff"], text: "#111827", subtext: "#6b7280" },
  white_violet: { stops: ["#ffffff", "#ffffff", "#ffffff"], text: "#111827", subtext: "#6b7280" },
  dark_navy: { stops: ["#111827", "#0f172a", "#000000"], text: "#ffffff", subtext: "rgba(255,255,255,0.6)" },
  vibe_fun_playful: { stops: ["#fb923c", "#facc15", "#2dd4bf"], text: "#ffffff", subtext: "rgba(255,255,255,0.7)" },
  vibe_warm_cozy: { stops: ["#fbbf24", "#f97316", "#dc2626"], text: "#ffffff", subtext: "rgba(255,255,255,0.7)" },
  vibe_professional: { stops: ["#1e3a8a", "#1e293b", "#111827"], text: "#ffffff", subtext: "rgba(255,255,255,0.7)" },
  vibe_trendy_genz: { stops: ["#8b5cf6", "#d946ef", "#22d3ee"], text: "#ffffff", subtext: "rgba(255,255,255,0.8)" },
}
const RICH_DEFAULT_PRESET = "gradient_dark"

// Same dark scrim SlidePreview applies over an AI photo or custom color/
// gradient background (bg-gradient-to-t from-black/75 via-black/25 to-
// black/45) -- and the same one story-compositor.ts uses, so both content
// types read identically wherever a photo/custom background needs it.
const RICH_SCRIM_SVG = `<defs><linearGradient id="richScrim" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="#000000" stop-opacity="0.75"/><stop offset="50%" stop-color="#000000" stop-opacity="0.25"/><stop offset="100%" stop-color="#000000" stop-opacity="0.45"/></linearGradient></defs><rect width="${RICH_CANVAS_WIDTH}" height="${RICH_CANVAS_HEIGHT}" fill="url(#richScrim)"/>`

// Mirrors cssBackgroundFromColors (components/shared/ColorWheelPicker.tsx)
// exactly: 1 hex = solid, 2 = a 135deg gradient -- same diagonal (x1=0,y1=0
// -> x2=1,y2=1) story-compositor.ts's own customBackgroundFill already
// uses for the identical CSS angle.
function richCustomBackgroundFill(colors: string[]): string {
  if (colors.length === 1) return `<rect width="${RICH_CANVAS_WIDTH}" height="${RICH_CANVAS_HEIGHT}" fill="${colors[0]}"/>`
  return `<defs><linearGradient id="richCustom" x1="0" y1="0" x2="1" y2="1">${colors
    .map((c, i) => `<stop offset="${(i / (colors.length - 1)) * 100}%" stop-color="${c}"/>`)
    .join("")}</linearGradient></defs><rect width="${RICH_CANVAS_WIDTH}" height="${RICH_CANVAS_HEIGHT}" fill="url(#richCustom)"/>`
}

async function fetchRichImageBuffer(source: string): Promise<Buffer | null> {
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

export interface CarouselCompositeSlide {
  type: "cover" | "content" | "cta"
  headline: string
  /** Cover slides only -- SlidePreview's teaser line under the headline. */
  subtext?: string | null
  /** Content slides only -- the bullet list under the headline. */
  points?: string[] | null
  /** CTA slide only -- SlidePreview receives these via a separate
   * `ctaSlide` prop there; flattened onto the slide itself here since
   * there's exactly one CTA slide per carousel and no benefit to keeping
   * them split for compositing. */
  ctaText?: string | null
  ctaHandle?: string | null
  background_style?: string | null
  /** AI-generated background photo -- see this section's own top comment
   * for why this was never enough on its own (background only, no text)
   * to schedule from Library correctly. */
  image_url?: string | null
  custom_background_colors?: string[] | null
  /** Free-drag override -- see CarouselSlideRich.text_position_x/y's own
   * comment in components/generate/CarouselBuilder.tsx. Percentages,
   * marking the text block's center; absent means dead-center (matches
   * SlidePreview's own default). */
  text_position_x?: number | null
  text_position_y?: number | null
  /** Product/uploaded photo -- SlidePreview places this differently per
   * slide type (cover: bottom-right; content: top-right badge; cta:
   * top-center), replicated exactly below. */
  productImageSource?: string | null
}

function headlineStyleFor(type: CarouselCompositeSlide["type"], text: string): { fontSize: number; maxChars: number } {
  // Roughly mirrors SlidePreview's text-3xl (cover) / text-xl (content) /
  // text-2xl (cta) Tailwind classes, tiered by length the same way
  // story-compositor.ts's headlineStyle already is -- not a pixel-exact
  // CSS-to-SVG mapping (there isn't a meaningful one across two totally
  // different renderers), just a visually equivalent real font scale.
  const tiers = type === "cover"
    ? [{ max: 20, size: 84 }, { max: 40, size: 68 }, { max: 70, size: 52 }, { max: Infinity, size: 40 }]
    : type === "cta"
      ? [{ max: 20, size: 62 }, { max: 40, size: 50 }, { max: 70, size: 40 }, { max: Infinity, size: 32 }]
      : [{ max: 20, size: 54 }, { max: 40, size: 44 }, { max: 70, size: 36 }, { max: Infinity, size: 30 }]
  const tier = tiers.find((t) => text.length < t.max) ?? tiers[tiers.length - 1]!
  const maxChars = Math.round(tier.size < 45 ? 26 : tier.size < 60 ? 20 : 16)
  return { fontSize: tier.size, maxChars }
}

const RICH_SUBTEXT_FONT_SIZE = 34
const RICH_POINT_FONT_SIZE = 30
const RICH_CTA_TEXT_FONT_SIZE = 34
const RICH_CTA_HANDLE_FONT_SIZE = 30
const RICH_MARGIN = 80

/** Priority matches SlidePreview exactly: an AI photo beats a custom
 * color/gradient, which beats the named background_style. Photo and
 * custom-color both get the dark scrim; presets never do. */
async function buildRichBackgroundLayer(slide: CarouselCompositeSlide): Promise<{ buffer: Buffer; textColor: string; subtextColor: string }> {
  const preset = RICH_BG_PRESETS[slide.background_style ?? ""] ?? RICH_BG_PRESETS[RICH_DEFAULT_PRESET]!
  const customColors = (slide.custom_background_colors ?? []).filter(Boolean)

  if (slide.image_url) {
    const photo = await fetchRichImageBuffer(slide.image_url)
    if (photo) {
      const base = await sharp(photo).resize(RICH_CANVAS_WIDTH, RICH_CANVAS_HEIGHT, { fit: "cover" }).png().toBuffer()
      const scrimPng = await svgToRichPngBuffer(`<svg width="${RICH_CANVAS_WIDTH}" height="${RICH_CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">${RICH_SCRIM_SVG}</svg>`)
      const buffer = await sharp(base).composite([{ input: scrimPng, top: 0, left: 0 }]).png().toBuffer()
      return { buffer, textColor: "#ffffff", subtextColor: "rgba(255,255,255,0.7)" }
    }
    // Photo failed to fetch -- fall through to custom color / preset
    // rather than leaving the slide with no background at all.
  }

  if (customColors.length > 0) {
    const svg = `<svg width="${RICH_CANVAS_WIDTH}" height="${RICH_CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">${richCustomBackgroundFill(customColors)}${RICH_SCRIM_SVG}</svg>`
    const buffer = await svgToRichPngBuffer(svg)
    return { buffer, textColor: "#ffffff", subtextColor: "rgba(255,255,255,0.7)" }
  }

  const [c1, c2, c3] = preset.stops
  const svg = `<svg width="${RICH_CANVAS_WIDTH}" height="${RICH_CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="richPreset" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${c1}"/><stop offset="50%" stop-color="${c2}"/><stop offset="100%" stop-color="${c3}"/></linearGradient></defs><rect width="${RICH_CANVAS_WIDTH}" height="${RICH_CANVAS_HEIGHT}" fill="url(#richPreset)"/></svg>`
  const buffer = await svgToRichPngBuffer(svg)
  return { buffer, textColor: preset.text, subtextColor: preset.subtext }
}

/** Replicates SlidePreview's three per-type product-image placements
 * exactly (cover: bottom-right, ~42% wide/58% tall; content: top-right
 * badge, ~22%; cta: top-center, ~36%), each object-contain (never
 * cropped) with drop-shadow approximated by a soft dark backing where the
 * live preview used `drop-shadow-2xl`/`drop-shadow-xl` CSS. */
async function buildRichProductLayer(slide: CarouselCompositeSlide): Promise<{ input: Buffer; top: number; left: number } | null> {
  if (!slide.productImageSource) return null
  const photo = await fetchRichImageBuffer(slide.productImageSource)
  if (!photo) return null

  try {
    if (slide.type === "cover") {
      const w = Math.round(RICH_CANVAS_WIDTH * 0.42)
      const h = Math.round(RICH_CANVAS_HEIGHT * 0.58)
      const resized = await sharp(photo).resize(w, h, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
      return { input: resized, top: RICH_CANVAS_HEIGHT - h - Math.round(RICH_CANVAS_HEIGHT * 0.074), left: RICH_CANVAS_WIDTH - w - Math.round(RICH_CANVAS_WIDTH * 0.037) }
    }
    if (slide.type === "content") {
      const size = Math.round(RICH_CANVAS_WIDTH * 0.22)
      const resized = await sharp(photo).resize(size, size, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0.12 } }).png().toBuffer()
      return { input: resized, top: Math.round(RICH_CANVAS_HEIGHT * 0.028), left: RICH_CANVAS_WIDTH - size - Math.round(RICH_CANVAS_WIDTH * 0.028) }
    }
    // cta
    const size = Math.round(RICH_CANVAS_WIDTH * 0.36)
    const resized = await sharp(photo).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
    return { input: resized, top: Math.round(RICH_CANVAS_HEIGHT * 0.056), left: Math.round((RICH_CANVAS_WIDTH - size) / 2) }
  } catch {
    return null
  }
}

async function svgToRichPngBuffer(svg: string): Promise<Buffer> {
  const fontPath = await getFontPath()
  const resvg = new Resvg(svg, {
    font: { fontFiles: [fontPath], loadSystemFonts: false, defaultFontFamily: "CarouselFont" },
  })
  return Buffer.from(resvg.render().asPng())
}

function buildRichTextOverlaySvg(slide: CarouselCompositeSlide, brandName: string, textColor: string, subtextColor: string): string {
  const maxWidthChars = headlineStyleFor(slide.type, slide.headline).maxChars
  const { fontSize: headlineFontSize } = headlineStyleFor(slide.type, slide.headline)
  const headlineLines = wrapText(slide.headline, maxWidthChars, 4)
  const headlineLineHeight = headlineFontSize * 1.18

  const subtextLines = slide.type === "cover" && slide.subtext?.trim() ? wrapText(slide.subtext, 34, 3) : []
  const subtextLineHeight = RICH_SUBTEXT_FONT_SIZE * 1.4

  const pointLines = slide.type === "content" && slide.points?.length
    ? slide.points.flatMap((p) => wrapText(p, 42, 2))
    : []
  const pointLineHeight = RICH_POINT_FONT_SIZE * 1.6

  const ctaTextLines = slide.type === "cta" && slide.ctaText?.trim() ? wrapText(slide.ctaText, 40, 2) : []
  const ctaTextLineHeight = RICH_CTA_TEXT_FONT_SIZE * 1.4
  const ctaHandleLines = slide.type === "cta" && slide.ctaHandle?.trim() ? [slide.ctaHandle] : []
  const ctaHandleLineHeight = RICH_CTA_HANDLE_FONT_SIZE * 1.4

  const headlineBlockHeight = headlineLines.length * headlineLineHeight
  const subtextBlockHeight = subtextLines.length * subtextLineHeight
  const pointsBlockHeight = pointLines.length * pointLineHeight
  const ctaTextBlockHeight = ctaTextLines.length * ctaTextLineHeight
  const ctaHandleBlockHeight = ctaHandleLines.length * ctaHandleLineHeight

  const gapToSubtext = subtextLines.length > 0 ? 36 : 0
  const gapToPoints = pointLines.length > 0 ? 48 : 0
  const gapToCtaText = ctaTextLines.length > 0 ? 32 : 0
  const gapToCtaHandle = ctaHandleLines.length > 0 ? 20 : 0

  const totalBlockHeight = headlineBlockHeight + gapToSubtext + subtextBlockHeight
    + gapToPoints + pointsBlockHeight + gapToCtaText + ctaTextBlockHeight + gapToCtaHandle + ctaHandleBlockHeight

  // Free-drag position (percentages, block CENTER) -- absent means
  // dead-center, matching SlidePreview's own CAROUSEL_DEFAULT_TEXT_POSITION.
  const centerX = slide.text_position_x ?? 50
  const centerY = slide.text_position_y ?? 50
  const centerXAttr = `${centerX}%`
  const centerYPx = (centerY / 100) * RICH_CANVAS_HEIGHT
  const blockStartY = centerYPx - totalBlockHeight / 2

  let cursorY = blockStartY
  const headlineSvg = textLines(headlineLines, cursorY + headlineFontSize * 0.85, headlineLineHeight, headlineFontSize, textColor, 800, centerXAttr)
  cursorY += headlineBlockHeight + gapToSubtext

  const subtextSvg = subtextLines.length > 0
    ? textLines(subtextLines, cursorY + RICH_SUBTEXT_FONT_SIZE * 0.85, subtextLineHeight, RICH_SUBTEXT_FONT_SIZE, subtextColor, 500, centerXAttr)
    : ""
  cursorY += subtextBlockHeight + gapToPoints

  // Points render as left-aligned bullet lines (matching SlidePreview's
  // actual layout -- a dot + text row, not centered prose), anchored
  // under the same draggable text_position_x rather than the slide's
  // fixed left padding, so points move together with the rest of the
  // block when dragged.
  const pointsSvg = pointLines.length > 0
    ? pointLines.map((line, i) => {
        const y = cursorY + i * pointLineHeight + RICH_POINT_FONT_SIZE * 0.85
        const dotX = centerX - 21
        const textX = centerX - 14
        return `<circle cx="${dotX}%" cy="${y - RICH_POINT_FONT_SIZE * 0.35}" r="5" fill="#a78bfa"/><text x="${textX}%" y="${y}" text-anchor="start" font-family="CarouselFont, sans-serif" font-weight="400" font-size="${RICH_POINT_FONT_SIZE}" fill="${subtextColor}">${escapeXml(line)}</text>`
      }).join("")
    : ""
  cursorY += pointsBlockHeight + gapToCtaText

  const ctaTextSvg = ctaTextLines.length > 0
    ? textLines(ctaTextLines, cursorY + RICH_CTA_TEXT_FONT_SIZE * 0.85, ctaTextLineHeight, RICH_CTA_TEXT_FONT_SIZE, subtextColor, 500, centerXAttr)
    : ""
  cursorY += ctaTextBlockHeight + gapToCtaHandle

  const ctaHandleSvg = ctaHandleLines.length > 0
    ? textLines(ctaHandleLines, cursorY + RICH_CTA_HANDLE_FONT_SIZE * 0.85, ctaHandleLineHeight, RICH_CTA_HANDLE_FONT_SIZE, textColor, 700, centerXAttr)
    : ""

  const brandSvg = brandName
    ? `<text x="${RICH_CANVAS_WIDTH - RICH_MARGIN / 2}" y="${RICH_CANVAS_HEIGHT - 44}" text-anchor="end" font-family="CarouselFont, sans-serif" font-weight="500" font-size="26" fill="${subtextColor}">${escapeXml(brandName)}</text>`
    : ""

  return `<svg width="${RICH_CANVAS_WIDTH}" height="${RICH_CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">${headlineSvg}${subtextSvg}${pointsSvg}${ctaTextSvg}${ctaHandleSvg}${brandSvg}</svg>`
}

/**
 * SVG/resvg equivalent of CarouselBuilder.tsx's SlidePreview (full size) --
 * same layout, colors, and text, rasterized to a clean 1080x1350 PNG per
 * slide with no editor chrome (drag handle, thumbnail border, etc.) baked
 * in. This is what every real export path now renders from -- live
 * download, live schedule, and Library/My Content schedule alike (see
 * lib/utils/carousel-export.ts) -- so there's exactly one place that
 * defines what a carousel slide actually looks like once it leaves the
 * editor, the same structural guarantee story-compositor.ts already gives
 * Stories.
 */
export async function renderRichCarouselSlidesToPng(brandName: string, slides: CarouselCompositeSlide[]): Promise<Buffer[]> {
  if (slides.length === 0) return []

  return Promise.all(
    slides.map(async (slide) => {
      const { buffer: backgroundLayer, textColor, subtextColor } = await buildRichBackgroundLayer(slide)

      const layers: { input: Buffer; top: number; left: number }[] = []

      const productLayer = await buildRichProductLayer(slide)
      if (productLayer) layers.push(productLayer)

      const textOverlayPng = await svgToRichPngBuffer(buildRichTextOverlaySvg(slide, brandName, textColor, subtextColor))
      layers.push({ input: textOverlayPng, top: 0, left: 0 })

      return sharp(backgroundLayer).composite(layers).png().toBuffer()
    })
  )
}
