import sharp from "sharp"
import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { Resvg } from "@resvg/resvg-js"
import { decompress } from "wawoff2"
import * as fontkit from "fontkit"
import type { PostTemplateId } from "@/lib/design/post-templates"
import { paletteRoles, type BrandPalette, type ColorTheme, type PaletteRoles } from "@/lib/design/color-themes"
import { AA_BODY, AA_GRAPHIC, AA_LARGE, bestContrast, deltaE, ensureContrast, mixHex, tintedScrimOpacity, toHex } from "@/lib/image/text-contrast"
import { CURATED_FONTS, DEFAULT_FONT_ID, findFont } from "@/lib/design/fonts"
import { sanitizeTextForCompositing } from "@/lib/image/sanitize-text-for-compositing"
import { BACKING_OPACITY, type TextStyle } from "@/lib/design/text-style"
import { TEXT_OVERFLOW_WARNING, type SlideWarning } from "@/lib/design/slide-text-layout"
import { singleImagePlan, svgFamilies, type TextLayoutId } from "@/lib/design/text-layouts"
import { layoutPrimsToSvg } from "@/lib/design/text-layout-render"
import { FONT_FAMILY_NAME, isFontId } from "@/lib/design/fonts"

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
  /** At the floor and still past the height budget -- every line is kept anyway. */
  overflow: boolean
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
 * than an off-canvas crop. No headline content is ever silently dropped:
 * text still too tall at the floor keeps all its lines and is flagged
 * `overflow` (reported as a "text_overflow" warning) instead of the old
 * slice to the line budget, which cut the end of the headline off.
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
      const overflow = atFloor && finalLines.length > maxLinesAtFloor
      return { lines: finalLines, fontSize, lineHeight, blockHeight: finalLines.length * lineHeight, overflow }
    }

    fontSize = Math.max(opts.minFontSize, Math.round(fontSize * shrinkFactor))
  }
}

// A thin deep-tinted stroke behind the light text guarantees legibility
// regardless of what's directly under it — the scrims below handle the
// general case, this is the safety net for edge cases (a scrim gradient's
// lighter edge, etc). Much thinner than the meme compositor's thick outline
// — this reads as "readable," not "meme." Text is white or the palette's
// base, whichever reads better over the deep scrim (paletteRoles.onImage).
function textEl(x: string, y: number, anchor: string, fontSize: number, text: string, roles: PaletteRoles, weight = 900): string {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="PostFont, sans-serif" font-weight="${weight}" font-size="${fontSize}" fill="${roles.onImage}" stroke="${roles.stroke}" stroke-opacity="0.5" stroke-width="2.5" paint-order="stroke" letter-spacing="0.5">${escapeXml(text)}</text>`
}

// A deep-tinted scrim at the opacity that keeps the light text's contrast
// exactly what the black one gave (lib/image/text-contrast.ts).
function scrimOpacity(roles: PaletteRoles, blackOpacity: number): number {
  return tintedScrimOpacity(blackOpacity, roles.scrim, "light")
}

interface OverlayResult {
  svg: string
  logoBox: { x: number; y: number; size: number } | null
  overflow: boolean
}

// text_style (lib/design/text-style.ts) for a template: the scrim strength
// the photo actually needs at the text (never below `floor`, which keeps
// each template's look), or the template's own fixed value without one.
// Post text is always white, so the style is computed with preferLight.
function scrimStrength(style: TextStyle | null, fixed: number, floor = 0.25): number {
  return style ? Math.max(floor, style.scrim_opacity) : fixed
}

// Soft deep-tinted panel behind the text lines when the region is busy.
function backingPanel(style: TextStyle | null, roles: PaletteRoles, x: number, y: number, w: number, h: number): string {
  if (!style?.needs_backing) return ""
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="24" fill="${roles.scrim}" fill-opacity="${scrimOpacity(roles, BACKING_OPACITY)}"/>`
}

// 6% safe edge on the 1080-wide canvas: text and badges stay inside it.
const SAFE_X = Math.round(CANVAS_WIDTH * 0.06)
const SAFE_TEXT_WIDTH = CANVAS_WIDTH - SAFE_X * 2

function buildBoldStatement(captionText: string, theme: ColorTheme, font: fontkit.Font, hasLogo: boolean, scale: number, style: TextStyle | null): OverlayResult {
  const roles = paletteRoles(theme.palette)
  const { lines, fontSize, lineHeight, blockHeight, overflow } = fitText(font, captionText.toUpperCase(), {
    startFontSize: 92 * scale,
    minFontSize: MIN_HEADLINE_FONT_SIZE,
    lineHeightMultiplier: 1.12,
    maxWidthPx: SAFE_TEXT_WIDTH,
    maxLines: 4,
  })
  // 950 = 760 * (CANVAS_HEIGHT / 1080) — proportionally rescaled from the
  // original square canvas's tuned anchor (see canvas-height comment above).
  // Still a sensible center within the scrim zone now that there's no CTA
  // pill anchored below it (one text block instead of two, per the
  // "one text box, only what's typed appears" redesign).
  const startY = 950 - blockHeight / 2 + fontSize * 0.8

  const textSvg = lines.map((line, i) => textEl("50%", startY + i * lineHeight, "middle", fontSize, line, roles)).join("")

  // With a text_style the gradient reaches the needed strength by the top
  // of the text instead of only at the bottom edge.
  const strength = scrimOpacity(roles, scrimStrength(style, 0.78))
  const midStop = style ? `<stop offset="45%" stop-color="${roles.scrim}" stop-opacity="${strength}"/>` : ""
  const svg = `
    <defs>
      <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${roles.scrim}" stop-opacity="0"/>
        ${midStop}
        <stop offset="100%" stop-color="${roles.scrim}" stop-opacity="${strength}"/>
      </linearGradient>
    </defs>
    <rect x="0" y="575" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT - 575}" fill="url(#scrim)"/>
    ${backingPanel(style, roles, SAFE_X - 20, startY - fontSize * 0.8 - 28, SAFE_TEXT_WIDTH + 40, blockHeight + 56)}
    ${textSvg}
    ${hasLogo ? `<circle cx="106" cy="106" r="50" fill="#ffffff" fill-opacity="0.92"/>` : ""}
  `
  return { svg, logoBox: { x: 66, y: 66, size: 80 }, overflow }
}

