// Format-neutral "visual brief" -- what one slide/frame's AI background must
// show -- shared by carousels and stories (moved out of types/app.ts,
// lib/ai/carousel-generator.ts and lib/ai/carousel-slide-background.ts).
// Pure: no server-only imports, so client code can use the types and kinds.

import type { ArtDirection } from "./brand-brain"
import { describeColor } from "./vibe-background-styles"

export const VISUAL_KINDS = [
  "product_scene", "side_by_side", "material_swatches", "process_sequence",
  "sketch_or_drawing", "detail_closeup", "before_after", "abstract_mood",
] as const
export type VisualKind = (typeof VISUAL_KINDS)[number]
export type VisualBrief = {
  kind: VisualKind
  /** Only visible things -- objects, arrangement, angle. Never text. */
  must_show: string
  /** Where the subject sits and where the overlaid text goes. */
  composition: string
  /** side_by_side / before_after only: what each half shows (visible things
   * only, <= 200 chars). With both, the halves are generated as two images
   * and composited (lib/ai/split-layer.ts). */
  left?: string
  right?: string
}

export const SPLIT_KINDS = new Set<VisualKind>(["side_by_side", "before_after"])
const HALF_TEXT_MAX = 200

/** A split brief with both halves -- what the two-image split layer needs. */
export function hasSplitHalves(brief: VisualBrief | undefined): brief is VisualBrief & { left: string; right: string } {
  return !!brief && SPLIT_KINDS.has(brief.kind) && !!brief.left && !!brief.right
}

// ─── Sanitizing the model's brief ──────────────────────────────────────────

const VISUAL_TEXT_MAX = 300

