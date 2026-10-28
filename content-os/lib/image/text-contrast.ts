import sharp from "sharp"
import type { TextRegion, TextStyle } from "@/lib/design/text-style"

// WCAG 2.x targets: headline (large text) 3:1, body 4.5:1.
const HEADLINE_CONTRAST = 3
const BODY_CONTRAST = 4.5
const MAX_SCRIM = 0.75
// Luminance standard deviation above which a region reads as busy (fine
// detail, hard edges) -- a uniform scrim alone leaves letters fighting it.
const BUSY_STD = 0.2
// Text colors' relative luminance: pure white, and TEXT_STYLE_PALETTE.dark (#111827).
const LIGHT_TEXT_L = 1
const DARK_TEXT_L = 0.0098

function channelToLinear(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** Black scrim alpha so light text over luminance L reaches `ratio`. */
function lightScrimFor(L: number, ratio: number): number {
  const maxBg = (LIGHT_TEXT_L + 0.05) / ratio - 0.05
  return L <= maxBg ? 0 : 1 - maxBg / L
}

/** White scrim alpha so dark text over luminance L reaches `ratio`. */
function darkScrimFor(L: number, ratio: number): number {
  const minBg = ratio * (DARK_TEXT_L + 0.05) - 0.05
  return L >= minBg ? 0 : (minBg - L) / (1 - L)
}

function percentile(sorted: Float64Array, p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))]!
}

export interface RegionStats {
  mean: number
  std: number
  /** 10th/90th-percentile luminance -- the darkest/brightest parts text will cross. */
  low: number
  high: number
}

/** Relative luminance (WCAG) statistics of one region of an image. */
export async function regionLuminance(image: Buffer, region: TextRegion): Promise<RegionStats> {
  const meta = await sharp(image).metadata()
  const W = meta.width ?? 0
  const H = meta.height ?? 0
  if (!W || !H) throw new Error("text-contrast: image has no dimensions")
  const left = Math.min(W - 1, Math.max(0, Math.round(region.x * W)))
  const top = Math.min(H - 1, Math.max(0, Math.round(region.y * H)))
  const width = Math.max(1, Math.min(W - left, Math.round(region.w * W)))
  const height = Math.max(1, Math.min(H - top, Math.round(region.h * H)))

  // Downsampled to a fixed grid: deterministic, and the statistics don't
  // need every pixel. Nearest-neighbour keeps real pixel values, so a busy
  // region isn't averaged into a flat grey.
  const { data, info } = await sharp(image)
    .extract({ left, top, width, height })
    .resize(64, 64, { fit: "fill", kernel: "nearest" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const n = info.width * info.height
  const lum = new Float64Array(n)
  let sum = 0
  for (let i = 0; i < n; i++) {
    const o = i * info.channels
    const L = 0.2126 * channelToLinear(data[o]!) + 0.7152 * channelToLinear(data[o + 1]!) + 0.0722 * channelToLinear(data[o + 2]!)
    lum[i] = L
    sum += L
  }
  const mean = sum / n
  let sq = 0
  for (let i = 0; i < n; i++) sq += (lum[i]! - mean) ** 2
  lum.sort()
  return { mean, std: Math.sqrt(sq / n), low: percentile(lum, 0.1), high: percentile(lum, 0.9) }
}

/**
 * The text treatment for one region, pure in its statistics: light or dark
 * text, whichever needs the lighter scrim (light when `preferLight`, e.g. a
 * template whose text is always white), with the scrim strong enough that
 * the headline clears 3:1 and body text 4.5:1 against the region's
 * brightest (for light text) or darkest (for dark text) 10% -- body copy
 * crosses those parts too, not just the average. A busy region, or one
 * that would need more than MAX_SCRIM, also gets a backing panel.
 */
export function textStyleFromStats(stats: RegionStats, options: { preferLight?: boolean } = {}): TextStyle {
  const light = Math.max(lightScrimFor(stats.high, HEADLINE_CONTRAST), lightScrimFor(stats.high, BODY_CONTRAST))
  const dark = Math.max(darkScrimFor(stats.low, HEADLINE_CONTRAST), darkScrimFor(stats.low, BODY_CONTRAST))
  const useLight = options.preferLight || light <= dark
  const needed = useLight ? light : dark
  const busy = stats.std > BUSY_STD
  return {
    text_color: useLight ? "light" : "dark",
    scrim_opacity: Math.round(Math.min(MAX_SCRIM, needed + (busy ? 0.1 : 0)) * 100) / 100,
    needs_backing: busy || needed > MAX_SCRIM,
  }
}

export async function computeTextStyle(image: Buffer, region: TextRegion, options: { preferLight?: boolean } = {}): Promise<TextStyle> {
  return textStyleFromStats(await regionLuminance(image, region), options)
}

/** Fail-soft wrapper for generation routes: a broken image never fails the
 * generation over this -- null just means renderers keep their old scrim. */
export async function computeTextStyleSafe(image: Buffer, region: TextRegion, options: { preferLight?: boolean } = {}): Promise<TextStyle | null> {
  try {
    return await computeTextStyle(image, region, options)
  } catch (err) {
    console.error("[text-contrast] couldn't compute text_style (non-fatal):", err instanceof Error ? err.message : err)
    return null
  }
}

/** Contrast the chosen style actually achieves over a region of luminance L (for checks). */
export function achievedContrast(style: TextStyle, L: number): number {
  if (style.text_color === "light") return contrast(LIGHT_TEXT_L, L * (1 - style.scrim_opacity))
  return contrast(DARK_TEXT_L, L + style.scrim_opacity * (1 - L))
}