function buildProductFocus(captionText: string, theme: ColorTheme, font: fontkit.Font, hasLogo: boolean, scale: number, style: TextStyle | null): OverlayResult {
  const roles = paletteRoles(theme.palette)
  const { lines, fontSize, lineHeight, blockHeight, overflow } = fitText(font, captionText.toUpperCase(), {
    startFontSize: 62 * scale,
    minFontSize: MIN_HEADLINE_FONT_SIZE,
    lineHeightMultiplier: 1.15,
    maxWidthPx: SAFE_TEXT_WIDTH,
    maxLines: 3,
  })
  // 1000 = 800 * (CANVAS_HEIGHT / 1080) — proportionally rescaled from the
  // original square canvas's tuned anchor.
  const bandTop = 1000
  const textY = bandTop - 40 - (lines.length - 1) * lineHeight

  const textSvg = lines.map((line, i) => textEl("50%", textY + i * lineHeight, "middle", fontSize, line, roles)).join("")

  // The bottom band + logo circle stay as this template's brand-accent
  // chrome regardless of caption text — previously also held CTA text
  // (right-anchored next to the logo), now just the solid color band and
  // logo, since there's no second text field left to put there. The band is
  // the palette's accent (deep when accent can't carry text).
  const strength = scrimOpacity(roles, scrimStrength(style, 0.55))
  const svg = `
    <defs>
      <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${roles.scrim}" stop-opacity="0"/>
        <stop offset="${style ? 50 : 100}%" stop-color="${roles.scrim}" stop-opacity="${strength}"/>
        <stop offset="100%" stop-color="${roles.scrim}" stop-opacity="${strength}"/>
      </linearGradient>
    </defs>
    <rect x="0" y="725" width="${CANVAS_WIDTH}" height="${bandTop - 725}" fill="url(#scrim)"/>
    ${backingPanel(style, roles, SAFE_X - 20, textY - fontSize * 0.8 - 24, SAFE_TEXT_WIDTH + 40, blockHeight + 48)}
    ${textSvg}
    <rect x="0" y="${bandTop}" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT - bandTop}" fill="${roles.band}"/>
    ${hasLogo ? `<circle cx="106" cy="${bandTop + (CANVAS_HEIGHT - bandTop) / 2}" r="42" fill="#ffffff" fill-opacity="0.92"/>` : ""}
  `
  return { svg, logoBox: { x: 71, y: bandTop + (CANVAS_HEIGHT - bandTop) / 2 - 35, size: 70 }, overflow }
}

function buildQuoteCard(captionText: string, theme: ColorTheme, font: fontkit.Font, hasLogo: boolean, scale: number, style: TextStyle | null): OverlayResult {
  const roles = paletteRoles(theme.palette)
  const { lines, fontSize, lineHeight, blockHeight, overflow } = fitText(font, captionText, {
    startFontSize: 72 * scale,
    minFontSize: MIN_HEADLINE_FONT_SIZE,
    lineHeightMultiplier: 1.2,
    maxWidthPx: Math.min(940, SAFE_TEXT_WIDTH),
    maxLines: 4,
  })
  const startY = CANVAS_HEIGHT / 2 - blockHeight / 2 + fontSize * 0.75

  const textSvg = lines.map((line, i) => textEl("50%", startY + i * lineHeight, "middle", fontSize, line, roles, 700)).join("")

  // Bottom bar now only needs to hold the logo circle (no CTA text left to
  // size it against) — a fixed height comfortably fits the r=30 circle.
  const ctaBarHeight = 130

  const svg = `
    <rect x="0" y="0" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="${roles.scrim}" fill-opacity="${scrimOpacity(roles, scrimStrength(style, 0.38))}"/>
    ${backingPanel(style, roles, SAFE_X - 20, startY - fontSize * 0.75 - 28, SAFE_TEXT_WIDTH + 40, blockHeight + 56)}
    <text x="90" y="${startY - blockHeight - 20}" font-family="PostFont, sans-serif" font-weight="900" font-size="220" fill="${ensureContrast(roles.pop, roles.scrim, AA_GRAPHIC)}" fill-opacity="0.6">&#8220;</text>
    ${textSvg}
    <rect x="0" y="${CANVAS_HEIGHT - ctaBarHeight}" width="${CANVAS_WIDTH}" height="${ctaBarHeight}" fill="${roles.scrim}" fill-opacity="${scrimOpacity(roles, 0.3)}"/>
    ${hasLogo ? `<circle cx="${CANVAS_WIDTH / 2}" cy="${CANVAS_HEIGHT - 65}" r="30" fill="#ffffff" fill-opacity="0.9"/>` : ""}
  `
  return { svg, logoBox: { x: CANVAS_WIDTH / 2 - 30, y: CANVAS_HEIGHT - 95, size: 60 }, overflow }
}

function buildMinimal(captionText: string, theme: ColorTheme, font: fontkit.Font, hasLogo: boolean, scale: number, style: TextStyle | null): OverlayResult {
  const roles = paletteRoles(theme.palette)
  const padX = 70
  const { lines, fontSize, lineHeight, blockHeight, overflow } = fitText(font, captionText.toUpperCase(), {
    startFontSize: 54 * scale,
    minFontSize: MIN_HEADLINE_FONT_SIZE,
    lineHeightMultiplier: 1.15,
    maxWidthPx: CANVAS_WIDTH - padX - SAFE_X,
    maxLines: 3,
  })

  // Box height built up from its actual content (bar, text block, padding)
  // rather than a fixed guess — avoids the accent bar colliding with the
  // text when line count/font size vary.
  const topPad = 40
  const barHeight = 4
  const gapBarToText = 30
  // The box runs to the bottom edge; its text stays above the 6% safe edge.
  const bottomPad = Math.round(CANVAS_HEIGHT * 0.06)

  const textTop = topPad + barHeight + gapBarToText
  const textFirstBaseline = textTop + fontSize * 0.8
  const boxHeight = textTop + blockHeight + bottomPad
  const boxY = CANVAS_HEIGHT - boxHeight

  const textSvg = lines
    .map((line, i) => textEl(`${padX}`, boxY + textFirstBaseline + i * lineHeight, "start", fontSize, line, roles))
    .join("")

  const svg = `
    <rect x="0" y="${boxY}" width="${CANVAS_WIDTH}" height="${boxHeight}" fill="${roles.scrim}" fill-opacity="${scrimOpacity(roles, style?.needs_backing ? Math.max(BACKING_OPACITY, style.scrim_opacity) : scrimStrength(style, 0.42, 0.42))}"/>
    <rect x="${padX}" y="${boxY + topPad}" width="52" height="${barHeight}" fill="${ensureContrast(theme.palette.accent, roles.scrim, AA_GRAPHIC)}"/>
    ${textSvg}
    ${hasLogo ? `<rect x="${CANVAS_WIDTH - SAFE_X - 70}" y="${SAFE_X}" width="70" height="70" rx="12" fill="#ffffff" fill-opacity="0.9"/>` : ""}
  `
  return { svg, logoBox: { x: CANVAS_WIDTH - SAFE_X - 62, y: SAFE_X + 8, size: 54 }, overflow }
}

// ─── Hard Truth Checklist ───────────────────────────────────────────────
// The first template that isn't a photo-background-plus-headline variant --
// a flat, off-white/cream card (no AI-generated photo at all, see
// lib/ai/post-image-pipeline.ts's generatePostImage, which skips the AI
// image call entirely for this template): a hook headline with one highlighted
// phrase, a short ✗ "wrong way" list, a short ✓ "right way" list, and a
// closing line. Deliberately does NOT attempt the reference format's
// decorative illustrated sticky-note graphic -- that's a hand-designed
// asset, out of scope here. The substance of why this format works is the
// typography/spacing/list legibility, not the decoration. Colours come from
// the brand palette: base background, deep ink, pop highlight stripe, and
// red / green marks in the tones that sit best with it (paletteRoles).

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
function xMarkSvg(cx: number, cy: number, size: number, color: string): string {
  const r = size / 2
  const strokeWidth = Math.max(3, size * 0.18)
  return `<line x1="${cx - r}" y1="${cy - r}" x2="${cx + r}" y2="${cy + r}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"/><line x1="${cx + r}" y1="${cy - r}" x2="${cx - r}" y2="${cy + r}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`
}

