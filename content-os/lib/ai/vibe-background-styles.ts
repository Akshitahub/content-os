// Shared by lib/ai/carousel-slide-background.ts and lib/ai/story-slide-background.ts
// — both build abstract/atmospheric AI backgrounds keyed off the same
// brand "vibe" concept (components/shared/VibePicker.tsx's Vibe id), just
// for different canvas shapes (carousel: square, stories: portrait).

export type Vibe =
  | "fun_playful"
  | "clean_minimal"
  | "bold_dramatic"
  | "warm_cozy"
  | "professional"
  | "trendy_genz"

export const DEFAULT_VIBE: Vibe = "clean_minimal"

// Abstract/atmospheric direction per vibe — deliberately NOT literal product
// or scene photography (unlike post-image-pipeline.ts's PHOTOGRAPHY_STYLE),
// since these sit directly behind live text and need to stay uncluttered.
export const VIBE_BACKGROUND_STYLES: Record<Vibe, string> = {
  fun_playful: "vibrant abstract gradient background with playful organic blob shapes, bright energetic color transitions, soft glowing light",
  clean_minimal: "minimalist abstract background, soft subtle gradient, generous negative space, gentle geometric shapes, understated texture",
  bold_dramatic: "high-contrast abstract gradient background, dramatic dark tones with a bold streak of accent color, moody atmospheric lighting, strong geometric shapes",
  warm_cozy: "warm abstract gradient background, soft glowing light, cozy amber and terracotta tones, gentle organic texture",
  professional: "sophisticated abstract gradient background, subtle geometric pattern, muted corporate-appropriate tones, clean structured composition",
  trendy_genz: "vibrant holographic abstract gradient background, iridescent color shift, bold abstract shapes, glossy Y2K-inspired texture",
}

// Same fallback swatches components/shared/VibePicker.tsx shows the user
// per vibe — duplicated here (rather than imported) since that component is
// a "use client" file and these run server-side. Only used when the brand
// has no colors of its own set yet.
export const VIBE_FALLBACK_COLORS: Record<Vibe, string[]> = {
  fun_playful: ["#FF6B6B", "#FFE66D", "#4ECDC4"],
  clean_minimal: ["#FFFFFF", "#F5F5F5", "#333333"],
  bold_dramatic: ["#000000", "#6366F1", "#EC4899"],
  warm_cozy: ["#F59E0B", "#EF4444", "#FEF3C7"],
  professional: ["#1E40AF", "#FFFFFF", "#1F2937"],
  trendy_genz: ["#7C3AED", "#EC4899", "#06B6D4"],
}

// Deliberately NOT lib/ai/prompts.ts's IMAGE_QUALITY_SAFETY_BOILERPLATE —
// that one opens with "professional photography" and includes an anatomy
// clause, both aimed at literal photographic content (post images,
// products, memes). Reusing it here would fight the abstract-only
// direction these prompts are built around.
export const ABSTRACT_SAFETY_BOILERPLATE = "no watermarks, no illegible text or symbols, clean high-resolution render, sharp focus"

const HEX_RE = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i

const HUE_NAMES: [max: number, name: string][] = [
  [10, "red"],
  [25, "orange-red"],
  [45, "orange"],
  [55, "amber"],
  [70, "yellow"],
  [90, "yellow-green"],
  [150, "green"],
  [190, "teal"],
  [200, "cyan"],
  [250, "blue"],
  [275, "indigo"],
  [300, "purple"],
  [330, "magenta"],
  [350, "pink"],
  [360, "red"],
]

function hueName(h: number): string {
  return HUE_NAMES.find(([max]) => h <= max)?.[1] ?? "red"
}

/**
 * Converts a brand hex color into a short plain-English color phrase (e.g.
 * "a vibrant orange-red", "a soft pastel blue") for use in image-generation
 * prompts. Diffusion models reliably follow descriptive color language but
 * not raw hex notation — confirmed via real Pollinations testing (see
 * docs/research/seedream-5-lite-evaluation.md): prompts asking for "color
 * palette centered around #FF5733" produced output containing none of that
 * color, on repeated tests. Returns null for anything that isn't a valid
 * 6-digit hex so callers can fall back cleanly.
 */
export function describeColor(hex: string): string | null {
  const m = HEX_RE.exec(hex)
  if (!m) return null
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((h) => parseInt(h, 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  const l = (max + min) / 2

  if (delta === 0) {
    if (l < 0.15) return "a near-black neutral"
    if (l > 0.9) return "a near-white neutral"
    return "a neutral gray"
  }

  const s = delta / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === r) h = 60 * (((g - b) / delta) % 6)
  else if (max === g) h = 60 * ((b - r) / delta + 2)
  else h = 60 * ((r - g) / delta + 4)
  if (h < 0) h += 360

  const name = hueName(h)

  let tone: string
  if (l > 0.85) tone = "pale pastel"
  else if (l > 0.65) tone = s > 0.5 ? "bright" : "soft"
  else if (l > 0.35) tone = s > 0.6 ? "vibrant" : "muted"
  else tone = s > 0.4 ? "deep" : "dark muted"

  return `a ${tone} ${name}`
}
