import sharp from "sharp"
import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { Resvg } from "@resvg/resvg-js"
import { decompress } from "wawoff2"
import * as fontkit from "fontkit"
import type { PostTemplateId } from "@/lib/design/post-templates"
import type { ColorTheme } from "@/lib/design/color-themes"
import { CURATED_FONTS, DEFAULT_FONT_ID, findFont } from "@/lib/design/fonts"
import { sanitizeTextForCompositing } from "@/lib/image/sanitize-text-for-compositing"

// Matches lib/ai/post-image-pipeline.ts's PORTRAIT_DIMENSIONS (4:5, the
// current Instagram feed default) — width unchanged from the old square
// canvas, only height grew. Every template's layout math below either
// already expresses vertical position relative to CANVAS_HEIGHT (so it
// adapts automatically) or, for the handful of genuinely hardcoded pixel
// anchors that weren't, has been proportionally rescaled by the same
// CANVAS_HEIGHT / 1080 ratio those anchors were originally tuned against.
// Fixed corner-margin decorations (logo badges anchored to a literal
// corner) are deliberately left as-is — they're edge margins, not content
// proportional to overall height, so they shouldn't scale with it.
const CANVAS_WIDTH = 1080
const CANVAS_HEIGHT = 1350

// Headline text never shrinks below this, no matter how long the input —
// it's the "absolute last resort" floor fitText() stops at; anything that
// still doesn't fit at this size gets truncated (see fitText below), but
// only there, never earlier.
const MIN_HEADLINE_FONT_SIZE = 28

// Same cached-TTF pattern as lib/image/meme-compositor.ts — resvg-js's font
// loader only accepts raw TrueType/OpenType, not woff2, so each curated
// @fontsource woff2 is decompressed to a TTF once and cached in /tmp across
// warm serverless invocations. Keyed by font id (was a single global when
// Anton was the only option) so all five curated fonts can be cached
// independently rather than each request evicting the last one.
const fontPathCache = new Map<string, string>()

async function getFontPath(fontId: string): Promise<string> {
  const cached = fontPathCache.get(fontId)
  if (cached && existsSync(cached)) return cached

  const font = findFont(CURATED_FONTS, fontId)
  const woff2Path = join(process.cwd(), `node_modules/@fontsource/${font.packageName}/files/${font.fileName}`)
  const ttfBuffer = await decompress(readFileSync(woff2Path))

  const ttfPath = join(tmpdir(), `post-compositor-${font.id}.ttf`)
  writeFileSync(ttfPath, ttfBuffer)
  fontPathCache.set(fontId, ttfPath)
  return ttfPath
}

// Parsed once per font and cached alongside the raw TTF path above — resvg
// needs the file path to rasterize, fitText/measureTextWidth need the
// parsed font to measure real glyph advance widths (see FIX 1: wrapText
// used to estimate wrapping via a fixed characters-per-line budget, which
// had no idea how wide a font's glyphs actually render and would silently
// drop whole lines of headline text that didn't fit that guess).
const fontCache = new Map<string, fontkit.Font>()