function checkMarkSvg(cx: number, cy: number, size: number, color: string): string {
  const r = size / 2
  const strokeWidth = Math.max(3, size * 0.18)
  return `<polyline points="${cx - r},${cy} ${cx - r * 0.15},${cy + r * 0.75} ${cx + r},${cy - r * 0.6}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`
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
  startY: number,
  ink: string
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
      parts.push(checklistTextEl(markerGap, baselineY, "start", fontSize, wrapped[i]!, ink, 500))
      cursorY += lineHeight
    }
    cursorY += itemGap
  }
  return { svg: parts.join(""), endY: cursorY }
}

// The checklist's type grows to fill the card, up to these sizes (1080 canvas).
const CHECKLIST_HEADLINE_MAX = 96
const CHECKLIST_ITEM_MAX = 52
// The closing line: this share of the headline size, this far under its divider.
const CLOSING_TO_HEADLINE = 0.55
const CLOSING_DIVIDER_GAP = 36

/** Height buildMarkedList would take for these items (without its trailing gap). */
function markedListHeight(items: string[], font: fontkit.Font, fontSize: number, maxWidthPx: number): number {
  if (!items.length) return 0
  const lines = items.reduce((n, item) => n + wrapTextByWidth(font, item, fontSize, maxWidthPx - fontSize * 1.5).length, 0)
  return lines * fontSize * 1.35 + (items.length - 1) * fontSize * 0.4
}

function buildHardTruthChecklist(content: HardTruthChecklistContent, theme: ColorTheme, font: fontkit.Font, hasLogo: boolean, scale: number): OverlayResult {
  const roles = paletteRoles(theme.palette)
  const padX = 90
  const maxTextWidth = CANVAS_WIDTH - padX * 2

  const wrongItems = content.wrongItems.slice(0, 3)
  const rightItems = content.rightItems.slice(0, 3)

  // The closing line is the card's ending, not a footnote: the heading font
  // at ~55% of the headline size, in deep, under an accent divider -- sized
  // with everything else to fill the card between the safe areas.
  const closingText = content.closingLine?.trim() ?? ""
  const spaceTop = Math.round(CANVAS_HEIGHT * 0.06)
  const spaceBottom = CANVAS_HEIGHT - Math.round(CANVAS_HEIGHT * 0.06)
  const space = spaceBottom - spaceTop
  const dividerColor = ensureContrast(theme.palette.accent, theme.palette.base, AA_GRAPHIC)

  // Grow the headline, items and closing line together from their base
  // sizes until the block fills ~75% of that space (capped at sane maxima),
  // then spread the rest evenly: above the headline, between the groups,
  // above the closing line and below it.
  const layoutAt = (grow: number) => {
    const headline = fitText(font, content.headline, {
      startFontSize: Math.min(CHECKLIST_HEADLINE_MAX, 62 * scale * grow),
      minFontSize: MIN_HEADLINE_FONT_SIZE,
      lineHeightMultiplier: 1.2,
      maxWidthPx: maxTextWidth,
      maxLines: 3,
    })
    const listFontSize = Math.round(Math.min(CHECKLIST_ITEM_MAX, 36 * scale * grow))
    const headlineH = (headline.lines.length - 1) * headline.lineHeight + headline.fontSize * 1.1
    const wrongH = markedListHeight(wrongItems, font, listFontSize, maxTextWidth)
    const rightH = markedListHeight(rightItems, font, listFontSize, maxTextWidth)
    const closing = closingText
      ? fitText(font, closingText, { startFontSize: Math.round(headline.fontSize * CLOSING_TO_HEADLINE), minFontSize: 24, lineHeightMultiplier: 1.25, maxWidthPx: maxTextWidth, maxLines: 2 })
      : null
    // The divider plus the gap under it, then the closing lines.
    const closingH = closing ? CLOSING_DIVIDER_GAP + (closing.lines.length - 1) * closing.lineHeight + closing.fontSize * 1.1 : 0
    return { headline, listFontSize, headlineH, wrongH, rightH, closing, closingH, total: headlineH + wrongH + rightH + closingH }
  }
  let layout = layoutAt(1)
  for (let grow = 1.05; grow <= 2.5; grow += 0.05) {
    const next = layoutAt(grow)
    if (next.total > space * 0.75) break
    layout = next
    if (next.headline.fontSize >= CHECKLIST_HEADLINE_MAX && next.listFontSize >= CHECKLIST_ITEM_MAX) break
  }
  const gaps = closingText ? 5 : 4
  const gap = Math.max(24, (space - layout.total) / gaps)
  const { lines: headlineLines, fontSize: headlineFontSize, lineHeight: headlineLineHeight, overflow: headlineOverflow } = layout.headline
  const headlineTop = spaceTop + gap
  const headlineStartY = headlineTop + headlineFontSize * 0.85

  // Best-effort highlight: only rendered when the phrase is found intact on
  // a single wrapped line -- a phrase split across a line-wrap boundary
  // just renders as plain headline text instead of guessing a position.
  const highlightLineIndex = content.highlightedPhrase
    ? headlineLines.findIndex((l) => l.toLowerCase().includes(content.highlightedPhrase!.toLowerCase()))
    : -1

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
      // A translucent pop highlighter stripe behind the text, not a
      // recolored/re-weighted tspan -- keeps the headline's ink uniform; its
      // opacity is the strongest that keeps the ink >= 4.5:1 over it.
      if (roles.stripeOpacity > 0) highlightRects.push(
        `<rect x="${lineStartX + beforeWidth - boxPad}" y="${y - headlineFontSize * 0.82}" width="${matchWidth + boxPad * 2}" height="${headlineFontSize * 1.08}" rx="8" fill="${roles.pop}" fill-opacity="${roles.stripeOpacity}"/>`
      )
    }
    return checklistTextEl(CANVAS_WIDTH / 2, y, "middle", headlineFontSize, line, roles.ink, 800)
  }).join("")

  const wrongTop = headlineTop + layout.headlineH + gap
  const rightTop = wrongTop + layout.wrongH + gap
  const wrongResult = buildMarkedList(wrongItems, (cx, cy, size) => xMarkSvg(cx, cy, size, roles.wrong), font, layout.listFontSize, maxTextWidth, wrongTop, roles.ink)
  const rightResult = buildMarkedList(rightItems, (cx, cy, size) => checkMarkSvg(cx, cy, size, roles.right), font, layout.listFontSize, maxTextWidth, rightTop, roles.ink)

  const closingFit = layout.closing
  const dividerY = rightTop + layout.rightH + gap
  const closingTop = dividerY + CLOSING_DIVIDER_GAP
  const closingSvg = closingFit
    ? closingFit.lines.map((line, i) => checklistTextEl(CANVAS_WIDTH / 2, closingTop + closingFit.fontSize * 0.85 + i * closingFit.lineHeight, "middle", closingFit.fontSize, line, roles.ink, 700)).join("")
    : ""

  const svg = `
    <rect x="0" y="0" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="${theme.palette.base}"/>
    ${highlightRects.join("")}
    ${headlineText}
    <g transform="translate(${padX}, 0)">${wrongResult.svg}${rightResult.svg}</g>
    ${closingFit ? `<line x1="${CANVAS_WIDTH / 2 - 90}" y1="${dividerY}" x2="${CANVAS_WIDTH / 2 + 90}" y2="${dividerY}" stroke="${dividerColor}" stroke-width="5" stroke-linecap="round"/>` : ""}
    ${closingSvg}
    ${hasLogo ? `<rect x="${CANVAS_WIDTH - SAFE_X - 70}" y="${SAFE_X}" width="70" height="70" rx="12" fill="#ffffff" stroke="${roles.ink}" stroke-opacity="0.1" stroke-width="1"/>` : ""}
  `
  return { svg, logoBox: { x: CANVAS_WIDTH - SAFE_X - 62, y: SAFE_X + 8, size: 54 }, overflow: headlineOverflow || !!closingFit?.overflow }
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
  /** From the base image (lib/image/text-contrast.ts, preferLight) -- sets
   * each template's scrim strength and backing panel. Absent = the fixed
   * per-template scrims. */
  textStyle?: TextStyle | null
  /** Content-matched layout (lib/design/text-layouts.ts) -- replaces the
   * template's text treatment when set; absent = the template, unchanged. */
  textLayout?: TextLayoutId | null
  kicker?: string | null
  highlight?: string | null
  /** offer_badge only: the real offer text. */
  offer?: string | null
  bodyFontId?: string | null
}

