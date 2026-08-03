import sharp from "sharp"
import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { Resvg } from "@resvg/resvg-js"
import { decompress } from "wawoff2"
import type { PostTemplateId } from "@/lib/design/post-templates"
import type { ColorTheme } from "@/lib/design/color-themes"

const CANVAS_SIZE = 1080

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

function buildBoldStatement(headline: string, cta: string, theme: ColorTheme): OverlayResult {
  const lines = wrapText(headline.toUpperCase(), 16, 3)
  const fontSize = lines.length > 2 ? 64 : lines.length > 1 ? 76 : 92
  const lineHeight = fontSize * 1.12
  const blockHeight = lines.length * lineHeight
  const startY = 760 - blockHeight / 2 + fontSize * 0.8

  const headlineSvg = lines.map((line, i) => textEl("50%", startY + i * lineHeight, "middle", fontSize, line)).join("")

  const ctaY = startY + lines.length * lineHeight + 70
  const ctaText = cta.toUpperCase()
  const ctaWidth = Math.min(700, 120 + ctaText.length * 20)

  const svg = `
    <defs>
      <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.78"/>
      </linearGradient>
    </defs>
    <rect x="0" y="460" width="${CANVAS_SIZE}" height="${CANVAS_SIZE - 460}" fill="url(#scrim)"/>
    ${headlineSvg}
    <rect x="${CANVAS_SIZE / 2 - ctaWidth / 2}" y="${ctaY - 46}" width="${ctaWidth}" height="72" rx="36" fill="${theme.primary}"/>
    ${textEl("50%", ctaY, "middle", 32, ctaText)}
    <circle cx="106" cy="106" r="50" fill="#ffffff" fill-opacity="0.92"/>
  `
  return { svg, logoBox: { x: 66, y: 66, size: 80 } }
}

function buildProductFocus(headline: string, cta: string, theme: ColorTheme): OverlayResult {
  const lines = wrapText(headline.toUpperCase(), 20, 2)
  const fontSize = lines.length > 1 ? 52 : 62
  const lineHeight = fontSize * 1.15
  const bandTop = 800
  const headlineY = bandTop - 40 - (lines.length - 1) * lineHeight

  const headlineSvg = lines.map((line, i) => textEl("50%", headlineY + i * lineHeight, "middle", fontSize, line)).join("")
  const ctaText = cta.toUpperCase()

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
    ${textEl(`${CANVAS_SIZE - 60}`, bandTop + (CANVAS_SIZE - bandTop) / 2 + 12, "end", 34, ctaText)}
  `
  return { svg, logoBox: { x: 71, y: bandTop + (CANVAS_SIZE - bandTop) / 2 - 35, size: 70 } }
}

function buildQuoteCard(headline: string, cta: string, theme: ColorTheme): OverlayResult {
  const lines = wrapText(headline, 22, 3)
  const fontSize = lines.length > 2 ? 54 : lines.length > 1 ? 62 : 72
  const lineHeight = fontSize * 1.2
  const blockHeight = lines.length * lineHeight
  const startY = CANVAS_SIZE / 2 - blockHeight / 2 + fontSize * 0.75

  const headlineSvg = lines.map((line, i) => textEl("50%", startY + i * lineHeight, "middle", fontSize, line, 700)).join("")
  const ctaText = cta.toUpperCase()

  const svg = `
    <rect x="0" y="0" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" fill="#000000" fill-opacity="0.38"/>
    <text x="90" y="${startY - blockHeight - 20}" font-family="PostFont, sans-serif" font-weight="900" font-size="220" fill="${theme.secondary}" fill-opacity="0.5">&#8220;</text>
    ${headlineSvg}
    <rect x="0" y="${CANVAS_SIZE - 130}" width="${CANVAS_SIZE}" height="130" fill="#000000" fill-opacity="0.3"/>
    <circle cx="${CANVAS_SIZE / 2 - 90}" cy="${CANVAS_SIZE - 65}" r="30" fill="#ffffff" fill-opacity="0.9"/>
    ${textEl(`${CANVAS_SIZE / 2 + 20}`, CANVAS_SIZE - 55, "start", 26, ctaText)}
  `
  return { svg, logoBox: { x: CANVAS_SIZE / 2 - 120, y: CANVAS_SIZE - 95, size: 60 } }
}

function buildMinimal(headline: string, cta: string, theme: ColorTheme): OverlayResult {
  const lines = wrapText(headline.toUpperCase(), 18, 2)
  const fontSize = lines.length > 1 ? 46 : 54
  const lineHeight = fontSize * 1.15
  const blockHeight = lines.length * lineHeight
  const padX = 70
  const ctaFontSize = 24

  // Box height built up from its actual content (bar, headline block, CTA
  // line, padding) rather than a fixed guess — avoids the accent bar or
  // CTA colliding with the headline when line count/font size vary.
  const topPad = 40
  const barHeight = 4
  const gapBarToHeadline = 30
  const gapHeadlineToCta = 26
  const bottomPad = 34

  const headlineTop = topPad + barHeight + gapBarToHeadline
  const headlineFirstBaseline = headlineTop + fontSize * 0.8
  const ctaBaseline = headlineTop + blockHeight + gapHeadlineToCta + ctaFontSize * 0.8
  const boxHeight = ctaBaseline + bottomPad
  const boxY = CANVAS_SIZE - boxHeight

  const headlineSvg = lines
    .map((line, i) => textEl(`${padX}`, boxY + headlineFirstBaseline + i * lineHeight, "start", fontSize, line))
    .join("")
  const ctaText = cta.toUpperCase()

  const svg = `
    <rect x="0" y="${boxY}" width="${CANVAS_SIZE}" height="${boxHeight}" fill="#000000" fill-opacity="0.42"/>
    <rect x="${padX}" y="${boxY + topPad}" width="52" height="${barHeight}" fill="${theme.primary}"/>
    ${headlineSvg}
    ${textEl(`${padX}`, boxY + ctaBaseline, "start", ctaFontSize, ctaText, 700)}
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

  const { svg: overlaySvg, logoBox } = builder(headline, ctaText, options.colorTheme)
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