async function getFont(fontId: string): Promise<fontkit.Font> {
  const cached = fontCache.get(fontId)
  if (cached) return cached
  const ttfPath = await getFontPath(fontId)
  // Every curated @fontsource file here is a plain .ttf, never a
  // collection, so this is always a single Font, not a FontCollection.
  const font = fontkit.openSync(ttfPath) as fontkit.Font
  fontCache.set(fontId, font)
  return font
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

function buildBoldStatement(captionText: string, theme: ColorTheme, font: fontkit.Font, hasLogo: boolean, scale: number): OverlayResult {
  const { lines, fontSize, lineHeight, blockHeight } = fitText(font, captionText.toUpperCase(), {
    startFontSize: 92 * scale,
    minFontSize: MIN_HEADLINE_FONT_SIZE,
    lineHeightMultiplier: 1.12,
    maxWidthPx: 960,
    maxLines: 4,
  })
  // 950 = 760 * (CANVAS_HEIGHT / 1080) — proportionally rescaled from the
  // original square canvas's tuned anchor (see canvas-height comment above).
  // Still a sensible center within the scrim zone now that there's no CTA
  // pill anchored below it (one text block instead of two, per the
  // "one text box, only what's typed appears" redesign).
  const startY = 950 - blockHeight / 2 + fontSize * 0.8

  const textSvg = lines.map((line, i) => textEl("50%", startY + i * lineHeight, "middle", fontSize, line)).join("")

  const svg = `
    <defs>
      <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.78"/>
      </linearGradient>
    </defs>
    <rect x="0" y="575" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT - 575}" fill="url(#scrim)"/>
    ${textSvg}
    ${hasLogo ? `<circle cx="106" cy="106" r="50" fill="#ffffff" fill-opacity="0.92"/>` : ""}
  `
  return { svg, logoBox: { x: 66, y: 66, size: 80 } }
}

function buildProductFocus(captionText: string, theme: ColorTheme, font: fontkit.Font, hasLogo: boolean, scale: number): OverlayResult {
  const { lines, fontSize, lineHeight } = fitText(font, captionText.toUpperCase(), {
    startFontSize: 62 * scale,
    minFontSize: MIN_HEADLINE_FONT_SIZE,
    lineHeightMultiplier: 1.15,
    maxWidthPx: 960,
    maxLines: 3,
  })
  // 1000 = 800 * (CANVAS_HEIGHT / 1080) — proportionally rescaled from the
  // original square canvas's tuned anchor.
  const bandTop = 1000
  const textY = bandTop - 40 - (lines.length - 1) * lineHeight

  const textSvg = lines.map((line, i) => textEl("50%", textY + i * lineHeight, "middle", fontSize, line)).join("")

  // The bottom band + logo circle stay as this template's brand-accent
  // chrome regardless of caption text — previously also held CTA text
  // (right-anchored next to the logo), now just the solid color band and
  // logo, since there's no second text field left to put there.
  const svg = `
    <defs>
      <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.55"/>
      </linearGradient>
    </defs>
    <rect x="0" y="725" width="${CANVAS_WIDTH}" height="${bandTop - 725}" fill="url(#scrim)"/>
    ${textSvg}
    <rect x="0" y="${bandTop}" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT - bandTop}" fill="${theme.primary}"/>
    <rect x="0" y="${bandTop}" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT - bandTop}" fill="#000000" fill-opacity="0.12"/>
    ${hasLogo ? `<circle cx="106" cy="${bandTop + (CANVAS_HEIGHT - bandTop) / 2}" r="42" fill="#ffffff" fill-opacity="0.92"/>` : ""}
  `
  return { svg, logoBox: { x: 71, y: bandTop + (CANVAS_HEIGHT - bandTop) / 2 - 35, size: 70 } }
}

function buildQuoteCard(captionText: string, theme: ColorTheme, font: fontkit.Font, hasLogo: boolean, scale: number): OverlayResult {
  const { lines, fontSize, lineHeight, blockHeight } = fitText(font, captionText, {
    startFontSize: 72 * scale,
    minFontSize: MIN_HEADLINE_FONT_SIZE,
    lineHeightMultiplier: 1.2,
    maxWidthPx: 940,
    maxLines: 4,
  })
  const startY = CANVAS_HEIGHT / 2 - blockHeight / 2 + fontSize * 0.75

  const textSvg = lines.map((line, i) => textEl("50%", startY + i * lineHeight, "middle", fontSize, line, 700)).join("")

  // Bottom bar now only needs to hold the logo circle (no CTA text left to
  // size it against) — a fixed height comfortably fits the r=30 circle.
  const ctaBarHeight = 130

  const svg = `
    <rect x="0" y="0" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="#000000" fill-opacity="0.38"/>
    <text x="90" y="${startY - blockHeight - 20}" font-family="PostFont, sans-serif" font-weight="900" font-size="220" fill="${theme.secondary}" fill-opacity="0.5">&#8220;</text>
    ${textSvg}
    <rect x="0" y="${CANVAS_HEIGHT - ctaBarHeight}" width="${CANVAS_WIDTH}" height="${ctaBarHeight}" fill="#000000" fill-opacity="0.3"/>
    ${hasLogo ? `<circle cx="${CANVAS_WIDTH / 2}" cy="${CANVAS_HEIGHT - 65}" r="30" fill="#ffffff" fill-opacity="0.9"/>` : ""}
  `
  return { svg, logoBox: { x: CANVAS_WIDTH / 2 - 30, y: CANVAS_HEIGHT - 95, size: 60 } }
}

function buildMinimal(captionText: string, theme: ColorTheme, font: fontkit.Font, hasLogo: boolean, scale: number): OverlayResult {
  const padX = 70
  const { lines, fontSize, lineHeight, blockHeight } = fitText(font, captionText.toUpperCase(), {
    startFontSize: 54 * scale,
    minFontSize: MIN_HEADLINE_FONT_SIZE,
    lineHeightMultiplier: 1.15,
    maxWidthPx: CANVAS_WIDTH - padX - 60,
    maxLines: 3,
  })

  // Box height built up from its actual content (bar, text block, padding)
  // rather than a fixed guess — avoids the accent bar colliding with the
  // text when line count/font size vary.
  const topPad = 40
  const barHeight = 4
  const gapBarToText = 30
  const bottomPad = 34

  const textTop = topPad + barHeight + gapBarToText
  const textFirstBaseline = textTop + fontSize * 0.8
  const boxHeight = textTop + blockHeight + bottomPad
  const boxY = CANVAS_HEIGHT - boxHeight

  const textSvg = lines
    .map((line, i) => textEl(`${padX}`, boxY + textFirstBaseline + i * lineHeight, "start", fontSize, line))
    .join("")

  const svg = `
    <rect x="0" y="${boxY}" width="${CANVAS_WIDTH}" height="${boxHeight}" fill="#000000" fill-opacity="0.42"/>
    <rect x="${padX}" y="${boxY + topPad}" width="52" height="${barHeight}" fill="${theme.primary}"/>
    ${textSvg}
    ${hasLogo ? `<rect x="${CANVAS_WIDTH - 130}" y="50" width="70" height="70" rx="12" fill="#ffffff" fill-opacity="0.9"/>` : ""}
  `
  return { svg, logoBox: { x: CANVAS_WIDTH - 122, y: 58, size: 54 } }
}

// ─── Hard Truth Checklist ───────────────────────────────────────────────
// The first template that isn't a photo-background-plus-headline variant --
// a flat, off-white/cream card (no AI-generated photo at all, see
// lib/ai/post-image-pipeline.ts's generatePostImage, which skips the Flux
// call entirely for this template): a hook headline with one highlighted
// phrase, a short ✗ "wrong way" list, a short ✓ "right way" list, and a
// closing line. Deliberately does NOT attempt the reference format's
// decorative illustrated sticky-note graphic -- that's a hand-designed
// asset, out of scope here. The substance of why this format works is the
// typography/spacing/list legibility, not the decoration.
const CHECKLIST_BG_COLOR = "#F7F1E7"
const CHECKLIST_INK_COLOR = "#1A1A1A"
const CHECKLIST_WRONG_COLOR = "#DC2626"
const CHECKLIST_RIGHT_COLOR = "#16A34A"
const CHECKLIST_MUTED_COLOR = "#57534E"

interface HardTruthChecklistContent {
  headline: string
  highlightedPhrase: string | null
  wrongItems: string[]
  rightItems: string[]
  closingLine: string | null
}

function checklistTextEl(x: number, y: number, anchor: string, fontSize: number, text: string, color: string, weight: number): string {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="PostFont, sans-serif" font-weight="${weight}" font-size="${fontSize}" fill="${color}">${escapeXml(text)}</text>`
}

// Drawn as vector shapes, not the ✗/✓ Unicode glyphs -- the curated fonts
// are all @fontsource Latin SUBSETS (see lib/image/sanitize-text-for-
// compositing.ts's own comment on this exact class of bug) and don't
// reliably include Dingbat-range glyphs either, so relying on the
// characters themselves risks the identical tofu-box failure that fix
// exists to prevent. A vector mark renders correctly regardless of what
// the font supports.
function xMarkSvg(cx: number, cy: number, size: number): string {
  const r = size / 2
  const strokeWidth = Math.max(3, size * 0.18)
  return `<line x1="${cx - r}" y1="${cy - r}" x2="${cx + r}" y2="${cy + r}" stroke="${CHECKLIST_WRONG_COLOR}" stroke-width="${strokeWidth}" stroke-linecap="round"/><line x1="${cx + r}" y1="${cy - r}" x2="${cx - r}" y2="${cy + r}" stroke="${CHECKLIST_WRONG_COLOR}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`
}

function checkMarkSvg(cx: number, cy: number, size: number): string {
  const r = size / 2
  const strokeWidth = Math.max(3, size * 0.18)
  return `<polyline points="${cx - r},${cy} ${cx - r * 0.15},${cy + r * 0.75} ${cx + r},${cy - r * 0.6}" fill="none" stroke="${CHECKLIST_RIGHT_COLOR}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`
}

// Renders a ✗/✓ list -- each item wrapped independently (a long item wraps
// to its own extra line, marker only drawn once per item, aligned to its
// first line), returning both the SVG and the total block height consumed
// so the caller can stack the next section under it.
function buildMarkedList(
  items: string[],
  markSvg: (cx: number, cy: number, size: number) => string,
  font: fontkit.Font,
  fontSize: number,
  maxWidthPx: number,
  startY: number
): { svg: string; endY: number } {
  const lineHeight = fontSize * 1.35
  const markerGap = fontSize * 1.5
  const itemGap = fontSize * 0.4
  const markSize = fontSize * 0.62

  let cursorY = startY
  const parts: string[] = []
  for (const item of items) {
    const wrapped = wrapTextByWidth(font, item, fontSize, maxWidthPx - markerGap)
    for (let i = 0; i < wrapped.length; i++) {
      const baselineY = cursorY + fontSize * 0.85
      if (i === 0) parts.push(markSvg(0, baselineY - fontSize * 0.32, markSize))
      parts.push(checklistTextEl(markerGap, baselineY, "start", fontSize, wrapped[i]!, CHECKLIST_INK_COLOR, 500))
      cursorY += lineHeight
    }
    cursorY += itemGap
  }
  return { svg: parts.join(""), endY: cursorY }
}

function buildHardTruthChecklist(content: HardTruthChecklistContent, theme: ColorTheme, font: fontkit.Font, hasLogo: boolean, scale: number): OverlayResult {
  const padX = 90
  const maxTextWidth = CANVAS_WIDTH - padX * 2

  const { lines: headlineLines, fontSize: headlineFontSize, lineHeight: headlineLineHeight } = fitText(font, content.headline, {
    startFontSize: 62 * scale,
    minFontSize: MIN_HEADLINE_FONT_SIZE,
    lineHeightMultiplier: 1.2,
    maxWidthPx: maxTextWidth,
    maxLines: 3,
  })

  // Best-effort highlight: only rendered when the phrase is found intact on
  // a single wrapped line -- a phrase split across a line-wrap boundary
  // just renders as plain headline text instead of guessing a position.
  const highlightLineIndex = content.highlightedPhrase
    ? headlineLines.findIndex((l) => l.toLowerCase().includes(content.highlightedPhrase!.toLowerCase()))
    : -1

  const headlineTop = 130
  const headlineStartY = headlineTop + headlineFontSize * 0.85

  const highlightRects: string[] = []
  const headlineText = headlineLines.map((line, i) => {
    const y = headlineStartY + i * headlineLineHeight
    if (i === highlightLineIndex && content.highlightedPhrase) {
      const idx = line.toLowerCase().indexOf(content.highlightedPhrase.toLowerCase())
      const before = line.slice(0, idx)
      const match = line.slice(idx, idx + content.highlightedPhrase.length)
      const lineWidth = measureTextWidth(font, line, headlineFontSize)
      const beforeWidth = measureTextWidth(font, before, headlineFontSize)
      const matchWidth = measureTextWidth(font, match, headlineFontSize)
      const lineStartX = CANVAS_WIDTH / 2 - lineWidth / 2
      const boxPad = 8
      // A translucent highlighter-marker stripe behind the text, not a
      // recolored/re-weighted tspan -- keeps the headline's own text color
      // uniform and avoids computing contrast against an arbitrary brand
      // accent color.
      highlightRects.push(
        `<rect x="${lineStartX + beforeWidth - boxPad}" y="${y - headlineFontSize * 0.82}" width="${matchWidth + boxPad * 2}" height="${headlineFontSize * 1.08}" rx="8" fill="${theme.primary}" fill-opacity="0.3"/>`
      )
    }
    return checklistTextEl(CANVAS_WIDTH / 2, y, "middle", headlineFontSize, line, CHECKLIST_INK_COLOR, 800)
  }).join("")

  const headlineBottom = headlineStartY + (headlineLines.length - 1) * headlineLineHeight + headlineFontSize * 0.6

  const listFontSize = Math.round(36 * scale)
  const wrongResult = buildMarkedList(content.wrongItems.slice(0, 3), xMarkSvg, font, listFontSize, maxTextWidth, headlineBottom + 56)
  const rightResult = buildMarkedList(content.rightItems.slice(0, 3), checkMarkSvg, font, listFontSize, maxTextWidth, wrongResult.endY + 44)

  const closingFontSize = Math.round(30 * scale)
  const closingText = content.closingLine?.trim() ?? ""
  const closingFit = closingText
    ? fitText(font, closingText, { startFontSize: closingFontSize, minFontSize: 22, lineHeightMultiplier: 1.3, maxWidthPx: maxTextWidth, maxLines: 2 })
    : null

  // Pinned near the bottom (not stacked directly under the lists, whose
  // total height varies with item count/length) so it lands in a
  // consistent spot instead of drifting per-post.
  const closingBlockY = CANVAS_HEIGHT - 130
  const dividerY = closingBlockY - closingFontSize * 1.8
  const closingSvg = closingFit
    ? closingFit.lines.map((line, i) => checklistTextEl(CANVAS_WIDTH / 2, closingBlockY + i * closingFit.lineHeight, "middle", closingFit.fontSize, line, CHECKLIST_MUTED_COLOR, 600)).join("")
    : ""

  const svg = `
    <rect x="0" y="0" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="${CHECKLIST_BG_COLOR}"/>
    ${highlightRects.join("")}
    ${headlineText}
    <g transform="translate(${padX}, 0)">${wrongResult.svg}${rightResult.svg}</g>
    ${closingText ? `<line x1="${padX}" y1="${dividerY}" x2="${CANVAS_WIDTH - padX}" y2="${dividerY}" stroke="${CHECKLIST_INK_COLOR}" stroke-opacity="0.15" stroke-width="2"/>` : ""}
    ${closingSvg}
    ${hasLogo ? `<rect x="${CANVAS_WIDTH - 130}" y="50" width="70" height="70" rx="12" fill="#ffffff" stroke="${CHECKLIST_INK_COLOR}" stroke-opacity="0.1" stroke-width="1"/>` : ""}
  `
  return { svg, logoBox: { x: CANVAS_WIDTH - 122, y: 58, size: 54 } }
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
  /** The one piece of user-typed text composited onto the image — no more
   * separate headline/CTA fields, no auto-generated fallback text.
   * compositePostImage should only ever be called with this non-empty (see
   * generatePostImage in lib/ai/post-image-pipeline.ts, which skips calling
   * this entirely when there's no caption text and returns the plain
   * background image instead). */
  captionText: string
  logoUrl: string | null
  /** Which curated font (lib/design/fonts.ts) renders captionText — falls
   * back to DEFAULT_FONT_ID (the pre-existing Anton) when omitted, so
   * behavior doesn't silently change for any caller not passing this yet. */
  fontId?: string
  /** Multiplies every template's headline startFontSize before fitText's
   * own auto-shrink loop runs — 1.0 (default, omitted) reproduces the
   * pre-existing fixed sizes exactly. fitText already re-measures real
   * glyph widths and shrinks back down to MIN_HEADLINE_FONT_SIZE if a
   * scaled-up size doesn't fit, so this can't overflow the template's box. */
  textSizeScale?: number
}

/**
 * Overlays brand logo, a brand-color accent, and the caller's one caption
 * text onto a base (Flux-generated) image, per the chosen
 * template's layout. Same pipeline as lib/image/meme-compositor.ts: build
 * an SVG for the vector/text elements, rasterize via resvg, composite over
 * the base image with sharp. `template === "blank"` skips all of this and
 * returns the base image untouched (the "Blank/Custom" option) — even if
 * captionText is non-empty, since "blank" means no overlay chrome of any
 * kind, same as its pre-existing meaning. Logo is composited as its own
 * raster layer rather than embedded in the SVG, to avoid resvg's
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

  // Sanitized right here, immediately before it flows into any of the
  // builders below (every one of which eventually calls fitText/textEl) --
  // see sanitize-text-for-compositing.ts's own comment for why this is the
  // only place in the pipeline this ever runs.
  const captionText = sanitizeTextForCompositing(options.captionText.trim())
  // Known upfront so each builder can skip drawing an empty white circle/
  // rounded-rect logo backdrop when there's nothing to fill it -- this only
  // reflects whether a logo URL was provided, not that the later fetch
  // (fetchLogoBuffer below) will actually succeed. If the fetch fails after
  // the SVG is already built, the backdrop will have been drawn with
  // nothing composited on top of it -- a pre-existing, rare edge case left
  // as-is rather than solved here.
  const hasLogo = !!options.logoUrl

  const builder =
    options.template === "bold_statement" ? buildBoldStatement :
    options.template === "product_focus" ? buildProductFocus :
    options.template === "quote_card" ? buildQuoteCard :
    buildMinimal

  const fontId = options.fontId ?? DEFAULT_FONT_ID
  const font = await getFont(fontId)
  const scale = options.textSizeScale ?? 1.0
  const { svg: overlaySvg, logoBox } = builder(captionText, options.colorTheme, font, hasLogo, scale)
  const svg = `<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">${overlaySvg}</svg>`

  const fontPath = await getFontPath(fontId)
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
    .resize(CANVAS_WIDTH, CANVAS_HEIGHT, { fit: "cover" })
    .composite(layers)
    .png()
    .toBuffer()
}

export interface CompositeHardTruthChecklistOptions {
  colorTheme: ColorTheme
  logoUrl: string | null
  fontId?: string
  textSizeScale?: number
  headline: string
  highlightedPhrase?: string | null
  wrongItems: string[]
  rightItems: string[]
  closingLine?: string | null
}

/**
 * Renders the "Hard Truth Checklist" template entirely from its own
 * structured checklist_* fields -- no base photo at all, unlike every
 * other template's compositePostImage (which always overlays onto a
 * Flux-generated buffer). Called directly by lib/ai/post-image-pipeline.ts's
 * generatePostImage BEFORE it would otherwise fetch a Flux image, so this
 * template never spends a photo-generation credit.
 */
export async function compositeHardTruthChecklist(options: CompositeHardTruthChecklistOptions): Promise<Buffer> {
  const hasLogo = !!options.logoUrl
  const fontId = options.fontId ?? DEFAULT_FONT_ID
  const font = await getFont(fontId)
  const scale = options.textSizeScale ?? 1.0

  // Sanitized right here, immediately before fitText/buildMarkedList's own
  // measuring/wrapping runs -- see sanitize-text-for-compositing.ts's own
  // comment for why this is the only place in the pipeline this ever runs.
  const content: HardTruthChecklistContent = {
    headline: sanitizeTextForCompositing(options.headline.trim()),
    highlightedPhrase: options.highlightedPhrase?.trim() ? sanitizeTextForCompositing(options.highlightedPhrase.trim()) : null,
    wrongItems: options.wrongItems.map((i) => sanitizeTextForCompositing(i.trim())).filter(Boolean),
    rightItems: options.rightItems.map((i) => sanitizeTextForCompositing(i.trim())).filter(Boolean),
    closingLine: options.closingLine?.trim() ? sanitizeTextForCompositing(options.closingLine.trim()) : null,
  }

  const { svg: overlaySvg, logoBox } = buildHardTruthChecklist(content, options.colorTheme, font, hasLogo, scale)
  const svg = `<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">${overlaySvg}</svg>`

  const fontPath = await getFontPath(fontId)
  const resvg = new Resvg(svg, {
    font: { fontFiles: [fontPath], loadSystemFonts: false, defaultFontFamily: "PostFont" },
  })
  const rendered = resvg.render().asPng()

  if (!options.logoUrl || !logoBox) {
    return sharp(rendered).png().toBuffer()
  }

  const logoBuffer = await fetchLogoBuffer(options.logoUrl)
  if (!logoBuffer) return sharp(rendered).png().toBuffer()

  try {
    const resizedLogo = await sharp(logoBuffer)
      .resize(logoBox.size, logoBox.size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()
    return sharp(rendered)
      .composite([{ input: resizedLogo, top: Math.round(logoBox.y), left: Math.round(logoBox.x) }])
      .png()
      .toBuffer()
  } catch {
    // Malformed/unreadable logo file — skip it rather than fail the whole
    // composite over a decorative element.
    return sharp(rendered).png().toBuffer()
  }
}
