import sharp from "sharp"
import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { Resvg } from "@resvg/resvg-js"
import { decompress } from "wawoff2"
import * as fontkit from "fontkit"
import type { PostTemplateId } from "@/lib/design/post-templates"
import type { ColorTheme } from "@/lib/design/color-themes"

const CANVAS_SIZE = 1080

// Headline text never shrinks below this, no matter how long the input —
// it's the "absolute last resort" floor fitText() stops at; anything that
// still doesn't fit at this size gets truncated (see fitText below), but
// only there, never earlier.
const MIN_HEADLINE_FONT_SIZE = 28

// Same cached-TTF pattern as lib/image/meme-compositor.ts — resvg-js's font
// loader only accepts raw TrueType/OpenType, not woff2, so the bundled
// @fontsource/anton woff2 is decompressed to a TTF once and cached in /tmp
// across warm serverless invocations. Deliberately reuses the same font as
// memes rather than adding new font families (see project decision).
let cachedFontPath: string | null = null

async function getFontPath(): Promise<string> {
  if (cachedFontPath && existsSync(cachedFontPath)) return cachedFontPath

  const woff2Path = join(process.cwd(), "node_modules/@fontsource/anton/files/anton-latin-400-normal.woff2")
  const ttfBuffer = await decompress(readFileSync(woff2Path))

  const ttfPath = join(tmpdir(), "post-compositor-anton.ttf")
  writeFileSync(ttfPath, ttfBuffer)
  cachedFontPath = ttfPath
  return ttfPath
}

// Parsed once and cached alongside the raw TTF path above — resvg needs the
// file path to rasterize, fitText/measureTextWidth need the parsed font to
// measure real glyph advance widths (see FIX 1: wrapText used to estimate
// wrapping via a fixed characters-per-line budget, which had no idea how
// wide Anton's glyphs actually render and would silently drop whole lines
// of headline text that didn't fit that guess).
let cachedFont: fontkit.Font | null = null

async function getFont(): Promise<fontkit.Font> {
  if (cachedFont) return cachedFont
  const ttfPath = await getFontPath()
  // @fontsource/anton's file is a plain .ttf, never a collection, so this
  // is always a single Font, not a FontCollection.
  cachedFont = fontkit.openSync(ttfPath) as fontkit.Font
  return cachedFont
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

// Real pixel width of `text` set in `font` at `fontSize`, via the font's
// actual shaped glyph advances (kerning included) — not an estimate.
function measureTextWidth(font: fontkit.Font, text: string, fontSize: number): number {
  if (!text) return 0
  const run = font.layout(text)
  const unitsWide = run.positions.reduce((sum, p) => sum + p.xAdvance, 0)
  return unitsWide * (fontSize / font.unitsPerEm)
}

// Grapheme-cluster split (not raw UTF-16 code units) so a hard character
// break never lands mid-emoji or mid-combining-character — Intl.Segmenter
// is available in the Node runtime this compositor already targets.
function graphemes(text: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })
    return Array.from(segmenter.segment(text), (s) => s.segment)
  }
  return Array.from(text)
}

// Last-resort hard break for a single "word" that's still wider than
// maxWidthPx even alone — a long hashtag, URL, or a script with no
// whitespace break points (CJK, Thai). Only ever called on a line that's
// already been through wrapTextByWidth and confirmed too wide, at the
// font-size floor (see fitText below) — never used as the first choice.
function breakLineToWidth(font: fontkit.Font, line: string, fontSize: number, maxWidthPx: number): string[] {
  if (measureTextWidth(font, line, fontSize) <= maxWidthPx) return [line]
  const chars = graphemes(line)
  const pieces: string[] = []
  let current = ""
  for (const ch of chars) {
    const candidate = current + ch
    if (current && measureTextWidth(font, candidate, fontSize) > maxWidthPx) {
      pieces.push(current)
      current = ch
    } else {
      current = candidate
    }
  }
  if (current) pieces.push(current)
  return pieces.length > 0 ? pieces : [line]
}

// Greedy word-wrap against a real max pixel width instead of an estimated
// character count. Never drops words — every word ends up on some line
// (even a single word wider than maxWidthPx gets its own line rather than
// being split or dropped here — fitText below is what forces a hard break
// on that line if it's still too wide once the font-size floor is hit).
function wrapTextByWidth(font: fontkit.Font, text: string, fontSize: number, maxWidthPx: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [""]
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (current && measureTextWidth(font, candidate, fontSize) > maxWidthPx) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines
}

