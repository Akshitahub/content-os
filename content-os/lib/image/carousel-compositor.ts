import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
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

function textLines(lines: string[], startY: number, lineHeight: number, fontSize: number, color: string, weight: number): string {
  return lines
    .map((line, i) => `<text x="50%" y="${startY + i * lineHeight}" text-anchor="middle" font-family="CarouselFont, sans-serif" font-weight="${weight}" font-size="${fontSize}" fill="${color}">${escapeXml(line)}</text>`)
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
