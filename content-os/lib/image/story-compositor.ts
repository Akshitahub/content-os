import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import sharp from "sharp"
import { Resvg } from "@resvg/resvg-js"
import { decompress } from "wawoff2"
import { CURATED_FONTS, DEFAULT_FONT_ID, FONT_FAMILY_NAME, findFont } from "@/lib/design/fonts"
import type { FontId } from "@/lib/design/fonts"
import { sanitizeTextForCompositing } from "@/lib/image/sanitize-text-for-compositing"
import { BACKING_OPACITY, TEXT_STYLE_PALETTE, backingRgba, type TextStyle } from "@/lib/design/text-style"
import { NEUTRAL_PALETTE, paletteRoles, resolvePresetForPalette, type BrandPalette, type PaletteRoles } from "@/lib/design/color-themes"
import { tintedScrimOpacity } from "@/lib/image/text-contrast"
import { storyFramePlan, storyStepNumbers, svgFamilies, type TextLayoutFields } from "@/lib/design/text-layouts"
import { layoutPrimsToSvg } from "@/lib/design/text-layout-render"
import {
  STORY_SAFE_ZONE, STORY_TEXT_AREA, TEXT_OVERFLOW_WARNING, clampBlockTop, clampCenterX, estimateBlockWidth,
  layoutStoryChecklistHook, layoutStoryChecklistPair, layoutStoryText, type FittedBlock, type SlideWarning,
} from "@/lib/design/slide-text-layout"

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
const SAFE_ZONE = STORY_SAFE_ZONE

// Same cached-TTF pattern as lib/image/post-compositor.ts — resvg-js's font
// loader only accepts raw TrueType, not the woff2 @fontsource ships, so
// each curated font is decompressed to a TTF once and cached in /tmp across
// warm serverless invocations. Keyed by font id (was a single global when
// Anton was the only option) so all five curated fonts cache independently.
const fontPathCache = new Map<string, string>()

async function getFontPath(fontId: string): Promise<string> {
  const cached = fontPathCache.get(fontId)
  if (cached && existsSync(cached)) return cached

  const font = findFont(CURATED_FONTS, fontId)
  const woff2Path = join(process.cwd(), `node_modules/@fontsource/${font.packageName}/files/${font.fileName}`)
  const ttfBuffer = await decompress(readFileSync(woff2Path))

  const ttfPath = join(tmpdir(), `story-compositor-${font.id}.ttf`)
  writeFileSync(ttfPath, ttfBuffer)
  fontPathCache.set(fontId, ttfPath)
  return ttfPath
}

// The real family name for an SVG font-family attribute -- needed once a
// heading AND a body font are loaded, so each element names its own.
function familyAttr(fontId: string): string {
  return `'${FONT_FAMILY_NAME[fontId as FontId] ?? FONT_FAMILY_NAME[DEFAULT_FONT_ID]}', sans-serif`
}