interface FitTextOptions {
  startFontSize: number
  minFontSize: number
  lineHeightMultiplier: number
  maxWidthPx: number
  /** Only used to derive the available block-height budget below (as
   * `maxLines * startFontSize * lineHeightMultiplier`) — the fit loop
   * itself compares against that height, not a hardcoded line count, so a
   * long headline that needs more lines than this at a smaller font size
   * can still fit if it stays within the same vertical space. */
  maxLines: number
  shrinkFactor?: number
}

interface FitTextResult {
  lines: string[]
  fontSize: number
  lineHeight: number
  blockHeight: number
}

/**
 * Auto-fit loop (FIX 1, revised): tries `startFontSize`, wraps by real
 * measured width, and shrinks the font ~10% and re-wraps — repeating down
 * to `minFontSize` — until BOTH the wrapped block fits the template's
 * height budget AND every wrapped line's rendered width actually fits
 * maxWidthPx. That second check matters because wrapTextByWidth never
 * splits a single overlong "word" (a long hashtag, URL, or a
 * whitespace-free script) — without it, a one-line headline could pass
 * the height check while still rendering wider than the canvas and
 * getting cropped at the SVG edge. Only at the font-size floor, and only
 * if a line is still too wide even then, does this force a hard
 * character-level break on that line (breakLineToWidth) — better a break
 * than an off-canvas crop. No headline content is ever silently dropped.
 */
function fitText(font: fontkit.Font, text: string, opts: FitTextOptions): FitTextResult {
  const shrinkFactor = opts.shrinkFactor ?? 0.9
  const maxBlockHeightPx = opts.maxLines * opts.startFontSize * opts.lineHeightMultiplier

  let fontSize = opts.startFontSize
  for (;;) {
    const lines = wrapTextByWidth(font, text, fontSize, opts.maxWidthPx)
    const lineHeight = fontSize * opts.lineHeightMultiplier
    const blockHeight = lines.length * lineHeight
    const atFloor = fontSize <= opts.minFontSize
    const widestLinePx = lines.reduce((max, l) => Math.max(max, measureTextWidth(font, l, fontSize)), 0)
    const fitsWidth = widestLinePx <= opts.maxWidthPx

    if ((blockHeight <= maxBlockHeightPx && fitsWidth) || atFloor) {
      let finalLines = lines
      if (atFloor && !fitsWidth) {
        finalLines = finalLines.flatMap((line) => breakLineToWidth(font, line, fontSize, opts.maxWidthPx))
      }
      const maxLinesAtFloor = Math.max(1, Math.floor(maxBlockHeightPx / lineHeight))
      if (atFloor && finalLines.length > maxLinesAtFloor) {
        finalLines = finalLines.slice(0, maxLinesAtFloor)
      }
      return { lines: finalLines, fontSize, lineHeight, blockHeight: finalLines.length * lineHeight }
    }

    fontSize = Math.max(opts.minFontSize, Math.round(fontSize * shrinkFactor))
  }
}

/**
 * CTA text through the exact same real-width-measuring fit logic as
 * headlines (FIX 1) — previously every template either used a
 * character-count heuristic for a pill's width (bold_statement) or had no
 * width bound on CTA text at all (product_focus/quote_card/minimal), so a
 * CTA anywhere near the 60-char input max would overflow the canvas or its
 * own background. `maxLines: 1` keeps it single-line whenever it fits —
 * wrapTextByWidth (inside fitText) will still return a 2nd line rather
 * than overflow if a full 60-char CTA doesn't fit even at the font floor.
 */
function fitCtaText(font: fontkit.Font, ctaText: string, maxWidthPx: number, startFontSize: number, minFontSize: number): FitTextResult {
  return fitText(font, ctaText, {
    startFontSize,
    minFontSize,
    lineHeightMultiplier: 1.15,
    maxWidthPx,
    maxLines: 1,
  })
}

