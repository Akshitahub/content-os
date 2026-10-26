// Mirrors lib/design/color-themes.ts's exact shape (CURATED_PALETTES +
// resolveColorThemes()/findColorTheme()) so font selection feels like the
// same system to anyone reading the code — a curated FontOption[] list
// plus resolveFonts()/findFont() helpers with the same signatures.

// Mirrors lib/validations/ai.ts's postFontEnum exactly — kept as its own
// literal union here (not imported from validations) the same way
// PostTemplateId (lib/design/post-templates.ts) and postTemplateEnum stay
// independently declared today.
export type FontId = "anton" | "inter" | "playfair" | "quicksand" | "caveat"

export interface FontOption {
  id: FontId
  label: string
  /** @fontsource package directory under node_modules/@fontsource/ — see
   * lib/image/post-compositor.ts's getFontPath(), which loads
   * node_modules/@fontsource/{packageName}/files/{fileName}, the exact
   * same packaging approach already used for the pre-existing Anton font. */
  packageName: string
  fileName: string
}

// Five curated faces covering distinct styles, per the task's own spec:
// one bold display face (the pre-existing Anton — kept as the default so
// existing behavior doesn't silently change for anyone not using the
// picker yet), one clean modern sans, one elegant serif, one rounded/
// friendly sans, one script/handwritten style.
export const CURATED_FONTS: FontOption[] = [
  { id: "anton", label: "Bold Display (Anton)", packageName: "anton", fileName: "anton-latin-400-normal.woff2" },
  { id: "inter", label: "Clean Modern (Inter)", packageName: "inter", fileName: "inter-latin-700-normal.woff2" },
  { id: "playfair", label: "Elegant Serif (Playfair Display)", packageName: "playfair-display", fileName: "playfair-display-latin-700-normal.woff2" },
  { id: "quicksand", label: "Rounded Friendly (Quicksand)", packageName: "quicksand", fileName: "quicksand-latin-700-normal.woff2" },
  { id: "caveat", label: "Script Handwritten (Caveat)", packageName: "caveat", fileName: "caveat-latin-700-normal.woff2" },
]

// The pre-existing font, before this picker existed — post-image/generate's
// request schema defaults to this id when none is specified, so a caller
// that predates the font picker gets byte-identical output to before.
export const DEFAULT_FONT_ID: FontId = "anton"

export function isFontId(value: unknown): value is FontId {
  return typeof value === "string" && CURATED_FONTS.some((f) => f.id === value)
}

// Deterministic fallback for when the copy model's suggested_font_id is
// missing or not one of the five ids. Brand vibe is free text (onboarding
// lets users type their own), so this matches keywords in order -- the
// first rule that hits wins. Caveat is only for an explicitly personal /
// handmade brand; it's hard to read in long body text.
const VIBE_FONT_RULES: { pattern: RegExp; font: FontId }[] = [
  { pattern: /hand ?made|handcraft|artisan|personal|diary|journal|scrapbook/i, font: "caveat" },
  { pattern: /luxur|elegan|premium|festive|editorial|classic|sophisticat|romantic|wedding|jewel/i, font: "playfair" },
  { pattern: /bold|dramatic|hype|sale|energetic|edgy|loud|street|sport|trendy|gen ?z/i, font: "anton" },
  { pattern: /play|fun|friendly|cute|whimsical|kid|cheer|cozy|warm|soft/i, font: "quicksand" },
  { pattern: /clean|minimal|professional|corporate|saas|tech|modern|simple|b2b|finance/i, font: "inter" },
]

/** Fallback font for a brand vibe and/or a content vibe (e.g. the carousel's
 * own "warm_cozy" -- underscores are treated as spaces). Checks each vibe
 * in the order given; DEFAULT_FONT_ID if none matches. */
export function fallbackFontForVibe(...vibes: (string | null | undefined)[]): FontId {
  for (const vibe of vibes) {
    if (!vibe) continue
    const text = vibe.replace(/_/g, " ")
    const rule = VIBE_FONT_RULES.find((r) => r.pattern.test(text))
    if (rule) return rule.font
  }
  return DEFAULT_FONT_ID
}

/** The model's suggested_font_id when it's a real id, otherwise the
 * vibe-based fallback above. */
export function resolveSuggestedFont(suggested: unknown, ...vibes: (string | null | undefined)[]): FontId {
  return isFontId(suggested) ? suggested : fallbackFontForVibe(...vibes)
}

/** The curated list; the starting font for a new Post / Carousel / Story
 * comes from resolveSuggestedFont above, and the user can change it after. */
export function resolveFonts(): FontOption[] {
  return CURATED_FONTS
}

export function findFont(fonts: FontOption[], id: string | undefined): FontOption {
  return fonts.find((f) => f.id === id) ?? fonts.find((f) => f.id === DEFAULT_FONT_ID) ?? fonts[0]!
}

// Shared text-size scale options for every text_size_scale-aware picker
// (Post Maker, Story, Carousel) — a single multiplier applied to whatever
// base font sizes that surface's own compositor already computes, not an
// absolute pixel size (each surface's templates have very different base
// sizes). Server-side validation (lib/validations/ai.ts) allows a wider
// 0.7-1.5 range than these four presets for headroom, but the picker itself
// only ever offers these curated stops.
export const DEFAULT_TEXT_SIZE_SCALE = 1.0

export interface TextSizeOption {
  scale: number
  label: string
}

export const TEXT_SIZE_OPTIONS: TextSizeOption[] = [
  { scale: 0.85, label: "Small" },
  { scale: 1.0, label: "Default" },
  { scale: 1.15, label: "Large" },
  { scale: 1.3, label: "XL" },
]
