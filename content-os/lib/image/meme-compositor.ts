import sharp from "sharp"
import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { Resvg } from "@resvg/resvg-js"
import { decompress } from "wawoff2"

// Bundled directly (rather than relying on a system font name like "DejaVu
// Sans") since Vercel's serverless Linux environment has no guarantee that
// any particular font is installed — without an embedded font, the renderer
// has nothing to render glyphs with and falls back to tofu boxes (□□□).
//
// This used to embed the font as base64 into an SVG @font-face rule and let
// sharp (via librsvg) rasterize it, but librsvg does not reliably support
// @font-face with base64-embedded fonts — it silently fails to load the
// font and produces tofu boxes instead of an error. resvg-js loads custom
// fonts directly (bypassing @font-face) and does so reliably, but its
// underlying font loader only accepts raw TrueType/OpenType files, not
// woff/woff2 — passing the woff2 straight through also silently fails
// ("malformed font"). @fontsource/anton only ships woff/woff2, so it's
// decompressed to a raw TTF once and cached on disk in /tmp (the one
// writable path in that environment) across invocations of the same warm
// serverless instance.
let cachedFontPath: string | null = null

async function getFontPath(): Promise<string> {
  if (cachedFontPath && existsSync(cachedFontPath)) return cachedFontPath

  const woff2Path = join(process.cwd(), "node_modules/@fontsource/anton/files/anton-latin-400-normal.woff2")
  const ttfBuffer = await decompress(readFileSync(woff2Path))

  const ttfPath = join(tmpdir(), "meme-compositor-anton.ttf")
  writeFileSync(ttfPath, ttfBuffer)
  cachedFontPath = ttfPath
  return ttfPath
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function wrapText(text: string, maxCharsPerLine: number): string[] {
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
  return lines.slice(0, 3)
}

function buildCaptionSvgGroup(text: string, width: number, baselineY: number, lineHeight: number, fontSize: number, direction: "down" | "up"): string {
  if (!text.trim()) return ""
  const maxCharsPerLine = Math.max(6, Math.floor((width * 0.9) / (fontSize * 0.6)))
  const lines = wrapText(text.toUpperCase(), maxCharsPerLine)
  const strokeWidth = Math.max(2, Math.round(fontSize * 0.07))

  return lines
    .map((line, i) => {
      const y = direction === "down" ? baselineY + i * lineHeight : baselineY - (lines.length - 1 - i) * lineHeight
      return `<text x="50%" y="${y}" text-anchor="middle" font-family="MemeFont, sans-serif" font-weight="900" font-size="${fontSize}" fill="#ffffff" stroke="#000000" stroke-width="${strokeWidth}" paint-order="stroke" letter-spacing="1">${escapeXml(line)}</text>`
    })
    .join("")
}

export async function compositeMemeText(
  imageBuffer: Buffer,
  topText: string,
  bottomText: string
): Promise<Buffer> {
  const base = sharp(imageBuffer)
  const meta = await base.metadata()
  const width = meta.width ?? 1080
  const height = meta.height ?? 1080
  const fontSize = Math.round(width * 0.075)
  const lineHeight = Math.round(fontSize * 1.15)

  const topSvg = buildCaptionSvgGroup(topText, width, fontSize * 1.15, lineHeight, fontSize, "down")
  const bottomSvg = buildCaptionSvgGroup(bottomText, width, height - fontSize * 0.55, lineHeight, fontSize, "up")

  if (!topSvg && !bottomSvg) {
    return base.png().toBuffer()
  }

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${topSvg}${bottomSvg}</svg>`

  const fontPath = await getFontPath()
  const resvg = new Resvg(svg, {
    font: {
      fontFiles: [fontPath],
      loadSystemFonts: false,
      defaultFontFamily: "MemeFont",
    },
  })
  const textLayerPng = resvg.render().asPng()

  return base
    .composite([{ input: textLayerPng, top: 0, left: 0 }])
    .png()
    .toBuffer()
}
