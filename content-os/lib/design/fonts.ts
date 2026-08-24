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

/**
 * v1 is user-selectable only — no AI auto-pick-by-brand-vibe logic yet.
 * That's a reasonable, explicitly-flagged follow-up once the picker itself
 * is live and used, not a blocker for shipping font selection at all.
 */
export function resolveFonts(): FontOption[] {
  return CURATED_FONTS
}

export function findFont(fonts: FontOption[], id: string | undefined): FontOption {
  return fonts.find((f) => f.id === id) ?? fonts.find((f) => f.id === DEFAULT_FONT_ID) ?? fonts[0]!
}
