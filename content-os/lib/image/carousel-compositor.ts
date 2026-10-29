import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import sharp from "sharp"
import { Resvg } from "@resvg/resvg-js"
import { decompress } from "wawoff2"
import { getPrimaryColor, getSecondaryColor } from "@/lib/design/post-card-generator"
import type { CarouselSlide } from "@/lib/design/post-card-generator"
import { CURATED_FONTS, DEFAULT_FONT_ID, FONT_FAMILY_NAME, defaultBodyFont, findFont } from "@/lib/design/fonts"
import type { FontId } from "@/lib/design/fonts"
import type { BrandRow } from "@/types/database"
import { sanitizeTextForCompositing } from "@/lib/image/sanitize-text-for-compositing"
import { TEXT_STYLE_PALETTE, backingRgba, type TextStyle } from "@/lib/design/text-style"
import {
  carouselBrandPrim, carouselSlidePlan, carouselStepNumbers, planTextLayout, stampSequenceLayouts, svgFamilies, type TextLayoutFields,
} from "@/lib/design/text-layouts"
import { layoutPrimsToSvg } from "@/lib/design/text-layout-render"
import {
  CAROUSEL_BRAND_BASELINE, SAFE_EDGE_RATIO, TEXT_OVERFLOW_WARNING, clampBlockTop, estimateBlockWidth, fitTextStack,
  layoutCarouselText, type FittedBlock, type SlideWarning,
} from "@/lib/design/slide-text-layout"

const CANVAS_SIZE = 1080

// Same cached-TTF pattern as lib/image/post-compositor.ts — resvg-js's font
// loader only accepts raw TrueType, not the woff2 @fontsource ships, so
// each curated font is decompressed to a TTF once and cached in /tmp across
// warm serverless invocations. Keyed by font id (was a single global when
// Anton was the only option) so all five curated fonts cache independently.
// Shared by BOTH renderers below (the plain Autopilot slide renderer and
// the rich CarouselBuilder.tsx renderer) -- only the rich one actually lets
// a caller pick a font per slide; the plain renderer keeps always resolving
// DEFAULT_FONT_ID, unchanged behavior.
const fontPathCache = new Map<string, string>()

