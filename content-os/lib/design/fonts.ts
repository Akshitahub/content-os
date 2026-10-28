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
  { pattern: /luxur|elegan|premium|festive|editorial|classic|sophisticat|romantic|wedding|jewel|warm|cozy|cosy|soft/i, font: "playfair" },
  { pattern: /bold|dramatic|hype|sale|energetic|edgy|loud|street|sport|trendy|gen ?z/i, font: "anton" },
  { pattern: /play|fun|friendly|cute|whimsical|kid|cheer/i, font: "quicksand" },
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
/** The vibe rule's font, or null when no rule matches (unlike fallbackFontForVibe, no default). */
export function vibeRuleFont(vibe: string | null | undefined): FontId | null {
  if (!vibe) return null
  const text = vibe.replace(/_/g, " ")
  return VIBE_FONT_RULES.find((r) => r.pattern.test(text))?.font ?? null
}

/** The family name inside each @fontsource file -- lets a renderer load a
 * heading AND a body font and address each one by name. */
export const FONT_FAMILY_NAME: Record<FontId, string> = {
  anton: "Anton",
  inter: "Inter",
  playfair: "Playfair Display",
  quicksand: "Quicksand",
  caveat: "Caveat",
}

export type TypographyDensity = "normal" | "dense"

export interface BrandTypography {
  heading: FontId
  body: FontId
  /** Where the heading came from: the brand's saved fonts, its vibe rule, the model's pick, or the default. */
  source: "brand" | "vibe" | "model" | "default"
}

// Fonts that read fine as a headline but not as running text.
const HEADLINE_ONLY_FONTS = new Set<FontId>(["anton", "caveat", "playfair"])
const NEVER_DENSE_BODY = new Set<FontId>(["anton", "caveat"])

/**
 * The ONLY place a generation's fonts are decided (spec §7: brand-level
 * typography, not a per-generation pick):
 *   heading = brand_brain.visual.heading_font, else the brand vibe's rule
 *   font, else -- only when neither exists -- the model's suggested_font_id,
 *   else DEFAULT_FONT_ID;
 *   body = brand_brain.visual.body_font, else Inter under a headline-only
 *   face, else the heading font; "dense" text (lists, long body copy,
 *   checklist cards) never gets Caveat/Anton as body.
 * The user's manual per-slide pick in the editors still wins over all of this.
 */
export function resolveTypography(
  brand: { vibe?: string | null; brand_brain?: unknown },
  options: { density?: TypographyDensity; suggested?: unknown } = {},
): BrandTypography {
  const visual = (brand.brand_brain && typeof brand.brand_brain === "object" ? (brand.brand_brain as { visual?: unknown }).visual : null) as { heading_font?: unknown; body_font?: unknown } | null
  const savedHeading = isFontId(visual?.heading_font) ? visual!.heading_font as FontId : null
  const savedBody = isFontId(visual?.body_font) ? visual!.body_font as FontId : null
  const vibeFont = vibeRuleFont(brand.vibe)

  let heading: FontId
  let source: BrandTypography["source"]
  if (savedHeading) { heading = savedHeading; source = "brand" }
  else if (vibeFont) { heading = vibeFont; source = "vibe" }
  else if (isFontId(options.suggested)) { heading = options.suggested; source = "model" }
  else { heading = DEFAULT_FONT_ID; source = "default" }

  let body: FontId = savedBody ?? (HEADLINE_ONLY_FONTS.has(heading) ? "inter" : heading)
  if (options.density === "dense" && NEVER_DENSE_BODY.has(body)) body = "inter"
  return { heading, body, source }
}

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