/**
 * Overlays brand logo, a brand-color accent, and the caller's one caption
 * text onto a base (AI-generated) image, per the chosen
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
  return (await compositePostImageWithWarnings(baseImageBuffer, options)).buffer
}

/** compositePostImage plus its warnings ("text_overflow"). */
export async function compositePostImageWithWarnings(
  baseImageBuffer: Buffer,
  options: CompositePostImageOptions
): Promise<{ buffer: Buffer; warnings: SlideWarning[] }> {
  if (options.textLayout) return compositeLayoutPost(baseImageBuffer, options)
  if (options.template === "blank") {
    return { buffer: await sharp(baseImageBuffer).png().toBuffer(), warnings: [] }
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
  const { svg: overlaySvg, logoBox, overflow } = builder(captionText, options.colorTheme, font, hasLogo, scale, options.textStyle ?? null)
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

  const buffer = await sharp(baseImageBuffer)
    .resize(CANVAS_WIDTH, CANVAS_HEIGHT, { fit: "cover" })
    .composite(layers)
    .png()
    .toBuffer()
  return { buffer, warnings: overflow ? [TEXT_OVERFLOW_WARNING] : [] }
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
 * other template's compositePostImage (which always overlays onto an
 * AI-generated buffer). Called directly by lib/ai/post-image-pipeline.ts's
 * generatePostImage BEFORE it would otherwise fetch an AI image, so this
 * template never spends a photo-generation credit.
 */
export async function compositeHardTruthChecklist(options: CompositeHardTruthChecklistOptions): Promise<Buffer> {
  return (await compositeHardTruthChecklistWithWarnings(options)).buffer
}

/** compositeHardTruthChecklist plus its warnings ("text_overflow"). */
export async function compositeHardTruthChecklistWithWarnings(options: CompositeHardTruthChecklistOptions): Promise<{ buffer: Buffer; warnings: SlideWarning[] }> {
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

  const { svg: overlaySvg, logoBox, overflow } = buildHardTruthChecklist(content, options.colorTheme, font, hasLogo, scale)
  const warnings: SlideWarning[] = overflow ? [TEXT_OVERFLOW_WARNING] : []
  const svg = `<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">${overlaySvg}</svg>`

  const fontPath = await getFontPath(fontId)
  const resvg = new Resvg(svg, {
    font: { fontFiles: [fontPath], loadSystemFonts: false, defaultFontFamily: "PostFont" },
  })
  const rendered = resvg.render().asPng()

  if (!options.logoUrl || !logoBox) {
    return { buffer: await sharp(rendered).png().toBuffer(), warnings }
  }

  const logoBuffer = await fetchLogoBuffer(options.logoUrl)
  if (!logoBuffer) return { buffer: await sharp(rendered).png().toBuffer(), warnings }

  try {
    const resizedLogo = await sharp(logoBuffer)
      .resize(logoBox.size, logoBox.size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()
    const buffer = await sharp(rendered)
      .composite([{ input: resizedLogo, top: Math.round(logoBox.y), left: Math.round(logoBox.x) }])
      .png()
      .toBuffer()
    return { buffer, warnings }
  } catch {
    // Malformed/unreadable logo file — skip it rather than fail the whole
    // composite over a decorative element.
    return { buffer: await sharp(rendered).png().toBuffer(), warnings }
  }
}

// A post with a text_layout: the shared plan (lib/design/text-layouts.ts)
// over the base image -- the same plan FullPost's overlay export draws.
async function compositeLayoutPost(baseImageBuffer: Buffer, options: CompositePostImageOptions): Promise<{ buffer: Buffer; warnings: SlideWarning[] }> {
  const heading = isFontId(options.fontId) ? options.fontId : DEFAULT_FONT_ID
  const body = isFontId(options.bodyFontId) ? options.bodyFontId : heading
  const style = options.textStyle ?? null
  const plan = singleImagePlan({
    text_layout: options.textLayout, kicker: options.kicker, highlight: options.highlight, offer: options.offer,
    headline: options.captionText.trim(), fonts: { heading, body }, textStyle: style, brandColor: options.colorTheme.primary, palette: options.colorTheme.palette, scale: options.textSizeScale ?? 1,
  }, CANVAS_WIDTH, CANVAS_HEIGHT)
  // Deep-tinted (base-tinted under dark text) instead of black / white.
  const roles = paletteRoles(options.colorTheme.palette)
  const tint = style?.text_color === "dark" ? roles.lightScrim : roles.scrim
  const scrim = plan.fullScrim
    ? `<rect width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="${tint}" fill-opacity="${tintedScrimOpacity(style ? style.scrim_opacity : 0.35, tint, style?.text_color ?? "light")}"/>`
    : ""
  const hasLogo = !!options.logoUrl
  const logoBox = hasLogo ? { x: CANVAS_WIDTH - SAFE_X - 62, y: SAFE_X + 8, size: 54 } : null
  const svg = `<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">${scrim}${layoutPrimsToSvg(plan.prims, svgFamilies(FONT_FAMILY_NAME, { heading, body }))}${hasLogo ? `<rect x="${CANVAS_WIDTH - SAFE_X - 70}" y="${SAFE_X}" width="70" height="70" rx="12" fill="#ffffff" fill-opacity="0.9"/>` : ""}</svg>`
  const fontFiles = [...new Set([await getFontPath(heading), await getFontPath(body)])]
  const overlayPng = new Resvg(svg, { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: FONT_FAMILY_NAME[heading] } }).render().asPng()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layers: any[] = [{ input: overlayPng, top: 0, left: 0 }]
  if (options.logoUrl && logoBox) {
    const logoBuffer = await fetchLogoBuffer(options.logoUrl)
    if (logoBuffer) {
      try {
        const resizedLogo = await sharp(logoBuffer).resize(logoBox.size, logoBox.size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
        layers.push({ input: resizedLogo, top: Math.round(logoBox.y), left: Math.round(logoBox.x) })
      } catch {
        // Unreadable logo -- skip it, same as the template path.
      }
    }
  }
  const buffer = await sharp(baseImageBuffer).resize(CANVAS_WIDTH, CANVAS_HEIGHT, { fit: "cover" }).composite(layers).png().toBuffer()
  return { buffer, warnings: plan.overflow ? [TEXT_OVERFLOW_WARNING] : [] }
}

// ─── Annotated Product ──────────────────────────────────────────────────
// The brand's real product photo (background removed) centred on a base
// card with an accent arch behind it, a heading-font headline with one
// keyword in Caveat, 3-4 Caveat callouts in the free space around the
// product with hand-drawn arrows pointing at it, and a deep strip with the
// brand name and CTA. Every colour from the brand palette (paletteRoles),
// every text pair contrast-checked (lib/image/text-contrast.ts). No AI
// scene -- see generatePostImage's annotated_product branch.

const ANNOTATED_SCRIPT_FONT = "caveat"
const ANNOTATED_SAFE_Y = Math.round(CANVAS_HEIGHT * 0.06)
const ANNOTATED_STRIP_H = 150
// Callouts: never smaller than this on the 1080 canvas, at most 2 lines.
const CALLOUT_FONT = 46
// Arrows read on a phone screen at this width.
const ARROW_WIDTH = 4
// The arch is this much wider than the product; the product never shrinks below this share of its cap.
const ARCH_WIDTH_RATIO = 1.4
const MIN_PRODUCT_SCALE = 0.55
// Within this CIE76 distance two colours read as the same at a glance.
const SAME_COLOR_DELTA_E = 20
// A product wider than this (w/h) gets the wide arrangement: rows above / below.
const WIDE_PRODUCT_ASPECT = 1.1
const WIDE_ARCH_WIDTH_RATIO = 1.25
// Vertical room a row of callouts leaves for its arrows.
const ROW_ARROW_ROOM = 56
type CalloutSlot = { side: "left" | "right"; at: number; row?: "above" | "below" }
const WIDE_SLOTS: Record<3 | 4, CalloutSlot[]> = {
  4: [{ side: "left", at: 0, row: "above" }, { side: "right", at: 0, row: "above" }, { side: "left", at: 1, row: "below" }, { side: "right", at: 1, row: "below" }],
  3: [{ side: "left", at: 0, row: "above" }, { side: "right", at: 0, row: "above" }, { side: "left", at: 1, row: "below" }],
}
const ANNOTATED_SLOTS: Record<3 | 4, CalloutSlot[]> = {
  4: [{ side: "left", at: 0.2 }, { side: "right", at: 0.2 }, { side: "left", at: 0.68 }, { side: "right", at: 0.68 }],
  3: [{ side: "left", at: 0.22 }, { side: "right", at: 0.45 }, { side: "left", at: 0.7 }],
}

/** The cut-out's dominant colour over its opaque pixels (a 16-level-per-channel histogram, like sharp's stats().dominant without the transparent ones). */
function dominantOpaqueColor(data: Buffer, channels: number): string | null {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>()
  const step = Math.max(1, Math.floor(data.length / channels / 40_000))
  for (let i = 0; i < data.length; i += channels * step) {
    if (data[i + 3]! < 200) continue
    const r = data[i]!
    const g = data[i + 1]!
    const b = data[i + 2]!
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
    bin.n++
    bin.r += r
    bin.g += g
    bin.b += b
    bins.set(key, bin)
  }
  let best: { n: number; r: number; g: number; b: number } | null = null
  for (const bin of bins.values()) if (!best || bin.n > best.n) best = bin
  return best ? toHex([best.r / best.n, best.g / best.n, best.b / best.n]) : null
}

/** The dominant colour of a background-removed product image (opaque pixels only). */
export async function cutoutDominantColor(cutout: Buffer): Promise<string | null> {
  const { data, info } = await sharp(cutout).ensureAlpha().resize(400, 400, { fit: "inside", withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true })
  return dominantOpaqueColor(data, info.channels)
}

/** The arch colour that separates from the product: accent, else pop, else a light accent tint. */
function archColorFor(p: BrandPalette, productColor: string | null): string {
  if (!productColor) return p.accent
  if (deltaE(productColor, p.accent) >= SAME_COLOR_DELTA_E) return p.accent
  if (deltaE(productColor, p.pop) >= SAME_COLOR_DELTA_E) return p.pop
  const tint = mixHex(p.accent, "#ffffff", 0.7)
  return deltaE(productColor, tint) >= SAME_COLOR_DELTA_E ? tint : mixHex(p.deep, p.base, 0.15)
}

export interface CompositeAnnotatedProductOptions {
  palette: BrandPalette
  /** The product photo -- a background-removed PNG when `cutout`, else the original (drawn in a rounded frame). */
  productImage: Buffer
  cutout: boolean
  headline: string
  /** A verbatim part of the headline, set in Caveat in the accent colour. */
  keyword?: string | null
  /** 3-4 short facts, drawn around the product. */
  callouts: string[]
  brandName: string
  ctaText?: string | null
  /** The brand's heading font (headline, strip). */
  fontId?: string
  /** art_direction.motifs -- a few small shapes in the empty space, never over text. */
  motifs?: string[] | null
}

interface Box { x: number; y: number; w: number; h: number }

const overlaps = (a: Box, b: Box, pad = 0) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad

/** The headline wrapped with the keyword kept as one Caveat token; shrinks until it fits two lines (three at the floor). */
function layoutAnnotatedHeadline(headline: string, keyword: string | null, heading: fontkit.Font, script: fontkit.Font, maxW: number) {
  const at = keyword ? headline.toLowerCase().indexOf(keyword.toLowerCase()) : -1
  const tokens: { text: string; script: boolean }[] = at >= 0
    ? [
        ...headline.slice(0, at).trim().split(/\s+/).filter(Boolean).map((t) => ({ text: t, script: false })),
        { text: headline.slice(at, at + keyword!.length), script: true },
        ...headline.slice(at + keyword!.length).trim().split(/\s+/).filter(Boolean).map((t) => ({ text: t, script: false })),
      ]
    : headline.split(/\s+/).filter(Boolean).map((t) => ({ text: t, script: false }))
  const SCRIPT_SCALE = 1.25
  for (let size = 78; ; size = Math.max(40, Math.round(size * 0.92))) {
    const width = (t: { text: string; script: boolean }) => measureTextWidth(t.script ? script : heading, t.text, t.script ? size * SCRIPT_SCALE : size)
    const space = measureTextWidth(heading, " ", size)
    const lines: { text: string; script: boolean }[][] = [[]]
    let lineW = 0
    for (const t of tokens) {
      const w = width(t)
      const cur = lines[lines.length - 1]!
      if (cur.length && lineW + space + w > maxW) {
        lines.push([t])
        lineW = w
      } else {
        lineW += (cur.length ? space : 0) + w
        cur.push(t)
      }
    }
    const fits = lines.every((l) => l.reduce((s, t, i) => s + width(t) + (i ? space : 0), 0) <= maxW)
    if ((lines.length <= 2 && fits) || size <= 40) {
      return { lines, size, scriptSize: size * SCRIPT_SCALE, lineHeight: size * 1.18, overflow: lines.length > 3 || !fits }
    }
  }
}

/** A run's advance width and where its ink starts / ends relative to its origin. */
export interface RunMetrics { width: number; inkLeft?: number; inkRight?: number }

/**
 * One headline line as positioned runs, centred on `centerX`: consecutive
 * heading-font words merge into one run (their own spaces kept), the
 * script keyword is a run of its own, and exactly a heading-font space of
 * clear gap separates the INK of every pair of runs (a script face's
 * glyphs overhang their advance, so advance-based gaps look lopsided) --
 * the keyword keeps a word gap on whichever side has a word, at the start,
 * middle or end of the line.
 */
export function placeHeadlineRuns(
  line: { text: string; script: boolean }[],
  measure: (run: { text: string; script: boolean }) => RunMetrics,
  space: number,
  centerX: number,
): { text: string; script: boolean; x: number; width: number }[] {
  const runs: { text: string; script: boolean }[] = []
  for (const t of line) {
    const last = runs[runs.length - 1]
    if (last && !last.script && !t.script) last.text += ` ${t.text}`
    else runs.push({ text: t.text, script: t.script })
  }
  const metrics = runs.map((r) => {
    const m = measure(r)
    return { width: m.width, inkLeft: m.inkLeft ?? 0, inkRight: m.inkRight ?? m.width }
  })
  // Lay out from x = 0, then shift so the line's ink is centred.
  const xs: number[] = []
  let x = 0
  metrics.forEach((m, i) => {
    if (i > 0) x = xs[i - 1]! + metrics[i - 1]!.inkRight + space - m.inkLeft
    xs.push(x)
  })
  const inkStart = xs[0]! + metrics[0]!.inkLeft
  const inkEnd = xs[xs.length - 1]! + metrics[metrics.length - 1]!.inkRight
  const shift = centerX - (inkStart + inkEnd) / 2
  return runs.map((r, i) => ({ ...r, x: xs[i]! + shift, width: metrics[i]!.width }))
}

/** A run's metrics in `font` at `size`: advance plus its ink extents (glyph bounding box). */
function runMetrics(font: fontkit.Font, text: string, size: number): RunMetrics {
  const run = font.layout(text)
  const scale = size / font.unitsPerEm
  const width = run.positions.reduce((sum, p) => sum + p.xAdvance, 0) * scale
  const box = run.bbox
  return Number.isFinite(box.minX) && Number.isFinite(box.maxX) ? { width, inkLeft: box.minX * scale, inkRight: box.maxX * scale } : { width }
}

/** A hand-drawn-looking arrow: a quadratic curve bowing away from the straight line, with an open head. */
function handArrow(x1: number, y1: number, x2: number, y2: number, bow: number, color: string): string {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const cx = mx - (dy / len) * bow
  const cy = my + (dx / len) * bow
  // Head along the curve's end tangent (end - control).
  const tx = x2 - cx
  const ty = y2 - cy
  const tl = Math.hypot(tx, ty) || 1
  const ux = tx / tl
  const uy = ty / tl
  const head = 16
  const spread = 0.5
  const hx1 = x2 - head * (ux * Math.cos(spread) - uy * Math.sin(spread))
  const hy1 = y2 - head * (uy * Math.cos(spread) + ux * Math.sin(spread))
  const hx2 = x2 - head * (ux * Math.cos(-spread) - uy * Math.sin(-spread))
  const hy2 = y2 - head * (uy * Math.cos(-spread) + ux * Math.sin(-spread))
  const r = (n: number) => Math.round(n * 10) / 10
  return `<path d="M ${r(x1)} ${r(y1)} Q ${r(cx)} ${r(cy)} ${r(x2)} ${r(y2)}" fill="none" stroke="${color}" stroke-width="${ARROW_WIDTH}" stroke-linecap="round"/>`
    + `<path d="M ${r(hx1)} ${r(hy1)} L ${r(x2)} ${r(y2)} L ${r(hx2)} ${r(hy2)}" fill="none" stroke="${color}" stroke-width="${ARROW_WIDTH}" stroke-linecap="round" stroke-linejoin="round"/>`
}

/** A small motif mark: a 5-petal flower for floral motifs, else a ring of dots. */
function motifMark(cx: number, cy: number, motif: string, color: string): string {
  if (/flower|petal|marigold|rose|jasmine|lotus|bloom|leaf|leaves|floral|blossom/i.test(motif)) {
    const petals = Array.from({ length: 5 }, (_, i) => {
      const a = (i / 5) * Math.PI * 2
      return `<ellipse cx="${(cx + Math.cos(a) * 11).toFixed(1)}" cy="${(cy + Math.sin(a) * 11).toFixed(1)}" rx="9" ry="5.5" transform="rotate(${((a * 180) / Math.PI).toFixed(0)} ${(cx + Math.cos(a) * 11).toFixed(1)} ${(cy + Math.sin(a) * 11).toFixed(1)})" fill="${color}" fill-opacity="0.75"/>`
    }).join("")
    return `${petals}<circle cx="${cx}" cy="${cy}" r="5" fill="${color}"/>`
  }
  return `<circle cx="${cx}" cy="${cy}" r="9" fill="${color}" fill-opacity="0.8"/><circle cx="${cx + 20}" cy="${cy - 12}" r="5" fill="${color}" fill-opacity="0.6"/><circle cx="${cx + 8}" cy="${cy + 18}" r="4" fill="${color}" fill-opacity="0.5"/>`
}

/** The annotated_product post: see this section's comment. Throws only on an unreadable product image. */
export async function compositeAnnotatedProduct(options: CompositeAnnotatedProductOptions): Promise<{ buffer: Buffer; warnings: SlideWarning[] }> {
  const p = options.palette
  const roles = paletteRoles(p)
  const headingId = isFontId(options.fontId) ? options.fontId : DEFAULT_FONT_ID
  const heading = await getFont(headingId)
  const script = await getFont(ANNOTATED_SCRIPT_FONT)
  const headFamily = `'${FONT_FAMILY_NAME[headingId]}', serif`
  const scriptFamily = `'${FONT_FAMILY_NAME[ANNOTATED_SCRIPT_FONT]}', cursive`
  let overflow = false

  // Text colours, each checked against what it sits on.
  const ink = roles.ink
  const keywordColor = ensureContrast(p.accent, p.base, AA_LARGE)
  const stripText = ensureContrast(bestContrast(p.deep, [p.base, "#ffffff"]), p.deep, AA_BODY)

  // ── Headline (top safe area).
  const headline = sanitizeTextForCompositing(options.headline.trim())
  const keyword = options.keyword?.trim() ? sanitizeTextForCompositing(options.keyword.trim()) : null
  const maxTextW = CANVAS_WIDTH - SAFE_X * 2
  const hl = layoutAnnotatedHeadline(headline, keyword, heading, script, maxTextW)
  overflow ||= hl.overflow
  const headTop = ANNOTATED_SAFE_Y + 10
  // Each run at its own measured x: a space carried inside a tspan is lost
  // where the font family switches ("nani" + "made" -> "nanimade"), so the
  // gaps either side of the keyword are placed explicitly instead.
  const runWidth = (r: { text: string; script: boolean }) => runMetrics(r.script ? script : heading, r.text, r.script ? hl.scriptSize : hl.size)
  const headlineSpace = measureTextWidth(heading, " ", hl.size)
  const headlineSvg = hl.lines.map((line, i) => {
    const y = headTop + hl.size * 0.85 + i * hl.lineHeight
    return placeHeadlineRuns(line, runWidth, headlineSpace, CANVAS_WIDTH / 2)
      .map((r) => `<text x="${r.x.toFixed(1)}" y="${y}" text-anchor="start" font-family="${r.script ? scriptFamily : headFamily}" font-size="${r.script ? hl.scriptSize : hl.size}" font-weight="700" fill="${r.script ? keywordColor : ink}" xml:space="preserve">${escapeXml(r.text)}</text>`)
      .join("")
  }).join("")
  const headlineBox: Box = { x: SAFE_X, y: headTop - 6, w: maxTextW, h: hl.lines.length * hl.lineHeight + 16 }

  // ── Product + callouts, sized together. Two arrangements:
  // - tall / square products: capped at ~42% of the width and ~50% of the
  //   height, an arch ~1.4x its width, callouts in the columns either side;
  // - wide products (w/h > ~1.1): up to ~62% of the width (same height cap),
  //   an arch ~1.25x its width, callouts in a row above and a row below.
  // Never upscaled. Callouts stay >= 46px and <= 2 lines -- when one needs a
  // third line the product shrinks (down to a floor) before the text would.
  const stripTop = CANVAS_HEIGHT - ANNOTATED_STRIP_H
  const archLift = Math.round(CANVAS_HEIGHT * 0.08)
  const archTopMin = headlineBox.y + headlineBox.h + 24
  const zoneBottom = stripTop - 24
  // A cut-out is trimmed to its visible pixels so the box is the product itself.
  const source = options.cutout ? await sharp(options.productImage).trim().png().toBuffer() : options.productImage
  const srcMeta = await sharp(source).metadata()
  const aspect = (srcMeta.width ?? 1) / (srcMeta.height ?? 1)
  const wide = aspect > WIDE_PRODUCT_ASPECT
  const slots = (wide ? WIDE_SLOTS : ANNOTATED_SLOTS)[options.callouts.length >= 4 ? 4 : 3]
  const callouts = options.callouts.slice(0, slots.length).map((c) => sanitizeTextForCompositing(c.trim())).filter(Boolean)
  const linesAt = (text: string, width: number) => wrapTextByWidth(script, text, CALLOUT_FONT, width)
  const calloutLH = CALLOUT_FONT * 1.05
  const fits = (texts: string[], width: number) => texts.every((c) => {
    const lines = linesAt(c, width)
    return lines.length <= 2 && lines.every((l) => measureTextWidth(script, l, CALLOUT_FONT) <= width)
  })

  // Wide: each row's height is its tallest callout plus room for the arrow.
  const rowWidth = Math.floor((CANVAS_WIDTH - SAFE_X * 2) / 2 - 30)
  const rowHeight = (texts: string[]) => (texts.length ? Math.max(...texts.map((c) => Math.min(2, linesAt(c, rowWidth).length))) * calloutLH + ROW_ARROW_ROOM : 0)
  const aboveTexts = callouts.filter((_, i) => slots[i]!.row === "above")
  const belowTexts = callouts.filter((_, i) => slots[i]!.row === "below")
  const productTopMin = wide ? archTopMin + rowHeight(aboveTexts) + archLift : archTopMin + archLift
  const productBottomMax = wide ? zoneBottom - rowHeight(belowTexts) - 40 : stripTop - 60

  const archRatio = wide ? WIDE_ARCH_WIDTH_RATIO : ARCH_WIDTH_RATIO
  const productSize = (scale: number) => {
    const maxW = CANVAS_WIDTH * (wide ? 0.62 : 0.42) * scale
    const maxH = Math.min(CANVAS_HEIGHT * 0.5, productBottomMax - productTopMin) * scale
    // Never past the source resolution.
    const w = Math.min(maxW, maxH * aspect, srcMeta.width ?? maxW)
    return { w: Math.round(w), h: Math.round(w / aspect) }
  }
  const columnFor = (pw: number) => Math.floor((CANVAS_WIDTH - Math.round(pw * archRatio)) / 2 - SAFE_X - 24)
  let productScale = 1
  // Rows above / below have a fixed width -- only the side columns depend on the product.
  if (wide && !fits(callouts, rowWidth)) overflow = true
  while (!wide && !fits(callouts, columnFor(productSize(productScale).w)) && productScale > MIN_PRODUCT_SCALE) productScale = Math.max(MIN_PRODUCT_SCALE, productScale - 0.06)
  const { w: targetW, h: targetH } = productSize(productScale)
  let productPng = await sharp(source).resize(Math.max(1, targetW), Math.max(1, targetH), { fit: "inside", withoutEnlargement: true }).png().toBuffer()
  const meta = await sharp(productPng).metadata()
  const pw = meta.width ?? targetW
  const ph = meta.height ?? targetH
  const px = Math.round((CANVAS_WIDTH - pw) / 2)
  // Centred vertically in the free zone between its bounds.
  const py = Math.round(Math.max(productTopMin, productTopMin + (productBottomMax - productTopMin - ph) / 2))
  if (!options.cutout) {
    // No cut-out: the photo in a rounded frame.
    const radius = Math.round(Math.min(pw, ph) * 0.08)
    const mask = Buffer.from(`<svg width="${pw}" height="${ph}"><rect width="${pw}" height="${ph}" rx="${radius}" fill="#fff"/></svg>`)
    productPng = await sharp(productPng).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer()
  }
  const productBox: Box = { x: px, y: py, w: pw, h: ph }
  // A cut-out's real outline (alpha), so arrows land on the product, not the
  // empty corner of its box: per row for side callouts, per column for rows.
  let edgeAt = (_y: number, left: boolean) => (left ? px : px + pw)
  let edgeAtX = (_x: number, top: boolean) => (top ? py : py + ph)
  let productColor: string | null = null
  if (options.cutout) {
    const { data, info } = await sharp(productPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const ch = info.channels
    const opaque = (row: number, col: number) => data[(row * info.width + col) * ch + 3]! > 96
    edgeAt = (y: number, left: boolean) => {
      const row = Math.max(0, Math.min(info.height - 1, Math.round(y - py)))
      for (let k = 0; k < info.width; k++) {
        const col = left ? k : info.width - 1 - k
        if (opaque(row, col)) return px + col
      }
      return left ? px : px + pw
    }
    edgeAtX = (x: number, top: boolean) => {
      const col = Math.max(0, Math.min(info.width - 1, Math.round(x - px)))
      for (let k = 0; k < info.height; k++) {
        const row = top ? k : info.height - 1 - k
        if (opaque(row, col)) return py + row
      }
      return top ? py : py + ph
    }
    productColor = dominantOpaqueColor(data, ch)
  }

  // ── The arch: a frame behind the product, rising ~8% of the canvas above
  // it (a flattened, elliptical top for a wide product). Its colour must
  // separate from the product: accent, else pop when the product is
  // accent-coloured, else a light accent tint.
  const archW = Math.round(pw * archRatio)
  const archX = (CANVAS_WIDTH - archW) / 2
  const archRx = archW / 2
  const archRy = wide ? Math.min(archRx, archLift + 40) : archRx
  const archTop = Math.max(archTopMin, py - archLift)
  const archBottom = Math.min(stripTop - 24, py + ph + 40)
  const archBox: Box = { x: archX, y: archTop, w: archW, h: archBottom - archTop }
  const archColor = archColorFor(p, productColor)
  const arch = `<path d="M ${archX} ${archBottom} V ${archTop + archRy} A ${archRx} ${archRy} 0 0 1 ${archX + archW} ${archTop + archRy} V ${archBottom} Z" fill="${archColor}"/>`
  const frame = options.cutout ? "" : `<rect x="${px - 8}" y="${py - 8}" width="${pw + 16}" height="${ph + 16}" rx="${Math.round(Math.min(pw, ph) * 0.08) + 8}" fill="${p.base}"/>`
  const shadow = `<ellipse cx="${CANVAS_WIDTH / 2}" cy="${py + ph + 6}" rx="${pw * 0.38}" ry="14" fill="${roles.scrim}" fill-opacity="0.18"/>`

  // ── Callouts: side columns (tall) or rows above / below (wide).
  const sideW = wide ? rowWidth : columnFor(pw)
  const placed: { box: Box; svg: string; arrow: string }[] = []
  const calloutTop = archTopMin
  const calloutBottom = zoneBottom
  for (let i = 0; i < callouts.length; i++) {
    const slot = slots[i]!
    const size = CALLOUT_FONT
    let lines = linesAt(callouts[i]!, sideW)
    // Past the product floor: still 46px -- a long word breaks, and it's reported.
    if (lines.length > 2 || lines.some((l) => measureTextWidth(script, l, size) > sideW)) {
      lines = lines.flatMap((l) => breakLineToWidth(script, l, size, sideW))
      overflow = true
    }
    const lh = calloutLH
    const blockH = lines.length * lh
    const blockW = Math.max(...lines.map((l) => measureTextWidth(script, l, size)))
    const left = slot.side === "left"
    const x = left ? SAFE_X : CANVAS_WIDTH - SAFE_X - blockW
    let y: number
    if (slot.row === "above") y = Math.round(archTopMin)
    else if (slot.row === "below") y = Math.round(Math.min(calloutBottom - blockH, Math.max(py + ph + ROW_ARROW_ROOM, archBottom + 16)))
    else y = Math.round(py + ph * slot.at - blockH / 2)
    y = Math.max(calloutTop, Math.min(calloutBottom - blockH, y))
    // Never on another callout: slide down past any it would touch on the same side.
    for (const other of placed) {
      if (overlaps({ x, y, w: blockW, h: blockH }, other.box, 18)) y = Math.round(other.box.y + other.box.h + 22)
    }
    if (y + blockH > calloutBottom) overflow = true
    const box: Box = { x, y, w: blockW, h: blockH }
    const anchor = left ? "start" : "end"
    const tx = left ? x : x + blockW
    const svg = lines.map((l, k) => `<text x="${tx}" y="${(y + size * 0.82 + k * lh).toFixed(1)}" text-anchor="${anchor}" font-family="${scriptFamily}" font-weight="700" font-size="${size}" fill="${ink}">${escapeXml(l)}</text>`).join("")
    let arrow: string
    if (slot.row) {
      // Rows: from under (above) / over (below) the block's inner half down / up to the product's edge.
      const above = slot.row === "above"
      const startX = left ? x + Math.min(blockW, 220) * 0.6 : x + blockW - Math.min(blockW, 220) * 0.6
      const startY = above ? y + blockH + 8 : y - 8
      const endX = Math.max(px + pw * 0.15, Math.min(px + pw * 0.85, left ? startX + 70 : startX - 70))
      const endY = above ? edgeAtX(endX, true) - 10 : edgeAtX(endX, false) + 10
      arrow = handArrow(startX, startY, endX, endY, (left ? 1 : -1) * (above ? 30 : -30), ink)
    } else {
      // Columns: from the block's inner edge to the product's near edge, aimed at the block's height.
      const startX = left ? x + blockW + 10 : x - 10
      const startY = y + Math.min(blockH, lh) * 0.6
      const endY = Math.max(py + ph * 0.12, Math.min(py + ph * 0.88, startY + (slot.at < 0.5 ? 40 : -30)))
      const endX = left ? edgeAt(endY, true) - 10 : edgeAt(endY, false) + 10
      arrow = handArrow(startX, startY, endX, endY, (left ? -1 : 1) * (slot.at < 0.5 ? 34 : -34), ink)
    }
    placed.push({ box, svg, arrow })
  }

  // ── Bottom strip: deep, brand name left, CTA right.
  const brandName = sanitizeTextForCompositing(options.brandName.trim())
  const cta = sanitizeTextForCompositing((options.ctaText?.trim() || "Shop now"))
  const stripMid = stripTop + ANNOTATED_STRIP_H / 2
  const stripSize = 38
  const strip = `<rect x="0" y="${stripTop}" width="${CANVAS_WIDTH}" height="${ANNOTATED_STRIP_H}" fill="${p.deep}"/>`
    + `<text x="${SAFE_X}" y="${stripMid + stripSize * 0.35}" font-family="${headFamily}" font-weight="700" font-size="${stripSize}" fill="${stripText}">${escapeXml(brandName)}</text>`
    + `<text x="${CANVAS_WIDTH - SAFE_X}" y="${stripMid + stripSize * 0.35}" text-anchor="end" font-family="${scriptFamily}" font-weight="700" font-size="${stripSize + 6}" fill="${stripText}">${escapeXml(cta)}</text>`

  // ── Motifs: up to three small marks in empty space, never over text, product, arch or strip.
  let motifSvg = ""
  const motifs = (options.motifs ?? []).filter((m) => m.trim())
  if (motifs.length) {
    const taken: Box[] = [headlineBox, productBox, archBox, { x: 0, y: stripTop, w: CANVAS_WIDTH, h: ANNOTATED_STRIP_H }, ...placed.map((c) => c.box)]
    const candidates = [
      { x: SAFE_X + 20, y: stripTop - 60 }, { x: CANVAS_WIDTH - SAFE_X - 40, y: stripTop - 60 },
      { x: SAFE_X + 30, y: archTopMin + 20 }, { x: CANVAS_WIDTH - SAFE_X - 40, y: archTopMin + 20 },
      { x: archX - 40, y: archTop + 20 }, { x: archX + archW + 30, y: archTop + 20 },
    ]
    const color = ensureContrast(p.pop, p.base, AA_GRAPHIC)
    let n = 0
    for (const c of candidates) {
      if (n >= 3) break
      const mark: Box = { x: c.x - 26, y: c.y - 26, w: 56, h: 52 }
      if (mark.x < SAFE_X - 10 || mark.x + mark.w > CANVAS_WIDTH - SAFE_X + 10) continue
      if (taken.some((t) => overlaps(mark, t, 12))) continue
      motifSvg += motifMark(c.x, c.y, motifs[n % motifs.length]!, color)
      taken.push(mark)
      n++
    }
  }

  const back = `<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg"><rect width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="${p.base}"/>${arch}${frame}${options.cutout ? shadow : ""}</svg>`
  const front = `<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">${motifSvg}${headlineSvg}${placed.map((c) => c.svg + c.arrow).join("")}${strip}</svg>`
  const fontFiles = [...new Set([await getFontPath(headingId), await getFontPath(ANNOTATED_SCRIPT_FONT)])]
  const render = (svg: string) => new Resvg(svg, { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: FONT_FAMILY_NAME[headingId] } }).render().asPng()
  const buffer = await sharp(render(back))
    .composite([{ input: productPng, top: py, left: px }, { input: render(front), top: 0, left: 0 }])
    .png()
    .toBuffer()
  return { buffer, warnings: overflow ? [TEXT_OVERFLOW_WARNING] : [] }
}
