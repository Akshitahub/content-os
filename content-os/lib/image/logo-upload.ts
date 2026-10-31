import sharp from "sharp"
import { plainBackgroundColor } from "@/lib/image/subject-boxes"
import { cutOut } from "@/lib/image/story-frame-compositor"

/**
 * A brand's uploaded logo, made ready for every frame
 * (lib/image/story-frame-compositor.ts placeMark):
 * - SVG is rasterised here (never stored or served as SVG -- an uploaded
 *   SVG can carry script);
 * - a JPG (or a PNG without transparency) on a plain background gets that
 *   background removed;
 * - transparent margins are trimmed;
 * - a one-colour contrast variant is made: light for a dark logo, dark for
 *   a light one -- the frame uses whichever reads on the photo under it.
 */

export const LOGO_MAX_BYTES = 5 * 1024 * 1024
export const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/svg+xml"])
const MAX_SIDE = 1200

export interface ProcessedLogo {
  main: Buffer
  variant: Buffer
  /** Mean luminance of the logo's opaque pixels (0 dark .. 1 light). */
  luminance: number
  /** Whether the original reads on a light / a dark background (3:1 against white / near-black). */
  readsOnLight: boolean
  readsOnDark: boolean
  backgroundRemoved: boolean
}

function relLum(v: number): number {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export async function processLogo(bytes: Buffer, mimeType: string): Promise<ProcessedLogo> {
  let img = mimeType === "image/svg+xml"
    ? await sharp(bytes, { density: 300 }).resize(MAX_SIDE, MAX_SIDE, { fit: "inside" }).png().toBuffer()
    : await sharp(bytes).rotate().resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true }).png().toBuffer()

  // No real transparency and a plain background: cut it out.
  let backgroundRemoved = false
  const { data: probe, info: probeInfo } = await sharp(img).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let opaque = true
  for (let i = 3; i < probe.length; i += 4 * 16) if (probe[i]! < 250) { opaque = false; break }
  if (opaque) {
    const bg = await plainBackgroundColor(img)
    const cut = bg ? await cutOut(img, bg).catch(() => null) : null
    if (cut) {
      img = cut.png
      backgroundRemoved = true
    }
  }
  void probeInfo
  const trimmed = await sharp(img).ensureAlpha().trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 }).png().toBuffer().catch(() => img)

  const { data, info } = await sharp(trimmed).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let lumSum = 0, linSum = 0, n = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 128) continue
    lumSum += (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255
    linSum += 0.2126 * relLum(data[i]!) + 0.7152 * relLum(data[i + 1]!) + 0.0722 * relLum(data[i + 2]!)
    n++
  }
  const luminance = n ? lumSum / n : 0.5
  const L = n ? linSum / n : 0.5
  const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  const readsOnLight = contrast(L, 1) >= 3
  const readsOnDark = contrast(L, relLum(17)) >= 3

  // The contrast variant: the logo's shape in one colour -- white for a dark logo, near-black for a light one.
  const ink = luminance < 0.5 ? 255 : 17
  const mono = Buffer.from(data)
  for (let i = 0; i < mono.length; i += 4) {
    mono[i] = ink
    mono[i + 1] = ink
    mono[i + 2] = ink
  }
  const variant = await sharp(mono, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer()
  return { main: trimmed, variant, luminance, readsOnLight, readsOnDark, backgroundRemoved }
}