// Quoted text in an image brief is exactly what the image model renders as
// garbled on-image lettering (see lib/ai/carousel-slide-background.ts), so
// any quoted span is removed. Single quotes only count at word boundaries
// so apostrophes ("brand's") survive.
function stripQuoted(text: string): string {
  return text
    .replace(/"[^"]*"|“[^”]*”|‘[^’]*’/g, "")
    .replace(/(^|[\s([])'[^']+'(?=$|[\s.,;:!?)\]])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim()
}

function clampText(text: string, max = VISUAL_TEXT_MAX): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const lastSpace = cut.lastIndexOf(" ")
  return (lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trim()
}

/**
 * Code-side safety for a slide's "visual" brief (the prompt alone isn't
 * trusted): unknown kind -> "product_scene", quoted text stripped, length
 * capped. Returns undefined for a missing/invalid brief so callers fall
 * back to today's background-only behaviour.
 */
export function sanitizeVisualBrief(raw: unknown): VisualBrief | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined
  const v = raw as Record<string, unknown>
  const mustShow = typeof v.must_show === "string" ? clampText(stripQuoted(v.must_show)) : ""
  if (!mustShow) return undefined
  const kind: VisualKind = (VISUAL_KINDS as readonly string[]).includes(v.kind as string)
    ? (v.kind as VisualKind)
    : "product_scene"
  const composition = typeof v.composition === "string" ? clampText(stripQuoted(v.composition)) : ""
  // Halves only for split kinds, sanitized like must_show, and only as a
  // pair -- one half alone can't drive a two-image split.
  const half = (x: unknown) => (typeof x === "string" ? clampText(stripQuoted(x), HALF_TEXT_MAX) : "")
  const left = SPLIT_KINDS.has(kind) ? half(v.left) : ""
  const right = SPLIT_KINDS.has(kind) ? half(v.right) : ""
  return left && right ? { kind, must_show: mustShow, composition, left, right } : { kind, must_show: mustShow, composition }
}

// ─── Turning a brief into an image-prompt scene ────────────────────────────

// Photographic, not illustrative, unless the kind itself says otherwise.
// No quoted words anywhere (e.g. before/after) -- a quoted word is exactly
// what the image model renders as literal on-image text. abstract_mood's
// opener is format-specific (carousel slide vs. vertical story frame), so
// each caller passes its own -- see briefScene.
export const BRIEF_FRAMING: Record<Exclude<VisualKind, "abstract_mood">, string> = {
  product_scene: "a photorealistic scene featuring",
  side_by_side: "a split composition with two clearly separated halves side by side, comparing",
  before_after: "a split composition, left half the before state and right half the after state, showing",
  material_swatches: "a top-down flat-lay of physical material samples and finishes arranged in a neat grid:",
  // Objects at each stage -- never the same person repeated across stages.
  process_sequence: "three to four stages of a process shown as objects arranged left to right in one frame, no person repeated:",
  sketch_or_drawing: "a hand-drawn pencil or ink sketch on paper, photographed on a desk:",
  detail_closeup: "a macro close-up photograph of",
}

// Kinds whose scene is not "the product in a setting" -- a product reference
// photo would fight the brief (a sketch, swatches, a sequence, a two-way
// comparison), so those slides use the non-reference path.
export const BRIEF_KINDS_WITHOUT_PRODUCT_REFERENCE = new Set<VisualKind>(["sketch_or_drawing", "material_swatches", "process_sequence", "side_by_side"])

export const SPLIT_LABEL_GUARD = "no dividing labels, captions or arrows — the two halves are separated only by composition"

/** framing line + must_show. `abstractOpener` is the caller's own abstract-background opener, used for abstract_mood. */
export function briefScene(brief: VisualBrief, abstractOpener: string): string {
  const framing = brief.kind === "abstract_mood" ? `${abstractOpener}, evoking` : BRIEF_FRAMING[brief.kind]
  return `${framing} ${brief.must_show}`
}

/** One half of a split brief as its own single-subject brief, for the split
 * layer's per-half prompt (the format's normal brief prompt, same guards). */
export function halfBrief(text: string): VisualBrief {
  return { kind: "product_scene", must_show: text, composition: "single subject centred in a narrow vertical frame" }
}

/** Which half of a split keeps the product reference: none for side_by_side
 * (a two-way comparison), only the after (right) half for before_after. */
export function halfUsesProductReference(brief: VisualBrief, side: "left" | "right"): boolean {
  return brief.kind === "before_after" && side === "right"
}

/** Whether a slide with this brief keeps the product reference photo (see BRIEF_KINDS_WITHOUT_PRODUCT_REFERENCE). */
export function briefUsesProductReference(brief: VisualBrief | undefined): boolean {
  return !brief || !BRIEF_KINDS_WITHOUT_PRODUCT_REFERENCE.has(brief.kind)
}

// ─── No text-bearing subjects ──────────────────────────────────────────────
// A brief that asks for a screen, a document or a sign contradicts every
// image prompt's "no text" guard -- and the image model draws the words
// anyway, as garbled lettering. Briefs show such things only indirectly;
// readable words belong to the text overlay.

/** The prompt rule every brief prompt (carousel, story, post, ad) carries. */
/**
 * One photograph, one moment: an image that shows the same person several
 * times (a "three moments of the same man" sequence) or is built from
 * panels reads as a broken collage -- confirmed live (2026-10-31): a Full
 * Post brief asked for "three candid left-to-right moments of the same
 * man" and the image model drew exactly that.
 */
export const SINGLE_PHOTO_RULE = `- ONE photograph of ONE moment: never the same person more than once in the image, never panels, a collage or a grid. For a sequence of someone's actions, show the single most telling moment; a sequence of stages uses objects, not a repeated person.`

export const NO_TEXT_BEARING_SUBJECTS_RULE = `${SINGLE_PHOTO_RULE}
- The scene must NEVER centre on or prominently show anything that normally carries readable text: phone, tablet or laptop screens, documents, notebooks with writing, sticky notes with words, signs, packaging labels with copy, calendars, dashboards or charts. If the idea needs one (e.g. "a content calendar"), show it indirectly: the device face-down or its screen dark or out of focus, the person's reaction, or the physical result. Readable words belong to the text overlay, never the image.`

// Objects that normally carry readable text. Packaging/labels are allowed
// when the brand's real product photo is the image reference (its real label).
const TEXT_BEARING_TERMS: { pattern: RegExp; packaging?: boolean }[] = [
  { pattern: /\b(smart)?phones?\b|\bmobiles?\b|\bcellphones?\b/ },
  { pattern: /\btablets?\b|\bipads?\b|\blaptops?\b|\bcomputers?\b|\bmonitors?\b|\bscreens?\b|\btvs?\b|\btelevisions?\b/ },
  { pattern: /\bapps?\b|\bwebsites?\b|\binterfaces?\b|\bdashboards?\b/ },
  { pattern: /\bdocuments?\b|\breports?\b|\binvoices?\b|\breceipts?\b|\bcontracts?\b|\bmenus?\b|\bbrochures?\b|\bflyers?\b|\bleaflets?\b|\bposters?\b|\bmagazines?\b|\bnewspapers?\b|\bspreadsheets?\b|\bdesign briefs?\b/ },
  { pattern: /\bnotebooks?\b|\bnotepads?\b|\bsticky notes?\b|\bpost-its?\b|\bwhiteboards?\b|\bchalkboards?\b|\bblackboards?\b/ },
  { pattern: /\bsigns?\b|\bsignage\b|\bbillboards?\b|\bbanners?\b|\bplacards?\b|\bnameplates?\b|\bplaques?\b/ },
  { pattern: /\bcalendars?\b|\bplanners?\b|\bcharts?\b|\bgraphs?\b|\binfographics?\b|\bchecklists?\b/ },
  { pattern: /\blabels?\b|\bpackaging\b|\bprice tags?\b/, packaging: true },
]

// A qualifier that keeps the object from showing readable text.
const NO_TEXT_QUALIFIER = /\bface[- ]?down\b|\bturned over\b|\bupside down\b|\bscreen (?:is )?(?:dark|off|black|blank)\b|\b(?:dark|black|blank|switched[- ]off|turned[- ]off) screen\b|\bswitched off\b|\bturned off\b|\bout of focus\b|\bunfocused\b|\bblurr?(?:ed|y)\b|\bsoft[- ]focus\b|\bbokeh\b|\billegible\b|\bunreadable\b|\bblank\b|\bclosed\b|\bno (?:visible |readable )?(?:text|writing|words|lettering)\b|\bwithout (?:any )?(?:text|writing|words|lettering)\b/

// The object is showing something on it -- then only a qualifier in that
// same clause clears it ("a phone displaying a checkout page, its screen
// blurred" still renders the page).
const DISPLAYING = /\b(?:showing|shows|displaying|displays|open (?:to|on)|lit up with|playing|on (?:the |its )?screen)\b/
// The next clause opens by referring back to the object ("…a phone, its screen dark").
const REFERS_BACK = /^(?:its|it's|it is|the screen|screen|their screen|whose screen)\b/
// Within 3 words before "tablet(s)": a medicine / supplement tablet, not a device.
const MEDICINE_CONTEXT = /\b(?:vitamins?|supplements?|medicines?|medicinal|pills?|capsules?|ayurvedic|herbal|dissolving|effervescent|calcium|iron)\b/

/** A word match that isn't the text-bearing object: "signs of aging", "vitamin tablets", "a tablet of soap". */
function isOtherSense(word: string, clause: string, index: number): boolean {
  const after = clause.slice(index + word.length)
  if (/^signs?$/.test(word)) return /^\s+of\b/.test(after)
  if (/^tablets?$/.test(word)) {
    const before = clause.slice(0, index).trim().split(/\s+/).slice(-3).join(" ")
    return /^\s+of\b/.test(after) || MEDICINE_CONTEXT.test(before)
  }
  return false
}

/**
 * The text-bearing object a brief shows without a qualifier ("face-down",
 * "screen dark", "out of focus", ...), or null. Checked clause by clause.
 * A qualifier counts only in the object's own clause, or in the next clause
 * when that one opens by referring back to the object ("a person smiling at
 * their phone, screen out of focus") -- never a qualifier about something
 * else ("…, a blurred plant in the background"). An object shown displaying
 * something ("showing", "displaying", "open to", "on screen") needs the
 * qualifier in its own clause. Deterministic, no model call -- the quality
 * gate turns a hit into a visual_mismatch for its targeted repair.
 * scripts/test-text-bearing.ts holds the verified cases.
 */
export function findTextBearingSubject(brief: VisualBrief | null | undefined, opts: { productReference?: boolean } = {}): string | null {
  if (!brief) return null
  for (const field of [brief.must_show, brief.left, brief.right]) {
    if (!field) continue
    const clauses = field.toLowerCase().split(/[,;:.]|\s(?:and|with|while|beside|next to|on top of)\s/).map((c) => c.trim()).filter(Boolean)
    for (let i = 0; i < clauses.length; i++) {
      const clause = clauses[i]!
      for (const term of TEXT_BEARING_TERMS) {
        if (term.packaging && opts.productReference) continue
        for (const m of clause.matchAll(new RegExp(term.pattern.source, "g"))) {
          if (isOtherSense(m[0], clause, m.index ?? 0)) continue
          if (NO_TEXT_QUALIFIER.test(clause)) continue
          const next = clauses[i + 1] ?? ""
          if (!DISPLAYING.test(clause) && REFERS_BACK.test(next) && NO_TEXT_QUALIFIER.test(next)) continue
          return m[0]
        }
      }
    }
  }
  return null
}

// ─── Candid photo direction ────────────────────────────────────────────────
// The default look for every generated photo (stories and posts): what a
// real customer's phone photo looks like, never a studio product shot. Used
// by the brief-writing prompts (CANDID_PHOTO_RULE), the image prompt
// builders, and art direction's default photo_style. A real brand photo is
// always preferred over generating one (lib/brand-photos.ts).

export const CANDID_PHOTO_STYLE = "candid phone photo, natural window light or outdoor daylight, a real Indian setting (a home, a street, a market, a cafe or a college campus), slightly off-centre framing, shallow depth of field, subtle film grain"
export const CANDID_PEOPLE_DIRECTION = "a real person, or just their hands, using, holding or wearing the product mid-moment -- natural and unposed, never looking into the camera with a posed smile"
export const CANDID_PHOTO_AVOID = ["studio sweeps or seamless backdrops", "products floating in mid-air", "perfect symmetry", "a glossy CGI or 3D-render look", "stock-photo smiles"] as const
/** The image-prompt clause banning the AI-default product look. */
export const CANDID_PHOTO_GUARD = `never: ${CANDID_PHOTO_AVOID.join(", ")}`

/** The rule for a prompt that WRITES visual briefs. */
export const CANDID_PHOTO_RULE = `- Every scene is a candid phone photo, as if taken by a customer: ${CANDID_PHOTO_STYLE}. Show ${CANDID_PEOPLE_DIRECTION}. Never: ${CANDID_PHOTO_AVOID.join("; ")}.`

// A stored photo_style describing one of the banned looks (art direction
// derived before the candid default, or typed in) -- replaced by the default.
const NON_CANDID_STYLE = /studio|seamless|sweep|backdrop|cgi|3d|render|floating|symmetr/i

/** The brand's photo_style when it's candid-compatible, else CANDID_PHOTO_STYLE. */
export function candidPhotoStyle(ad: ArtDirection | null | undefined): string {
  const own = ad?.photo_style?.trim()
  return own && !NON_CANDID_STYLE.test(own) ? own : CANDID_PHOTO_STYLE
}

// ─── Brand art direction in briefs and image prompts ───────────────────────
// The brand's art direction (lib/ai/brand-brain.ts, derived by
// lib/ai/art-direction.ts) reaches every format from here: the visual-brief
// prompts (carousel, story, post, ad) and every image prompt builder use
// these, so one brand's images share a palette, props, light and setting.
// Pure formatting; every function returns "" / [] without one, so prompts
// are unchanged for brands that have none.

// Image models ignore hex codes (and can render them as text) -- the palette
// always reaches a prompt as colour words (vibe-background-styles describeColor).
const colourName = (hex: string) => describeColor(hex) ?? "a neutral tone"

/** Rules for a prompt that WRITES visual briefs. */
export function artDirectionBriefRules(ad: ArtDirection | null | undefined): string {
  if (!ad) return ""
  return `BRAND ART DIRECTION — every visual brief must follow it:
- Palette (the image's dominant colours, described in words -- never write colour codes): ${colourName(ad.palette.accent)} as the signature accent, ${colourName(ad.palette.base)} as the base, ${colourName(ad.palette.deep)} for deep tones, ${colourName(ad.palette.pop)} as a small pop. Mood: ${ad.mood}.
- Props, materials and textures come from this brand's world: ${ad.motifs.join(", ")}.
- Setting: ${ad.cultural_context}
- Photography: ${candidPhotoStyle(ad)}
- Never: ${ad.avoid.join("; ")}.`
}

/** The clause an image prompt carries (comma-joined like the rest of the prompt). */
export function artDirectionImageClause(ad: ArtDirection | null | undefined, opts: { photography?: boolean } = {}): string {
  if (!ad) return ""
  return [
    `dominant colours from the brand palette: ${colourName(ad.palette.accent)} accent, ${colourName(ad.palette.base)} base, ${colourName(ad.palette.deep)} deep tones, ${colourName(ad.palette.pop)} as a small pop`,
    `${ad.mood} mood`,
    `props and textures drawn from: ${ad.motifs.join(", ")}`,
    `set in ${ad.cultural_context.replace(/[.]+$/, "")}`,
    // Not for a flat graphic (the editorial look).
    opts.photography === false ? "" : `photography: ${candidPhotoStyle(ad).replace(/[.]+$/, "")}`,
    `never show: ${ad.avoid.join("; ")}`,
  ].filter(Boolean).join(", ")
}

/** A short version for the simplified fallback prompts. */
export function artDirectionShortClause(ad: ArtDirection | null | undefined): string {
  if (!ad) return ""
  return `brand palette of ${colourName(ad.palette.accent)}, ${colourName(ad.palette.base)} and ${colourName(ad.palette.deep)}, never show: ${ad.avoid.slice(0, 3).join("; ")}`
}

/** The palette as image-prompt colours (accent first) -- in place of a generic vibe palette. */
export function artDirectionColors(ad: ArtDirection | null | undefined): string[] {
  return ad ? [ad.palette.accent, ad.palette.base, ad.palette.deep] : []
}

/** Lines for the quality gate's context. */
export function artDirectionGateLines(ad: ArtDirection | null | undefined): string {
  if (!ad) return ""
  return `Brand art direction (visual briefs must follow it): palette accent ${colourName(ad.palette.accent)} / base ${colourName(ad.palette.base)} / deep ${colourName(ad.palette.deep)} / pop ${colourName(ad.palette.pop)}; mood ${ad.mood}; motifs ${ad.motifs.join(", ")}; setting ${ad.cultural_context}; never: ${ad.avoid.join("; ")}`
}