async function getFontPath(fontId: string): Promise<string> {
  const cached = fontPathCache.get(fontId)
  if (cached && existsSync(cached)) return cached

  const font = findFont(CURATED_FONTS, fontId)
  const woff2Path = join(process.cwd(), `node_modules/@fontsource/${font.packageName}/files/${font.fileName}`)
  const ttfBuffer = await decompress(readFileSync(woff2Path))

  const ttfPath = join(tmpdir(), `carousel-compositor-${font.id}.ttf`)
  writeFileSync(ttfPath, ttfBuffer)
  fontPathCache.set(fontId, ttfPath)
  return ttfPath
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function textLines(lines: string[], startY: number, lineHeight: number, fontSize: number, color: string, weight: number, xAttr: string = "50%", family: string = "CarouselFont, sans-serif"): string {
  return lines
    .map((line, i) => `<text x="${xAttr}" y="${startY + i * lineHeight}" text-anchor="middle" font-family="${family}" font-weight="${weight}" font-size="${fontSize}" fill="${color}">${escapeXml(line)}</text>`)
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
function buildSlideSvg(params: SlideRenderParams): { svg: string; overflow: boolean } {
  const { index, total, isCover, isLast, primary, secondary } = params
  // Sanitized right here, before any length-based sizing/wrapping (below)
  // or <text> element uses these -- see sanitize-text-for-compositing.ts's
  // own comment for why this is the only place in the pipeline this runs.
  const headline = sanitizeTextForCompositing(params.headline)
  const body = sanitizeTextForCompositing(params.body)
  const brandName = sanitizeTextForCompositing(params.brandName)
  const useGradient = isCover || isLast

  const bg = useGradient
    ? `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${primary}"/><stop offset="100%" stop-color="${secondary}"/></linearGradient></defs><rect width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" fill="url(#bg)"/>`
    : `<rect width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" fill="#ffffff"/>`

  const headlineColor = useGradient ? "#ffffff" : primary
  const bodyColor = useGradient ? "rgba(255,255,255,0.85)" : "#555555"
  const brandColor = useGradient ? "rgba(255,255,255,0.5)" : "#bbbbbb"
  const numColor = useGradient ? "rgba(255,255,255,0.45)" : "#dddddd"

  // Corner labels and the brand line sit on the 6% safe edge.
  const edge = Math.round(CANVAS_SIZE * SAFE_EDGE_RATIO)
  const numSvg = `<text x="${CANVAS_SIZE - edge}" y="${edge + 6}" text-anchor="end" font-family="CarouselFont, sans-serif" font-weight="400" font-size="22" fill="${numColor}">${index + 1} / ${total}</text>`
  const swipeSvg = `<text x="${CANVAS_SIZE - edge}" y="${edge + 6}" text-anchor="end" font-family="CarouselFont, sans-serif" font-weight="400" font-size="20" fill="rgba(255,255,255,0.6)">SWIPE &#8594;</text>`
  const brandSvg = `<text x="50%" y="${CANVAS_SIZE - edge}" text-anchor="middle" font-family="CarouselFont, sans-serif" font-weight="400" font-size="22" fill="${brandColor}">${escapeXml(brandName.toUpperCase())}</text>`

  // Steps sizes down instead of dropping lines (lib/design/slide-text-layout.ts);
  // the block stays between the top corner label and the brand line.
  const headlineBase = headline.length < 40 ? 68 : headline.length < 80 ? 56 : 44
  const top = edge + 40
  const bottom = CANVAS_SIZE - edge - 48
  const stack = fitTextStack([
    { texts: [headline], baseSize: headlineBase, charsAtBase: isCover ? 20 : 18, maxLinesEach: 4, lineHeightMult: 1.18, gapBefore: 0, kind: "headline", maxWidthPx: CANVAS_SIZE - 2 * 90 },
    { texts: [body], baseSize: 32, charsAtBase: 42, maxLinesEach: 8, lineHeightMult: 1.5, gapBefore: 40, kind: "body", maxWidthPx: CANVAS_SIZE - 2 * edge },
  ], bottom - top)
  const [head, bodyBlock] = stack.blocks as [FittedBlock, FittedBlock]
  const blockStartY = clampBlockTop(CANVAS_SIZE / 2, stack.height, top, bottom)
  const headlineSvg = textLines(head.lines.flat(), blockStartY + head.fontSize * 0.85, head.lineHeight, head.fontSize, headlineColor, 800)
  const bodyStartY = blockStartY + head.height + bodyBlock.gap + bodyBlock.fontSize * 0.85
  const bodySvg = textLines(bodyBlock.lines.flat(), bodyStartY, bodyBlock.lineHeight, bodyBlock.fontSize, bodyColor, 400)

  const seriesSvg = isCover
    ? `<text x="90" y="${Math.max(edge + 18, blockStartY - 40)}" font-family="CarouselFont, sans-serif" font-weight="400" font-size="18" fill="rgba(255,255,255,0.6)">${escapeXml(`${total}-PART SERIES`)}</text>`
    : ""

  return { svg: `<svg width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" xmlns="http://www.w3.org/2000/svg">${bg}${isCover ? swipeSvg : numSvg}${seriesSvg}${headlineSvg}${bodySvg}${brandSvg}</svg>`, overflow: stack.overflow }
}

// The plain (Autopilot) slide with a content-matched layout: same brand
// gradient / white background and corner labels, text from the shared plan.
function buildLayoutSlideSvg(params: SlideRenderParams, stamped: TextLayoutFields & { headline: string }, heading: FontId): { svg: string; overflow: boolean } {
  const { index, total, isCover, isLast, primary, secondary } = params
  const useGradient = isCover || isLast
  const bg = useGradient
    ? `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${primary}"/><stop offset="100%" stop-color="${secondary}"/></linearGradient></defs><rect width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" fill="url(#bg)"/>`
    : `<rect width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" fill="#ffffff"/>`
  const body = defaultBodyFont(heading)
  const content = index > 0 && !isLast ? index : null
  const plan = planTextLayout({
    layout: stamped.text_layout!,
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
    content: { headline: stamped.headline, kicker: stamped.kicker, highlight: stamped.highlight, subtext: params.body || null, number: content },
    fonts: { heading, body },
    baseColors: useGradient ? { text: "#ffffff", sub: "rgba(255,255,255,0.85)" } : { text: primary, sub: "#555555" },
    // The split panel / accents use the colour the slide isn't already filled with.
    brandColor: useGradient ? secondary : primary,
    reserveBottom: 50,
  })
  const edge = Math.round(CANVAS_SIZE * SAFE_EDGE_RATIO)
  const labelColor = useGradient ? "rgba(255,255,255,0.6)" : "#bbbbbb"
  const corner = isCover
    // The arrow is drawn, not a glyph -- the body face's Latin subset has no U+2192.
    ? `<text x="${CANVAS_SIZE - edge - 34}" y="${edge + 6}" text-anchor="end" font-family="${familyAttr(body)}" font-weight="400" font-size="20" fill="${labelColor}">SWIPE</text><path d="M ${CANVAS_SIZE - edge - 26} ${edge} h 24 m -8 -7 l 8 7 l -8 7" fill="none" stroke="${labelColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<text x="${CANVAS_SIZE - edge}" y="${edge + 6}" text-anchor="end" font-family="${familyAttr(body)}" font-weight="400" font-size="22" fill="${labelColor}">${index + 1} / ${total}</text>`
  const brandName = sanitizeTextForCompositing(params.brandName)
  const brandSvg = `<text x="50%" y="${CANVAS_SIZE - edge}" text-anchor="middle" font-family="${familyAttr(body)}" font-weight="400" font-size="22" fill="${labelColor}">${escapeXml(brandName.toUpperCase())}</text>`
  return {
    svg: `<svg width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" xmlns="http://www.w3.org/2000/svg">${bg}${corner}${layoutPrimsToSvg(plan.prims, svgFamilies(FONT_FAMILY_NAME, { heading, body }))}${brandSvg}</svg>`,
    overflow: plan.overflow,
  }
}

export interface RenderCarouselSlidesOptions {
  brand: BrandRow
  coverHook: string
  slides: CarouselSlide[]
  /** The brand's heading font (lib/design/fonts.ts resolveTypography); omitted = DEFAULT_FONT_ID. */
  fontId?: FontId
  /** Content-matched layouts (lib/design/text-layouts.ts), auto-picked per
   * slide with the slides' kicker / highlight. Omitted = the original layout. */
  autoLayouts?: boolean
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
  return (await renderCarouselSlides(options)).map((r) => r.png)
}

/** renderCarouselSlidesToPng plus each slide's warnings ("text_overflow"). */
export async function renderCarouselSlides(options: RenderCarouselSlidesOptions): Promise<{ png: Buffer; warnings: SlideWarning[] }[]> {
  const { brand, coverHook, slides } = options
  if (slides.length === 0) return []

  const primary = getPrimaryColor(brand)
  const secondary = getSecondaryColor(brand)
  const brandName = brand.name
  const total = slides.length
  // Plain Autopilot slides have no per-slide font_id field (font pickers
  // only exist on CarouselBuilder.tsx's rich manual flow below) -- always
  // DEFAULT_FONT_ID, unchanged from this renderer's pre-existing behavior.
  const fontPath = await getFontPath(options.fontId ?? DEFAULT_FONT_ID)
  const heading = options.fontId ?? DEFAULT_FONT_ID
  const layouts = options.autoLayouts
    ? stampSequenceLayouts(slides.map((s, i) => ({
        type: i === 0 ? "cover" : i === slides.length - 1 ? "cta" : "content",
        headline: i === 0 ? coverHook : s.headline,
        kicker: s.kicker,
        highlight: s.highlight,
      })), {
        format: "carousel", brand, headingFont: heading, accentColor: primary, headlineKey: "headline",
        toPick: (s) => ({ slideType: s.type as "cover" | "content" | "cta", role: s.type === "cover" ? "hook" : s.type === "cta" ? "cta" : null }),
      })
    : null

  return Promise.all(
    slides.map(async (slide, i) => {
      const isCover = i === 0
      const isLast = i === slides.length - 1
      const stamped = layouts?.[i]
      if (stamped?.text_layout) {
        const svg = buildLayoutSlideSvg({ index: i, total, isCover, isLast, headline: stamped.headline, body: isCover ? "" : slide.body, brandName, primary, secondary }, stamped, heading)
        return { png: await svgToRichPngBuffer(svg.svg, heading, defaultBodyFont(heading)), warnings: svg.overflow ? [TEXT_OVERFLOW_WARNING] : [] }
      }

      const { svg, overflow } = buildSlideSvg({
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
      return { png: Buffer.from(resvg.render().asPng()), warnings: overflow ? [TEXT_OVERFLOW_WARNING] : [] }
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
  /** Which curated font (lib/design/fonts.ts) renders this slide's text --
   * falls back to DEFAULT_FONT_ID (Anton, this renderer's pre-existing
   * sole font) when absent, so behavior doesn't silently change for any
   * slide saved before this field existed. */
  font_id?: FontId | null
  /** Body font (subtext/points/poll/CTA lines) -- the brand's body face
   * (lib/design/fonts.ts resolveTypography). Absent = font_id for all text. */
  body_font_id?: FontId | null
  /** Uniform multiplier applied to every font size this slide renders --
   * 1.0 (default) reproduces the pre-existing fixed sizes exactly; the
   * shared layout (layoutCarouselText) scales the wrap budget inversely. */
  text_size_scale?: number | null
  /** Computed once from image_url where it was generated (lib/image/
   * text-contrast.ts). Absent = the old fixed gradient scrim + white text. */
  text_style?: TextStyle | null
  /** Content-matched layout (lib/design/text-layouts.ts) + its kicker /
   * highlight. Absent = this file's original centered layout, unchanged. */
  text_layout?: TextLayoutFields["text_layout"]
  kicker?: string | null
  highlight?: string | null
  /** The brand colour layouts use for accents and the split panel. */
  accent_color?: string | null
}

/** Priority matches SlidePreview exactly: an AI photo beats a custom
 * color/gradient, which beats the named background_style. Photo and
 * custom-color both get a scrim; presets never do. A photo with a
 * text_style gets that style's uniform scrim and text color instead of the
 * fixed gradient (`styled` tells the overlay to honour needs_backing). */
async function buildRichBackgroundLayer(slide: CarouselCompositeSlide, scrimmed = true): Promise<{ buffer: Buffer; textColor: string; subtextColor: string; styled: TextStyle | null }> {
  const preset = RICH_BG_PRESETS[slide.background_style ?? ""] ?? RICH_BG_PRESETS[RICH_DEFAULT_PRESET]!
  const customColors = (slide.custom_background_colors ?? []).filter(Boolean)

  if (slide.image_url) {
    const photo = await fetchRichImageBuffer(slide.image_url)
    if (photo) {
      const base = await sharp(photo).resize(RICH_CANVAS_WIDTH, RICH_CANVAS_HEIGHT, { fit: "cover" }).png().toBuffer()
      // No text in any of this function's SVGs (pure background shapes) --
      // the font choice is inconsequential here, DEFAULT_FONT_ID just needs
      // to point at a font file that's guaranteed to exist.
      const style = slide.text_style ?? null
      const palette = style ? TEXT_STYLE_PALETTE[style.text_color] : null
      const scrim = style && palette
        ? `<rect width="${RICH_CANVAS_WIDTH}" height="${RICH_CANVAS_HEIGHT}" fill="rgb(${palette.scrimRgb})" fill-opacity="${style.scrim_opacity}"/>`
        : RICH_SCRIM_SVG
      // A layout with its own card/panel backing (scrimmed = false) keeps the photo clean.
      const scrimPng = await svgToRichPngBuffer(`<svg width="${RICH_CANVAS_WIDTH}" height="${RICH_CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">${scrimmed ? scrim : ""}</svg>`, DEFAULT_FONT_ID)
      const buffer = await sharp(base).composite([{ input: scrimPng, top: 0, left: 0 }]).png().toBuffer()
      if (style && palette) return { buffer, textColor: palette.text, subtextColor: palette.sub, styled: style }
      return { buffer, textColor: "#ffffff", subtextColor: "rgba(255,255,255,0.7)", styled: null }
    }
    // Photo failed to fetch -- fall through to custom color / preset
    // rather than leaving the slide with no background at all.
  }

  if (customColors.length > 0) {
    const svg = `<svg width="${RICH_CANVAS_WIDTH}" height="${RICH_CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">${richCustomBackgroundFill(customColors)}${scrimmed ? RICH_SCRIM_SVG : ""}</svg>`
    const buffer = await svgToRichPngBuffer(svg, DEFAULT_FONT_ID)
    return { buffer, textColor: "#ffffff", subtextColor: "rgba(255,255,255,0.7)", styled: null }
  }

  const [c1, c2, c3] = preset.stops
  const svg = `<svg width="${RICH_CANVAS_WIDTH}" height="${RICH_CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="richPreset" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${c1}"/><stop offset="50%" stop-color="${c2}"/><stop offset="100%" stop-color="${c3}"/></linearGradient></defs><rect width="${RICH_CANVAS_WIDTH}" height="${RICH_CANVAS_HEIGHT}" fill="url(#richPreset)"/></svg>`
  const buffer = await svgToRichPngBuffer(svg, DEFAULT_FONT_ID)
  return { buffer, textColor: preset.text, subtextColor: preset.subtext, styled: null }
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
      return { input: resized, top: RICH_CANVAS_HEIGHT - h - Math.round(RICH_CANVAS_HEIGHT * 0.074), left: RICH_CANVAS_WIDTH - w - Math.round(RICH_CANVAS_WIDTH * SAFE_EDGE_RATIO) }
    }
    if (slide.type === "content") {
      const size = Math.round(RICH_CANVAS_WIDTH * 0.22)
      const resized = await sharp(photo).resize(size, size, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0.12 } }).png().toBuffer()
      return { input: resized, top: Math.round(RICH_CANVAS_HEIGHT * SAFE_EDGE_RATIO), left: RICH_CANVAS_WIDTH - size - Math.round(RICH_CANVAS_WIDTH * SAFE_EDGE_RATIO) }
    }
    // cta
    const size = Math.round(RICH_CANVAS_WIDTH * 0.36)
    const resized = await sharp(photo).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
    return { input: resized, top: Math.round(RICH_CANVAS_HEIGHT * SAFE_EDGE_RATIO), left: Math.round((RICH_CANVAS_WIDTH - size) / 2) }
  } catch {
    return null
  }
}

// The real family name for an SVG font-family attribute -- needed once a
// heading AND a body font are loaded, so each element names its own.
function familyAttr(fontId: string): string {
  return `'${FONT_FAMILY_NAME[fontId as FontId] ?? FONT_FAMILY_NAME[DEFAULT_FONT_ID]}', sans-serif`
}

async function svgToRichPngBuffer(svg: string, fontId: string, bodyFontId?: string): Promise<Buffer> {
  const fontFiles = [...new Set([await getFontPath(fontId), ...(bodyFontId ? [await getFontPath(bodyFontId)] : [])])]
  const resvg = new Resvg(svg, {
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: FONT_FAMILY_NAME[fontId as FontId] ?? "CarouselFont" },
  })
  return Buffer.from(resvg.render().asPng())
}

function buildRichTextOverlaySvg(slide: CarouselCompositeSlide, brandName: string, textColor: string, subtextColor: string, backing: TextStyle | null): { svg: string; overflow: boolean } {
  // Sanitized right here, before any length-based sizing/wrapping below or
  // a <text> element uses these -- see sanitize-text-for-compositing.ts's
  // own comment for why this is the only place in the pipeline this runs.
  const headline = sanitizeTextForCompositing(slide.headline)
  const subtext = slide.subtext ? sanitizeTextForCompositing(slide.subtext) : slide.subtext
  const points = slide.points?.map((p) => sanitizeTextForCompositing(p))
  const ctaText = slide.ctaText ? sanitizeTextForCompositing(slide.ctaText) : slide.ctaText
  const ctaHandle = slide.ctaHandle ? sanitizeTextForCompositing(slide.ctaHandle) : slide.ctaHandle
  const brandNameText = sanitizeTextForCompositing(brandName)
  const headFamily = familyAttr(slide.font_id ?? DEFAULT_FONT_ID)
  const bodyFamily = familyAttr(slide.body_font_id ?? slide.font_id ?? DEFAULT_FONT_ID)

  // Sizes, wrapping (no dropped words), the safe-area clamp and the
  // overflow flag all come from the shared layout -- the builder's
  // "text is long" notice runs the same function.
  const layout = layoutCarouselText({ ...slide, headline, subtext, points, ctaText, ctaHandle })
  const centerX = layout.centerX
  const centerXAttr = `${centerX}%`

  let cursorY = layout.blockTop
  const block = (b: FittedBlock, color: string, weight: number, family: string): string => {
    cursorY += b.gap
    const lines = b.lines.flat()
    const svg = lines.length > 0 ? textLines(lines, cursorY + b.fontSize * 0.85, b.lineHeight, b.fontSize, color, weight, centerXAttr, family) : ""
    cursorY += b.height
    return svg
  }

  const headlineSvg = block(layout.headline, textColor, 800, headFamily)
  const subtextSvg = block(layout.subtext, subtextColor, 500, bodyFamily)

  // Points render as left-aligned bullet lines (matching SlidePreview's
  // actual layout -- a dot + text row, not centered prose), anchored
  // under the same draggable text_position_x rather than the slide's
  // fixed left padding, so points move together with the rest of the
  // block when dragged. One dot per point, on its first line -- a point
  // that wraps continues under its own text, not as a second bullet.
  cursorY += layout.points.gap
  const p = layout.points
  let pointRow = 0
  const pointsSvg = p.lines.map((lines) => lines.map((line, li) => {
    const y = cursorY + pointRow++ * p.lineHeight + p.fontSize * 0.85
    const dot = li === 0 ? `<circle cx="${centerX - 21}%" cy="${y - p.fontSize * 0.35}" r="5" fill="#a78bfa"/>` : ""
    return `${dot}<text x="${centerX - 14}%" y="${y}" text-anchor="start" font-family="${bodyFamily}" font-weight="400" font-size="${p.fontSize}" fill="${subtextColor}">${escapeXml(line)}</text>`
  }).join("")).join("")
  cursorY += p.height

  const ctaTextSvg = block(layout.ctaText, subtextColor, 500, bodyFamily)
  const ctaHandleSvg = block(layout.ctaHandle, textColor, 700, bodyFamily)

  // Soft panel behind the whole text block when the photo under it is busy
  // (text_style.needs_backing) -- spans the centered lines and the bullets.
  let backingSvg = ""
  if (backing?.needs_backing) {
    const pad = 36
    const half = Math.max(estimateBlockWidth(layout.headline), estimateBlockWidth(layout.subtext), estimateBlockWidth(layout.ctaText), estimateBlockWidth(layout.ctaHandle)) / 2
    const cx = (centerX / 100) * RICH_CANVAS_WIDTH
    let left = cx - half
    let right = cx + half
    if (p.lines.length > 0) {
      left = Math.min(left, ((centerX - 21) / 100) * RICH_CANVAS_WIDTH - 10)
      right = Math.max(right, ((centerX - 14) / 100) * RICH_CANVAS_WIDTH + estimateBlockWidth(p))
    }
    const x = Math.max(0, left - pad)
    const w = Math.min(RICH_CANVAS_WIDTH, right + pad) - x
    backingSvg = `<rect x="${x}" y="${layout.blockTop - pad}" width="${w}" height="${layout.blockHeight + pad * 2}" rx="28" fill="${backingRgba(backing)}"/>`
  }

  // On the bottom safe edge, right-aligned at the side safe edge; the text
  // block is clamped above it by layoutCarouselText, so they never overlap.
  const brandSvg = brandNameText
    ? `<text x="${RICH_CANVAS_WIDTH * (1 - SAFE_EDGE_RATIO)}" y="${CAROUSEL_BRAND_BASELINE}" text-anchor="end" font-family="${bodyFamily}" font-weight="500" font-size="26" fill="${subtextColor}">${escapeXml(brandNameText)}</text>`
    : ""

  return {
    svg: `<svg width="${RICH_CANVAS_WIDTH}" height="${RICH_CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">${backingSvg}${headlineSvg}${subtextSvg}${pointsSvg}${ctaTextSvg}${ctaHandleSvg}${brandSvg}</svg>`,
    overflow: layout.overflow,
  }
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
  return (await renderRichCarouselSlides(brandName, slides)).map((r) => r.png)
}

/** renderRichCarouselSlidesToPng plus each slide's warnings ("text_overflow"). */
export async function renderRichCarouselSlides(brandName: string, slides: CarouselCompositeSlide[]): Promise<{ png: Buffer; warnings: SlideWarning[] }[]> {
  if (slides.length === 0) return []

  const steps = carouselStepNumbers(slides)
  return Promise.all(
    slides.map(async (slide, i) => {
      if (slide.text_layout) return renderLayoutSlide(brandName, slide, steps[i] ?? null)
      const { buffer: backgroundLayer, textColor, subtextColor, styled } = await buildRichBackgroundLayer(slide)

      const layers: { input: Buffer; top: number; left: number }[] = []

      const productLayer = await buildRichProductLayer(slide)
      if (productLayer) layers.push(productLayer)

      const overlay = buildRichTextOverlaySvg(slide, brandName, textColor, subtextColor, styled)
      const textOverlayPng = await svgToRichPngBuffer(overlay.svg, slide.font_id ?? DEFAULT_FONT_ID, slide.body_font_id ?? undefined)
      layers.push({ input: textOverlayPng, top: 0, left: 0 })

      const png = await sharp(backgroundLayer).composite(layers).png().toBuffer()
      return { png, warnings: overlay.overflow ? [TEXT_OVERFLOW_WARNING] : [] }
    })
  )
}

// A slide with a text_layout: the shared layout plan drawn over the same
// background layers (lib/design/text-layouts.ts).
async function renderLayoutSlide(brandName: string, slide: CarouselCompositeSlide, stepNumber: number | null): Promise<{ png: Buffer; warnings: SlideWarning[] }> {
  const photo = slide.image_url ? await fetchRichImageBuffer(slide.image_url) : null
  const plan = carouselSlidePlan(slide, stepNumber, !!photo)
  const { buffer: backgroundLayer } = await buildRichBackgroundLayer(photo ? slide : { ...slide, image_url: null }, plan.fullScrim)
  const layers: { input: Buffer; top: number; left: number }[] = []
  const productLayer = await buildRichProductLayer(slide)
  if (productLayer) layers.push(productLayer)
  const heading = slide.font_id ?? DEFAULT_FONT_ID
  const body = slide.body_font_id ?? heading
  const brandPrim = carouselBrandPrim(brandName, plan)
  const svg = `<svg width="${RICH_CANVAS_WIDTH}" height="${RICH_CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">${layoutPrimsToSvg(brandPrim ? [...plan.prims, brandPrim] : plan.prims, svgFamilies(FONT_FAMILY_NAME, { heading, body }))}</svg>`
  layers.push({ input: await svgToRichPngBuffer(svg, heading, body), top: 0, left: 0 })
  const png = await sharp(backgroundLayer).composite(layers).png().toBuffer()
  return { png, warnings: plan.overflow ? [TEXT_OVERFLOW_WARNING] : [] }
}
