// Pure colour / contrast math (WCAG luminance, contrast ratios, colour
// mixing) -- no image library, so it is safe in client components.
// lib/image/text-contrast.ts re-exports all of it next to its sharp-based
// image analysis; anything that can reach the browser (text-layouts,
// color-themes, BrandLookSection, ...) must import from HERE instead,
// because the bundler pulls sharp into the client build through
// text-contrast.ts even though sharp is loaded with a dynamic import there.

/** Required contrast for text: 3:1 for large text (headlines), 4.5:1 for body (WCAG AA). */
export const AA_LARGE = 3
export const AA_BODY = 4.5
/** Non-text graphics (marks, bars, dots) against their background: 3:1. */
export const AA_GRAPHIC = 3

/** Text colors' relative luminance: pure white, and TEXT_STYLE_PALETTE.dark (#111827). */
export const LIGHT_TEXT_L = 1
export const DARK_TEXT_L = 0.0098

/** sRGB channel (0-255) to linear light. */
export function channelToLinear(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** WCAG contrast ratio between two relative luminances. */
export function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1]!.length === 3 ? m[1]!.split("").map((c) => c + c).join("") : m[1]!
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

export function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`
}

/** WCAG relative luminance of a hex colour (0 for unparseable). */
export function hexLuminance(hex: string): number {
  const rgb = parseHex(hex)
  if (!rgb) return 0
  return 0.2126 * channelToLinear(rgb[0]) + 0.7152 * channelToLinear(rgb[1]) + 0.0722 * channelToLinear(rgb[2])
}

/** WCAG contrast ratio between two hex colours. */
export function hexContrast(a: string, b: string): number {
  return contrast(hexLuminance(a), hexLuminance(b))
}

/** `a` mixed toward `b` by t (0 = a, 1 = b), in sRGB. */
export function mixHex(a: string, b: string, t: number): string {
  const x = parseHex(a) ?? [0, 0, 0]
  const y = parseHex(b) ?? [0, 0, 0]
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t])
}

/** The candidate with the best contrast against `bg`. */
export function bestContrast(bg: string, candidates: string[]): string {
  return candidates.reduce((best, c) => (hexContrast(c, bg) > hexContrast(best, bg) ? c : best), candidates[0]!)
}

/**
 * `fg`, nudged toward black or white (whichever direction gains contrast)
 * just far enough to reach `ratio` against `bg` -- keeps the hue while it can.
 */
export function ensureContrast(fg: string, bg: string, ratio: number): string {
  if (hexContrast(fg, bg) >= ratio) return fg
  const toward = hexLuminance(bg) > 0.18 ? "#000000" : "#ffffff"
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const c = mixHex(fg, toward, t)
    if (hexContrast(c, bg) >= ratio) return c
  }
  return toward
}

/** `color` darkened (same hue) until its luminance is at most `maxL`. */
export function darkenTo(color: string, maxL: number): string {
  if (hexLuminance(color) <= maxL) return color
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const c = mixHex(color, "#000000", t)
    if (hexLuminance(c) <= maxL) return c
  }
  return "#000000"
}

/** `color` lightened (same hue) until its luminance is at least `minL`. */
export function lightenTo(color: string, minL: number): string {
  if (hexLuminance(color) >= minL) return color
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const c = mixHex(color, "#ffffff", t)
    if (hexLuminance(c) >= minL) return c
  }
  return "#ffffff"
}

// Brightest background body text (white) still clears 4.5:1 on; the dark-text
// counterpart is the dimmest. text_style scrims were computed for pure black /
// white at these limits.
const LIGHT_TEXT_MAX_BG = (LIGHT_TEXT_L + 0.05) / AA_BODY - 0.05
const DARK_TEXT_MIN_BG = AA_BODY * (DARK_TEXT_L + 0.05) - 0.05

/**
 * A text_style scrim tinted with a brand colour instead of pure black
 * (light text) or white (dark text), with its opacity raised so the
 * result is never lighter (darker) than the black (white) scrim it
 * replaces -- the text keeps the contrast textStyleFromStats computed.
 */
export function tintedScrimOpacity(opacity: number, tint: string, textColor: "light" | "dark"): number {
  if (opacity <= 0) return 0
  const L = hexLuminance(tint)
  const factor = textColor === "light"
    ? LIGHT_TEXT_MAX_BG / Math.max(0.01, LIGHT_TEXT_MAX_BG - L)
    : (1 - DARK_TEXT_MIN_BG) / Math.max(0.01, L - DARK_TEXT_MIN_BG)
  return Math.round(Math.min(1, opacity * factor) * 100) / 100
}

function hexToLab(hex: string): [number, number, number] {
  const rgb = parseHex(hex) ?? [0, 0, 0]
  const [r, g, b] = rgb.map(channelToLinear) as [number, number, number]
  // sRGB (D65) -> XYZ -> CIELAB.
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

/** CIE76 colour difference between two hex colours (~2.3 = just noticeable; under ~20 reads as "the same colour" at a glance). */
export function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = hexToLab(a)
  const [l2, a2, b2] = hexToLab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}
