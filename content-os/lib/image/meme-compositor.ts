import sharp from "sharp"

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
      return `<text x="50%" y="${y}" text-anchor="middle" font-family="'DejaVu Sans', Arial, sans-serif" font-weight="900" font-size="${fontSize}" fill="#ffffff" stroke="#000000" stroke-width="${strokeWidth}" paint-order="stroke" letter-spacing="1">${escapeXml(line)}</text>`
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

  return base
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer()
}