async function svgToPngBuffer(svg: string, fontId: string, bodyFontId?: string): Promise<Buffer> {
  const fontFiles = [...new Set([await getFontPath(fontId), ...(bodyFontId ? [await getFontPath(bodyFontId)] : [])])]
  const resvg = new Resvg(svg, {
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: FONT_FAMILY_NAME[fontId as FontId] ?? "StoryFont" },
  })
  return Buffer.from(resvg.render().asPng())
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function textLines(lines: string[], startY: number, lineHeight: number, fontSize: number, color: string, weight: number, xAttr: string, family: string = "StoryFont, sans-serif"): string {
  return lines
    .map((line, i) => `<text x="${xAttr}" y="${startY + i * lineHeight}" text-anchor="middle" font-family="${family}" font-weight="${weight}" font-size="${fontSize}" fill="${color}">${escapeXml(line)}</text>`)
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

// The OLD generic presets -- only for slides saved before brand palettes
// that have no palette to map onto (resolvePresetForPalette returns null).
// New generations use the brand presets (brand_deep / brand_warm /
// brand_light / brand_bold, lib/design/color-themes.ts), and an old id on a
// slide with a palette maps to the nearest of those. Mirrors STORY_BG in
// components/generate/StorySequence.tsx.
const STORY_BG_PRESETS: Record<string, { stops: [string, string, string]; text: string; sub: string }> = {
  gradient_violet: { stops: ["#7c3aed", "#9333ea", "#4338ca"], text: "#ffffff", sub: "rgba(255,255,255,0.7)" },
  gradient_pink: { stops: ["#ec4899", "#f43f5e", "#ef4444"], text: "#ffffff", sub: "rgba(255,255,255,0.7)" },
  gradient_dark: { stops: ["#111827", "#1f2937", "#000000"], text: "#ffffff", sub: "rgba(255,255,255,0.6)" },
  gradient_warm: { stops: ["#fbbf24", "#f97316", "#dc2626"], text: "#ffffff", sub: "rgba(255,255,255,0.7)" },
  white: { stops: ["#ffffff", "#ffffff", "#ffffff"], text: "#111827", sub: "#6b7280" },
  vibe_fun_playful: { stops: ["#fb923c", "#facc15", "#2dd4bf"], text: "#ffffff", sub: "rgba(255,255,255,0.7)" },
  vibe_professional: { stops: ["#1e3a8a", "#1e293b", "#111827"], text: "#ffffff", sub: "rgba(255,255,255,0.7)" },
  vibe_trendy_genz: { stops: ["#8b5cf6", "#d946ef", "#22d3ee"], text: "#ffffff", sub: "rgba(255,255,255,0.8)" },
  // Hard Truth Checklist vibe, as saved before palettes (the old cream card).
  // New checklist frames use brand_light -- the palette's base and deep ink,
  // same as the Post template's checklist card.
  checklist_cream: { stops: ["#F7F1E7", "#F7F1E7", "#F7F1E7"], text: "#1A1A1A", sub: "#57534E" },
}
const DEFAULT_PRESET = "gradient_dark"

// Dark scrim so text stays readable over a photo or custom color/gradient
// background — mirrors the live preview's exact
// `bg-gradient-to-t from-black/75 via-black/25 to-black/45` (bottom
// darkest, lighter in the middle, medium at the top). Named presets never
// get this — they're already curated for contrast, same as the preview.
// With a palette the scrim is tinted with its deep, at opacities raised just
// enough to darken as much as the black one did (tintedScrimOpacity).
function scrimSvg(roles: PaletteRoles | null): string {
  const c = roles?.scrim ?? "#000000"
  const o = (a: number) => (roles ? tintedScrimOpacity(a, c, "light") : a)
  return `<defs><linearGradient id="scrim" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="${c}" stop-opacity="${o(0.75)}"/><stop offset="50%" stop-color="${c}" stop-opacity="${o(0.25)}"/><stop offset="100%" stop-color="${c}" stop-opacity="${o(0.45)}"/></linearGradient></defs><rect width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="url(#scrim)"/>`
}

// text_style's uniform scrim: deep-tinted under light text, base-tinted
// under dark, black / white without a palette.
function styleScrimSvg(style: TextStyle, roles: PaletteRoles | null): string {
  if (!roles) return `<rect width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="rgb(${TEXT_STYLE_PALETTE[style.text_color].scrimRgb})" fill-opacity="${style.scrim_opacity}"/>`
  const tint = style.text_color === "light" ? roles.scrim : roles.lightScrim
  return `<rect width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="${tint}" fill-opacity="${tintedScrimOpacity(style.scrim_opacity, tint, style.text_color)}"/>`
}

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
 * named preset. Photo and custom-color both get a scrim; presets never
 * do. A photo with a text_style gets that style's uniform scrim and text
 * color instead of the fixed gradient. */
async function buildBackgroundLayer(slide: StoryCompositeSlide, scrimmed = true): Promise<{ buffer: Buffer; textColor: string; subColor: string; styled: TextStyle | null }> {
  const preset = resolvePresetForPalette(slide.background, slide.palette) ?? STORY_BG_PRESETS[slide.background] ?? STORY_BG_PRESETS[DEFAULT_PRESET]!
  const customColors = (slide.custom_background_colors ?? []).filter(Boolean)
  const roles = slide.palette ? paletteRoles(slide.palette) : null
  const onImage = roles?.onImage ?? "#ffffff"

  if (slide.background_image_url) {
    const photo = await fetchImageBuffer(slide.background_image_url)
    if (photo) {
      const base = await sharp(photo).resize(CANVAS_WIDTH, CANVAS_HEIGHT, { fit: "cover" }).png().toBuffer()
      // No text in any of this function's SVGs (pure background shapes) --
      // the font choice is inconsequential here, DEFAULT_FONT_ID just needs
      // to point at a font file that's guaranteed to exist.
      const style = slide.text_style ?? null
      const palette = style ? TEXT_STYLE_PALETTE[style.text_color] : null
      const scrim = style ? styleScrimSvg(style, roles) : scrimSvg(roles)
      // A layout with its own card/panel backing (scrimmed = false) keeps the photo clean.
      const scrimPng = await svgToPngBuffer(`<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">${scrimmed ? scrim : ""}</svg>`, DEFAULT_FONT_ID)
      const buffer = await sharp(base).composite([{ input: scrimPng, top: 0, left: 0 }]).png().toBuffer()
      if (style && palette) return { buffer, textColor: palette.text, subColor: palette.sub, styled: style }
      return { buffer, textColor: onImage, subColor: "rgba(255,255,255,0.7)", styled: null }
    }
    // Photo failed to fetch — fall through to custom color / preset below
    // rather than leaving the slide with no background at all.
  }

  if (customColors.length > 0) {
    const svg = `<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">${customBackgroundFill(customColors)}${scrimmed ? scrimSvg(roles) : ""}</svg>`
    const buffer = await svgToPngBuffer(svg, DEFAULT_FONT_ID)
    return { buffer, textColor: onImage, subColor: "rgba(255,255,255,0.7)", styled: null }
  }

  const [c1, c2, c3] = preset.stops
  const svg = `<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="preset" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${c1}"/><stop offset="50%" stop-color="${c2}"/><stop offset="100%" stop-color="${c3}"/></linearGradient></defs><rect width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="url(#preset)"/></svg>`
  const buffer = await svgToPngBuffer(svg, DEFAULT_FONT_ID)
  return { buffer, textColor: preset.text, subColor: preset.sub, styled: null }
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

// ─── Hard Truth Checklist (Story vibe) ─────────────────────────────────────
// Same concept as lib/image/post-compositor.ts's buildHardTruthChecklist,
// adapted to one slide per beat instead of one flat card -- see
// buildTextOverlaySvg's own dispatch below for how a slide is detected as
// checklist-flagged in the first place (purely from field presence, no
// separate vibe flag reaches this file). Colours come from the slide's brand
// palette (neutral without one): pop highlight stripe, and red / green marks
// in the tones that sit best with it (paletteRoles).
function checklistRoles(slide: StoryCompositeSlide): PaletteRoles {
  return paletteRoles(slide.palette ?? NEUTRAL_PALETTE)
}

// Vector shapes, not the ✗/✓ Unicode glyphs -- the curated fonts are all
// @fontsource Latin SUBSETS (see lib/image/sanitize-text-for-compositing.ts's
// own comment on this exact class of bug) and don't reliably include
// Dingbat-range glyphs either. Mirrors lib/image/post-compositor.ts's
// identical xMarkSvg/checkMarkSvg exactly -- duplicated locally rather than
// exported/imported, same small-shared-constant convention this codebase
// already follows elsewhere (e.g. CalendarEntryCard.tsx's own local copy
// of PostCard.tsx's PLATFORM_GRADIENT).
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

// Rough average glyph-width ratio for the curated fonts at their usual
// bold weight -- this file's own wrapText/headlineStyle are already
// char-count based, not glyph-measured (see headlineStyle's own comment
// above), so this stays at that same existing precision level rather than
// pulling fontkit into this file (post-compositor.ts's approach) just for
// a soft highlight stripe that doesn't need to be pixel-exact.
function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.56
}

// Hook slide -- the contrarian headline, with checklist_highlighted_phrase
// visually highlighted (a translucent stripe behind the matching
// substring, same "highlighter behind uniform-colored text" treatment as
// the Post template, not a recolored/re-weighted span). Best-effort: if
// the phrase spans a line-wrap boundary, it's simply not found on any
// single line and the headline renders plain instead of guessing a
// position -- same fallback post-compositor.ts's own version uses.
function buildChecklistHookOverlaySvg(slide: StoryCompositeSlide, textColor: string): { svg: string; overflow: boolean } {
  const headline = sanitizeTextForCompositing(slide.text)
  const highlightedPhrase = slide.checklist_highlighted_phrase?.trim()
    ? sanitizeTextForCompositing(slide.checklist_highlighted_phrase.trim())
    : null

  const fitted = layoutStoryChecklistHook(headline, slide.text_size_scale ?? 1.0)
  const { fontSize, lineHeight } = fitted.blocks[0]!
  const lines = fitted.blocks[0]!.lines.flat()

  const highlightLineIndex = highlightedPhrase
    ? lines.findIndex((l) => l.toLowerCase().includes(highlightedPhrase.toLowerCase()))
    : -1

  const totalHeight = lines.length * lineHeight
  const startY = clampBlockTop(CANVAS_HEIGHT / 2, totalHeight, STORY_TEXT_AREA.top, STORY_TEXT_AREA.bottom) + fontSize * 0.85

  const roles = checklistRoles(slide)
  const highlightRects: string[] = []
  const textSvg = lines.map((line, i) => {
    const y = startY + i * lineHeight
    if (i === highlightLineIndex && highlightedPhrase && roles.stripeOpacity > 0) {
      const idx = line.toLowerCase().indexOf(highlightedPhrase.toLowerCase())
      const before = line.slice(0, idx)
      const match = line.slice(idx, idx + highlightedPhrase.length)
      const lineWidth = estimateTextWidth(line, fontSize)
      const beforeWidth = estimateTextWidth(before, fontSize)
      const matchWidth = estimateTextWidth(match, fontSize)
      const lineStartX = CANVAS_WIDTH / 2 - lineWidth / 2
      const boxPad = 8
      highlightRects.push(
        `<rect x="${lineStartX + beforeWidth - boxPad}" y="${y - fontSize * 0.82}" width="${matchWidth + boxPad * 2}" height="${fontSize * 1.08}" rx="8" fill="${roles.pop}" fill-opacity="${roles.stripeOpacity}"/>`
      )
    }
    return `<text x="50%" y="${y}" text-anchor="middle" font-family="${familyAttr(slide.font_id ?? DEFAULT_FONT_ID)}" font-weight="900" font-size="${fontSize}" fill="${textColor}">${escapeXml(line)}</text>`
  }).join("")

  return { svg: `<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">${highlightRects.join("")}${textSvg}</svg>`, overflow: fitted.overflow }
}

// Reveal/buildup slide -- exactly one ✗ wrong-way line paired with its ✓
// right-way line, stacked vertically and centered on the slide. Item text
// itself stays a uniform ink color for both rows (same as the Post
// template's buildMarkedList) -- only the marks are colored.
function buildChecklistPairOverlaySvg(slide: StoryCompositeSlide, textColor: string): { svg: string; overflow: boolean } {
  const wrongItem = slide.checklist_wrong_item?.trim() ? sanitizeTextForCompositing(slide.checklist_wrong_item.trim()) : ""
  const rightItem = slide.checklist_right_item?.trim() ? sanitizeTextForCompositing(slide.checklist_right_item.trim()) : ""

  const fitted = layoutStoryChecklistPair(wrongItem, rightItem, slide.text_size_scale ?? 1.0)
  const roles = checklistRoles(slide)
  const [wrongBlock, rightBlock] = fitted.blocks as [FittedBlock, FittedBlock]
  const { fontSize, lineHeight } = wrongBlock
  const markSize = fontSize * 0.62
  const markGap = fontSize * 1.3
  const padX = 90

  const wrongLines = wrongBlock.lines.flat()
  const rightLines = rightBlock.lines.flat()
  const wrongBlockHeight = wrongBlock.height
  const rowGap = rightBlock.gap

  let cursorY = clampBlockTop(CANVAS_HEIGHT / 2, fitted.height, STORY_TEXT_AREA.top, STORY_TEXT_AREA.bottom)

  const wrongSvg = wrongLines.map((line, i) => {
    const y = cursorY + i * lineHeight + fontSize * 0.8
    const mark = i === 0 ? xMarkSvg(padX + markSize / 2, y - fontSize * 0.32, markSize, roles.wrong) : ""
    return `${mark}<text x="${padX + markGap}" y="${y}" text-anchor="start" font-family="${familyAttr(slide.body_font_id ?? slide.font_id ?? DEFAULT_FONT_ID)}" font-weight="700" font-size="${fontSize}" fill="${textColor}">${escapeXml(line)}</text>`
  }).join("")
  cursorY += wrongBlockHeight + rowGap

  const rightSvg = rightLines.map((line, i) => {
    const y = cursorY + i * lineHeight + fontSize * 0.8
    const mark = i === 0 ? checkMarkSvg(padX + markSize / 2, y - fontSize * 0.32, markSize, roles.right) : ""
    return `${mark}<text x="${padX + markGap}" y="${y}" text-anchor="start" font-family="${familyAttr(slide.body_font_id ?? slide.font_id ?? DEFAULT_FONT_ID)}" font-weight="700" font-size="${fontSize}" fill="${textColor}">${escapeXml(line)}</text>`
  }).join("")

  return { svg: `<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">${wrongSvg}${rightSvg}</svg>`, overflow: fitted.overflow }
}

// A slide is "checklist-flagged" when it carries the fields only the
// hard_truth_checklist vibe ever sets -- used both to pick the right
// overlay builder below and to suppress the product-photo overlay (see
// renderStorySlidesToPng), which would otherwise visually clash with this
// vibe's fixed flat-card layout.
function isChecklistFlaggedSlide(slide: StoryCompositeSlide): boolean {
  return !!slide.checklist_highlighted_phrase || (!!slide.checklist_wrong_item && !!slide.checklist_right_item)
}

function buildTextOverlaySvg(slide: StoryCompositeSlide, textColor: string, subColor: string, backing: TextStyle | null): { svg: string; overflow: boolean } {
  // Hard Truth Checklist vibe -- structurally different rendering per
  // slide type (contrarian headline+highlight on hook, one ✗/✓ pair per
  // reveal/buildup slide), detected purely from field presence. cta
  // slides under this vibe fall through to the generic renderer below
  // unchanged -- "closing line + usual handle/CTA" is exactly what a
  // normal cta slide's text/subtext already render as, no special case
  // needed for it.
  if (slide.type === "hook" && slide.checklist_highlighted_phrase) {
    return buildChecklistHookOverlaySvg(slide, textColor)
  }
  if ((slide.type === "reveal" || slide.type === "buildup") && slide.checklist_wrong_item && slide.checklist_right_item) {
    return buildChecklistPairOverlaySvg(slide, textColor)
  }
  // Sanitized right here, before any length-based sizing/wrapping below or
  // a <text> element uses these -- see sanitize-text-for-compositing.ts's
  // own comment for why this is the only place in the pipeline this runs.
  const text = sanitizeTextForCompositing(slide.text)
  const subtext = sanitizeTextForCompositing(slide.subtext)
  const pollOptions = slide.poll_options?.map((o) => sanitizeTextForCompositing(o))

  // Plain centered text, not an interactive sticker -- baked into the
  // image file, this can't actually collect taps/votes once published, so
  // it shouldn't be styled to look like a button (matches the live
  // preview's own fix for this: a single <p>, no pill/chip chrome).
  // The "  ·  " join separator is sanitized along with everything else --
  // it's the same middle-dot character this file's own font can't render
  // either.
  const pollText = slide.has_poll && pollOptions && pollOptions.length > 0
    ? sanitizeTextForCompositing(pollOptions.join("  ·  "))
    : ""

  // Sizes and wrapping (every word kept, sizes stepped down to a floor
  // instead) from the shared layout the builder's notice also uses.
  const layout = layoutStoryText({ text, subtext, pollText, text_size_scale: slide.text_size_scale })

  // Free-drag position (percentages, block CENTER) takes over completely
  // once set -- see StoryCompositeSlide.text_position_x/y's own comment.
  // Falls back to deriving a center point from text_position for any
  // slide that's never been dragged, via the same formula the live
  // preview defaults to (defaultTextCenter above), so nothing jumps
  // between editor and real export. Either way the block is kept inside
  // the story safe zone (and 6% from the sides).
  const center = slide.text_position_x !== undefined && slide.text_position_y !== undefined
    ? { x: slide.text_position_x, y: slide.text_position_y }
    : defaultTextCenter(slide.text_position)
  const blockWidth = Math.max(estimateBlockWidth(layout.headline), estimateBlockWidth(layout.subtext), estimateBlockWidth(layout.poll))
  const centerXPx = clampCenterX((center.x / 100) * CANVAS_WIDTH, blockWidth, STORY_TEXT_AREA.left, STORY_TEXT_AREA.right)
  const centerXAttr = `${(centerXPx / CANVAS_WIDTH) * 100}%`
  const blockStartY = clampBlockTop((center.y / 100) * CANVAS_HEIGHT, layout.height, STORY_TEXT_AREA.top, STORY_TEXT_AREA.bottom)

  const headFamily = familyAttr(slide.font_id ?? DEFAULT_FONT_ID)
  const bodyFamily = familyAttr(slide.body_font_id ?? slide.font_id ?? DEFAULT_FONT_ID)
  let cursorY = blockStartY
  const block = (b: FittedBlock, color: string, weight: number, family: string): string => {
    cursorY += b.gap
    const lines = b.lines.flat()
    const svg = lines.length > 0 ? textLines(lines, cursorY + b.fontSize * 0.85, b.lineHeight, b.fontSize, color, weight, centerXAttr, family) : ""
    cursorY += b.height
    return svg
  }
  const headlineSvg = block(layout.headline, textColor, 900, headFamily)
  const subtextSvg = block(layout.subtext, subColor, 600, bodyFamily)
  const pollSvg = block(layout.poll, subColor, 700, bodyFamily)

  const backingSvg = backing?.needs_backing
    ? backingRect(centerXPx - blockWidth / 2, blockStartY, blockWidth, layout.height, backing, slide.palette ? paletteRoles(slide.palette) : null)
    : ""

  return {
    svg: `<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">${backingSvg}${headlineSvg}${subtextSvg}${pollSvg}</svg>`,
    overflow: layout.overflow,
  }
}

// Soft panel behind a text block over a busy photo (text_style.needs_backing):
// deep-tinted under light text, base-tinted under dark when there's a palette.
function backingRect(x: number, y: number, w: number, h: number, style: TextStyle, roles: PaletteRoles | null): string {
  const pad = 40
  const left = Math.max(0, x - pad)
  const right = Math.min(CANVAS_WIDTH, x + w + pad)
  const tint = roles ? (style.text_color === "light" ? roles.scrim : roles.lightScrim) : null
  const fill = tint ? `fill="${tint}" fill-opacity="${tintedScrimOpacity(BACKING_OPACITY, tint, style.text_color)}"` : `fill="${backingRgba(style)}"`
  return `<rect x="${left}" y="${y - pad}" width="${right - left}" height="${h + pad * 2}" rx="32" ${fill}/>`
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
   * "openai", since this file has no idea what provider generated
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
  /** Exact user-picked hex for the headline/subtext/poll text -- overrides
   * the background-derived textColor/subColor buildBackgroundLayer
   * computes below when set. See StorySlide.custom_text_color's own
   * comment. */
  custom_text_color?: string | null
  /** Which curated font (lib/design/fonts.ts) renders this slide's headline/
   * subtext/poll text -- falls back to DEFAULT_FONT_ID (Anton, this file's
   * pre-existing sole font) when absent, so behavior doesn't silently
   * change for any slide saved before this field existed. */
  font_id?: FontId | null
  /** Body font (subtext/points/poll/CTA lines) -- the brand's body face
   * (lib/design/fonts.ts resolveTypography). Absent = font_id for all text. */
  body_font_id?: FontId | null
  /** Uniform multiplier applied to every font size this slide renders
   * (headline/subtext/poll) -- 1.0 (default) reproduces the pre-existing
   * fixed sizes exactly. See headlineStyle above for how this interacts
   * with the per-length maxChars wrap budget to avoid overflow. */
  text_size_scale?: number | null
  /** Hard Truth Checklist vibe only -- hook slide's highlighted phrase.
   * See StorySlide.checklist_highlighted_phrase's own comment
   * (app/api/v1/ai/stories/generate/route.ts). Presence of this field
   * (on a "hook" slide) is what triggers the checklist-specific headline
   * rendering below instead of the generic one -- there's no separate
   * vibe flag threaded into this file otherwise. */
  checklist_highlighted_phrase?: string | null
  /** Hard Truth Checklist vibe only -- reveal/buildup slide's one wrong/
   * right pair. See StorySlide.checklist_wrong_item/checklist_right_item's
   * own comment. BOTH must be present to trigger the ✗/✓ marked
   * rendering below -- absent (or either one missing) falls through to
   * the generic text/subtext renderer, which still shows the same
   * content correctly (see that field's own comment on why `text`/
   * `subtext` are always mirrored alongside these). */
  checklist_wrong_item?: string | null
  checklist_right_item?: string | null
  /** Computed once from background_image_url where it was generated
   * (lib/image/text-contrast.ts). Absent = the old fixed gradient scrim. */
  text_style?: TextStyle | null
  /** Content-matched layout (lib/design/text-layouts.ts) + kicker / highlight.
   * Absent = this file's original layout. Checklist frames ignore it. */
  text_layout?: TextLayoutFields["text_layout"]
  kicker?: string | null
  highlight?: string | null
  /** The brand colour layouts use for accents and the split panel. */
  accent_color?: string | null
  /** The brand's 4-role palette (lib/design/color-themes.ts): brand presets,
   * scrims, highlights and checklist colours. Absent (content exported
   * before palettes) = the old presets and black scrims. */
  palette?: BrandPalette | null
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
  return (await renderStorySlides(slides)).map((r) => r.png)
}

/** renderStorySlidesToPng plus each slide's warnings ("text_overflow"). */
export async function renderStorySlides(slides: StoryCompositeSlide[]): Promise<{ png: Buffer; warnings: SlideWarning[] }[]> {
  const total = slides.length
  if (total === 0) return []
  const steps = storyStepNumbers(slides)

  return Promise.all(
    slides.map(async (slide, i) => {
      // Layout frames draw the shared plan; checklist frames keep their own design.
      const photo = slide.text_layout && !isChecklistFlaggedSlide(slide) && slide.background_image_url ? await fetchImageBuffer(slide.background_image_url) : null
      const plan = slide.text_layout && !isChecklistFlaggedSlide(slide) ? storyFramePlan(slide, steps[i] ?? null, !!photo) : null
      const { buffer: backgroundLayer, textColor: bgTextColor, subColor: bgSubColor, styled } = await buildBackgroundLayer(plan && !photo ? { ...slide, background_image_url: null } : slide, plan ? plan.fullScrim : true)
      // Exact user-picked hex overrides the background-derived pairing for
      // headline, subtext, AND poll text (buildTextOverlaySvg applies
      // textColor to the headline and subColor to both subtext and poll) --
      // unlike custom_background_colors there's no separate lighter/darker
      // variant for text, just one color, matching PhoneStory's own
      // customTextStyle applied uniformly across all three.
      const textColor = slide.custom_text_color ?? bgTextColor
      const subColor = slide.custom_text_color ?? bgSubColor

      const layers: { input: Buffer; top: number; left: number }[] = []

      // show_product_overlay !== false (not a plain truthiness check) so
      // an older cached/persisted slide from before this field existed --
      // absent, not explicitly false -- still defaults to shown, matching
      // this file's own prior always-on behavior. Checklist-flagged slides
      // (hard_truth_checklist vibe) never get a product overlay regardless
      // -- it would visually clash with that vibe's fixed flat-card
      // layout, and a user's own selected product photo is resolved
      // client-side independently of which vibe generated the text (see
      // StorySequence.tsx's toExportSlide), so it can still be attached
      // here even though no AI background was ever fetched for this slide.
      if (shouldShowProductImage(slide.type, total) && slide.show_product_overlay !== false && slide.productImageSource && !isChecklistFlaggedSlide(slide)) {
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

      const heading = slide.font_id ?? DEFAULT_FONT_ID
      const overlay = plan
        ? { svg: `<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">${layoutPrimsToSvg(plan.prims, svgFamilies(FONT_FAMILY_NAME, { heading, body: slide.body_font_id ?? heading }))}</svg>`, overflow: plan.overflow }
        : buildTextOverlaySvg(slide, textColor, subColor, styled)
      const textOverlayPng = await svgToPngBuffer(overlay.svg, slide.font_id ?? DEFAULT_FONT_ID, slide.body_font_id ?? undefined)
      layers.push({ input: textOverlayPng, top: 0, left: 0 })

      const png = await sharp(backgroundLayer).composite(layers).png().toBuffer()
      return { png, warnings: overlay.overflow ? [TEXT_OVERFLOW_WARNING] : [] }
    })
  )
}
