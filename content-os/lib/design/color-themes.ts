import type { BrandRow } from "@/types/database"

export interface ColorTheme {
  id: string
  label: string
  primary: string
  secondary: string
}

// Always offered alongside brand-derived colors (not just as a no-color
// fallback) so the selector is a genuine choice either way — brands with
// saved colors still get variety, brands with none get real options
// instead of an empty/single-option selector.
export const CURATED_PALETTES: ColorTheme[] = [
  { id: "curated_violet", label: "Violet", primary: "#6366f1", secondary: "#818cf8" },
  { id: "curated_sunset", label: "Sunset", primary: "#f97316", secondary: "#fb923c" },
  { id: "curated_forest", label: "Forest", primary: "#16a34a", secondary: "#4ade80" },
  { id: "curated_midnight", label: "Midnight", primary: "#1e293b", secondary: "#475569" },
]

const HEX_RE = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i

/** Crude lighten-toward-white — good enough as a derived "secondary" when
 * the brand only has one saved color. */
function lighten(hex: string): string {
  const m = HEX_RE.exec(hex)
  if (!m) return hex
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((h) => Math.round(parseInt(h, 16) * 0.6 + 255 * 0.4))
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`
}

/**
 * Resolves the color-theme choices for a brand — the brand's own saved
 * colors first (pre-selected default), always followed by the curated
 * presets. Used identically on the client (render swatches) and the server
 * (re-derive the actual hex for a submitted colorThemeId from the same
 * brand row already fetched, rather than trusting client-supplied colors).
 */
export function resolveColorThemes(
  brand: Pick<BrandRow, "primary_color" | "color_palette"> | null | undefined
): ColorTheme[] {
  const palette = brand?.color_palette as Record<string, unknown> | null | undefined
  const paletteColors = palette ? Object.values(palette).filter((v): v is string => typeof v === "string") : []
  const primary = brand?.primary_color || paletteColors[0] || null

  if (!primary) return CURATED_PALETTES

  const secondary = paletteColors.find((c) => c !== primary) ?? lighten(primary)
  return [{ id: "brand", label: "Brand colors", primary, secondary }, ...CURATED_PALETTES]
}

export function findColorTheme(themes: ColorTheme[], id: string | undefined): ColorTheme {
  return themes.find((t) => t.id === id) ?? themes[0]!
}
