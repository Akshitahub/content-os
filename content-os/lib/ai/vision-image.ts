import sharp from "sharp"

/**
 * Images for Groq vision (MODELS.vision, qwen/qwen3.8-27b). Groq's limits
 * (console.groq.com/docs/vision, checked 2026-11-05): at most 3 images per
 * request, 20MB per image URL; each image counts as 2,048 input tokens. The
 * docs state no separate cap for base64 data URLs, so ours stay well under
 * the 4MB Groq has historically applied to base64 uploads: a data URL (the
 * Autopilot critic's PNG cover, a generated slide, a local reference post)
 * is re-encoded as a JPEG with its longest side at most 1536px. An https
 * URL passes through untouched (our stored images are already well under
 * 20MB). Server-only (sharp).
 */

export const VISION_MAX_IMAGES = 3
const MAX_SIDE_PX = 1536
const MAX_DATA_URL_BYTES = 3_500_000

/** A data: URL as a small JPEG data URL; any other URL unchanged. Falls back to the original if it can't be re-encoded. */
export async function visionImageUrl(url: string): Promise<string> {
  const m = url.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/)
  if (!m || !m[2]) return url
  try {
    return await visionImageFromBuffer(Buffer.from(m[3]!, "base64"))
  } catch (err) {
    console.error("[vision-image] couldn't re-encode a data URL (sending it as is):", err instanceof Error ? err.message : err)
    return url
  }
}

/** Image bytes as a JPEG data URL fit for one Groq vision image (<= 1536px, under 3.5MB). */
export async function visionImageFromBuffer(bytes: Buffer): Promise<string> {
  let side = MAX_SIDE_PX
  let quality = 85
  for (;;) {
    const jpg = await sharp(bytes).rotate().resize(side, side, { fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality }).toBuffer()
    const url = `data:image/jpeg;base64,${jpg.toString("base64")}`
    if (url.length <= MAX_DATA_URL_BYTES || side <= 512) return url
    side = Math.round(side * 0.75)
    quality = Math.max(60, quality - 10)
  }
}
