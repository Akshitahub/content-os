// Format-neutral "visual brief" -- what one slide/frame's AI background must
// show -- shared by carousels and stories (moved out of types/app.ts,
// lib/ai/carousel-generator.ts and lib/ai/carousel-slide-background.ts).
// Pure: no server-only imports, so client code can use the types and kinds.

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

function clampText(text: string): string {
  if (text.length <= VISUAL_TEXT_MAX) return text
  const cut = text.slice(0, VISUAL_TEXT_MAX)
  const lastSpace = cut.lastIndexOf(" ")
  return (lastSpace > VISUAL_TEXT_MAX / 2 ? cut.slice(0, lastSpace) : cut).trim()
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
  return { kind, must_show: mustShow, composition }
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
  process_sequence: "three to four stages of a process arranged left to right in one frame:",
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

/** Whether a slide with this brief keeps the product reference photo (see BRIEF_KINDS_WITHOUT_PRODUCT_REFERENCE). */
export function briefUsesProductReference(brief: VisualBrief | undefined): boolean {
  return !brief || !BRIEF_KINDS_WITHOUT_PRODUCT_REFERENCE.has(brief.kind)
}