// A thin dark stroke behind white text guarantees legibility regardless of
// what's directly under it — the scrims below handle the general case, this
// is the safety net for edge cases (a brand-color band that turns out to be
// light, a scrim gradient's lighter edge, etc). Much thinner than the meme
// compositor's thick outline — this reads as "readable," not "meme."
function textEl(x: string, y: number, anchor: string, fontSize: number, text: string, weight = 900): string {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="PostFont, sans-serif" font-weight="${weight}" font-size="${fontSize}" fill="#ffffff" stroke="#000000" stroke-opacity="0.5" stroke-width="2.5" paint-order="stroke" letter-spacing="0.5">${escapeXml(text)}</text>`
}

interface OverlayResult {
  svg: string
  logoBox: { x: number; y: number; size: number } | null
}

function buildBoldStatement(headline: string, cta: string, theme: ColorTheme, font: fontkit.Font): OverlayResult {
  const { lines, fontSize, lineHeight, blockHeight } = fitText(font, headline.toUpperCase(), {
    startFontSize: 92,
    minFontSize: MIN_HEADLINE_FONT_SIZE,
    lineHeightMultiplier: 1.12,
    maxWidthPx: 960,
    maxLines: 3,
  })
  const startY = 760 - blockHeight / 2 + fontSize * 0.8

  const headlineSvg = lines.map((line, i) => textEl("50%", startY + i * lineHeight, "middle", fontSize, line)).join("")

  const ctaCenterY = startY + lines.length * lineHeight + 70
  const ctaText = cta.toUpperCase()
  // Inner text budget for a pill capped at 900px total width (90px margin
  // either side of the 1080px canvas), minus 80px of horizontal padding.
  const ctaFit = fitCtaText(font, ctaText, 820, 32, 20)
  const widestCtaLinePx = ctaFit.lines.reduce((max, l) => Math.max(max, measureTextWidth(font, l, ctaFit.fontSize)), 0)
  const ctaPillWidth = Math.min(900, Math.max(160, widestCtaLinePx + 80))
  const ctaPillHeight = Math.max(72, ctaFit.blockHeight + 32)
  const ctaPillTop = ctaCenterY - ctaPillHeight / 2
  const ctaFirstBaseline = ctaPillTop + (ctaPillHeight - ctaFit.blockHeight) / 2 + ctaFit.fontSize * 0.8
  const ctaSvg = ctaFit.lines
    .map((line, i) => textEl("50%", ctaFirstBaseline + i * ctaFit.lineHeight, "middle", ctaFit.fontSize, line))
    .join("")

  const svg = `
    <defs>
      <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.78"/>
      </linearGradient>
    </defs>
    <rect x="0" y="460" width="${CANVAS_SIZE}" height="${CANVAS_SIZE - 460}" fill="url(#scrim)"/>
    ${headlineSvg}
    <rect x="${CANVAS_SIZE / 2 - ctaPillWidth / 2}" y="${ctaPillTop}" width="${ctaPillWidth}" height="${ctaPillHeight}" rx="${ctaPillHeight / 2}" fill="${theme.primary}"/>
    ${ctaSvg}
    <circle cx="106" cy="106" r="50" fill="#ffffff" fill-opacity="0.92"/>
  `
  return { svg, logoBox: { x: 66, y: 66, size: 80 } }
}

function buildProductFocus(headline: string, cta: string, theme: ColorTheme, font: fontkit.Font): OverlayResult {
  const { lines, fontSize, lineHeight } = fitText(font, headline.toUpperCase(), {
    startFontSize: 62,
    minFontSize: MIN_HEADLINE_FONT_SIZE,
    lineHeightMultiplier: 1.15,
    maxWidthPx: 960,
    maxLines: 2,
  })
  const bandTop = 800
  const headlineY = bandTop - 40 - (lines.length - 1) * lineHeight

  const headlineSvg = lines.map((line, i) => textEl("50%", headlineY + i * lineHeight, "middle", fontSize, line)).join("")
  const ctaText = cta.toUpperCase()

  // Right-anchored zone in the bottom band, leaving room for the logo
  // circle on the left (centered at x=71, r=42) — real width budget
  // instead of letting an unbound right-aligned string grow left forever.
  const ctaMaxWidthPx = 680
  const ctaFit = fitCtaText(font, ctaText, ctaMaxWidthPx, 34, 18)
  const ctaAnchorY = bandTop + (CANVAS_SIZE - bandTop) / 2 + 12
  const ctaFirstLineY = ctaAnchorY - (ctaFit.lines.length - 1) * ctaFit.lineHeight
  const ctaSvg = ctaFit.lines
    .map((line, i) => textEl(`${CANVAS_SIZE - 60}`, ctaFirstLineY + i * ctaFit.lineHeight, "end", ctaFit.fontSize, line))
    .join("")

  const svg = `
    <defs>
      <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.55"/>
      </linearGradient>
    </defs>
    <rect x="0" y="580" width="${CANVAS_SIZE}" height="${bandTop - 580}" fill="url(#scrim)"/>
    ${headlineSvg}
    <rect x="0" y="${bandTop}" width="${CANVAS_SIZE}" height="${CANVAS_SIZE - bandTop}" fill="${theme.primary}"/>
    <rect x="0" y="${bandTop}" width="${CANVAS_SIZE}" height="${CANVAS_SIZE - bandTop}" fill="#000000" fill-opacity="0.12"/>
    <circle cx="106" cy="${bandTop + (CANVAS_SIZE - bandTop) / 2}" r="42" fill="#ffffff" fill-opacity="0.92"/>
    ${ctaSvg}
  `
  return { svg, logoBox: { x: 71, y: bandTop + (CANVAS_SIZE - bandTop) / 2 - 35, size: 70 } }
}

function buildQuoteCard(headline: string, cta: string, theme: ColorTheme, font: fontkit.Font): OverlayResult {
  const { lines, fontSize, lineHeight, blockHeight } = fitText(font, headline, {
    startFontSize: 72,
    minFontSize: MIN_HEADLINE_FONT_SIZE,
    lineHeightMultiplier: 1.2,
    maxWidthPx: 940,
    maxLines: 3,
  })
  const startY = CANVAS_SIZE / 2 - blockHeight / 2 + fontSize * 0.75

  const headlineSvg = lines.map((line, i) => textEl("50%", startY + i * lineHeight, "middle", fontSize, line, 700)).join("")
  const ctaText = cta.toUpperCase()

  // Narrow zone (start x=560, canvas edge ~1040) is the tightest CTA budget
  // of any template — real fitting matters most here. Grows upward from
  // the original anchor (last line stays at the old baseline) rather than
  // further off the bottom edge if 2 lines are needed, and the bottom bar
  // grows tall enough to actually contain whatever comes out.
  const ctaFit = fitCtaText(font, ctaText, 460, 26, 16)
  const ctaBarHeight = Math.max(130, ctaFit.blockHeight + 60)
  const ctaBaseY = CANVAS_SIZE - 55
  const ctaSvg = ctaFit.lines
    .map((line, i) => textEl(`${CANVAS_SIZE / 2 + 20}`, ctaBaseY - (ctaFit.lines.length - 1 - i) * ctaFit.lineHeight, "start", ctaFit.fontSize, line))
    .join("")

  const svg = `
    <rect x="0" y="0" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" fill="#000000" fill-opacity="0.38"/>
    <text x="90" y="${startY - blockHeight - 20}" font-family="PostFont, sans-serif" font-weight="900" font-size="220" fill="${theme.secondary}" fill-opacity="0.5">&#8220;</text>
    ${headlineSvg}
    <rect x="0" y="${CANVAS_SIZE - ctaBarHeight}" width="${CANVAS_SIZE}" height="${ctaBarHeight}" fill="#000000" fill-opacity="0.3"/>
    <circle cx="${CANVAS_SIZE / 2 - 90}" cy="${CANVAS_SIZE - 65}" r="30" fill="#ffffff" fill-opacity="0.9"/>
    ${ctaSvg}
  `
  return { svg, logoBox: { x: CANVAS_SIZE / 2 - 120, y: CANVAS_SIZE - 95, size: 60 } }
}

function buildMinimal(headline: string, cta: string, theme: ColorTheme, font: fontkit.Font): OverlayResult {
  const padX = 70
  const { lines, fontSize, lineHeight, blockHeight } = fitText(font, headline.toUpperCase(), {
    startFontSize: 54,
    minFontSize: MIN_HEADLINE_FONT_SIZE,
    lineHeightMultiplier: 1.15,
    maxWidthPx: CANVAS_SIZE - padX - 60,
    maxLines: 2,
  })
  const ctaText = cta.toUpperCase()
  const ctaFit = fitCtaText(font, ctaText, CANVAS_SIZE - padX - 60, 24, 16)

  // Box height built up from its actual content (bar, headline block, CTA
  // block, padding) rather than a fixed guess — avoids the accent bar or
  // CTA colliding with the headline when line count/font size vary, on
  // either the headline or (now) the CTA.
  const topPad = 40
  const barHeight = 4
  const gapBarToHeadline = 30
  const gapHeadlineToCta = 26
  const bottomPad = 34

  const headlineTop = topPad + barHeight + gapBarToHeadline
  const headlineFirstBaseline = headlineTop + fontSize * 0.8
  const ctaFirstBaseline = headlineTop + blockHeight + gapHeadlineToCta + ctaFit.fontSize * 0.8
  const boxHeight = ctaFirstBaseline + (ctaFit.lines.length - 1) * ctaFit.lineHeight + bottomPad
  const boxY = CANVAS_SIZE - boxHeight

  const headlineSvg = lines
    .map((line, i) => textEl(`${padX}`, boxY + headlineFirstBaseline + i * lineHeight, "start", fontSize, line))
    .join("")
  const ctaSvg = ctaFit.lines
    .map((line, i) => textEl(`${padX}`, boxY + ctaFirstBaseline + i * ctaFit.lineHeight, "start", ctaFit.fontSize, line, 700))
    .join("")

  const svg = `
    <rect x="0" y="${boxY}" width="${CANVAS_SIZE}" height="${boxHeight}" fill="#000000" fill-opacity="0.42"/>
    <rect x="${padX}" y="${boxY + topPad}" width="52" height="${barHeight}" fill="${theme.primary}"/>
    ${headlineSvg}
    ${ctaSvg}
    <rect x="${CANVAS_SIZE - 130}" y="50" width="70" height="70" rx="12" fill="#ffffff" fill-opacity="0.9"/>
  `
  return { svg, logoBox: { x: CANVAS_SIZE - 122, y: 58, size: 54 } }
}

async function fetchLogoBuffer(logoUrl: string): Promise<Buffer | null> {
  try {
    const res = await fetch(logoUrl)
    if (!res.ok) return null
    return Buffer.from(await res.arrayBuffer())
  } catch {
    return null
  }
}

export interface CompositePostImageOptions {
  template: PostTemplateId
  colorTheme: ColorTheme
  headline: string
  ctaText: string
  logoUrl: string | null
}

/**
 * Overlays brand logo, headline, a brand-color accent, and CTA text onto a
 * base (Pollinations-generated) image, per the chosen template's layout.
 * Same pipeline as lib/image/meme-compositor.ts: build an SVG for the
 * vector/text elements, rasterize via resvg, composite over the base image
 * with sharp. `template === "blank"` skips all of this and returns the
 * base image untouched (the "Blank/Custom" option). Logo is composited as
 * its own raster layer rather than embedded in the SVG, to avoid resvg's
 * raster-image-in-SVG handling entirely — a plain sharp resize+composite
 * is simpler and more predictable.
 */
export async function compositePostImage(
  baseImageBuffer: Buffer,
  options: CompositePostImageOptions
): Promise<Buffer> {
  if (options.template === "blank") {
    return sharp(baseImageBuffer).png().toBuffer()
  }

  const headline = options.headline.trim()
  const ctaText = options.ctaText.trim() || "Shop now"

  const builder =
    options.template === "bold_statement" ? buildBoldStatement :
    options.template === "product_focus" ? buildProductFocus :
    options.template === "quote_card" ? buildQuoteCard :
    buildMinimal

  const font = await getFont()
  const { svg: overlaySvg, logoBox } = builder(headline, ctaText, options.colorTheme, font)
  const svg = `<svg width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" xmlns="http://www.w3.org/2000/svg">${overlaySvg}</svg>`

  const fontPath = await getFontPath()
  const resvg = new Resvg(svg, {
    font: {
      fontFiles: [fontPath],
      loadSystemFonts: false,
      defaultFontFamily: "PostFont",
    },
  })
  const overlayPng = resvg.render().asPng()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layers: any[] = [{ input: overlayPng, top: 0, left: 0 }]

  if (options.logoUrl && logoBox) {
    const logoBuffer = await fetchLogoBuffer(options.logoUrl)
    if (logoBuffer) {
      try {
        const resizedLogo = await sharp(logoBuffer)
          .resize(logoBox.size, logoBox.size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png()
          .toBuffer()
        layers.push({ input: resizedLogo, top: Math.round(logoBox.y), left: Math.round(logoBox.x) })
      } catch {
        // Malformed/unreadable logo file — skip it rather than fail the
        // whole composite over a decorative element.
      }
    }
  }

  return sharp(baseImageBuffer)
    .resize(CANVAS_SIZE, CANVAS_SIZE, { fit: "cover" })
    .composite(layers)
    .png()
    .toBuffer()
}
