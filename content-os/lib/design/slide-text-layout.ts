/**
 * Pure text layout for the carousel and story compositors -- shared with
 * the builders (CarouselBuilder / StorySequence) so their "text is long"
 * notice and the server's overflow warning come from the same math.
 *
 * Never drops words. When a block doesn't fit its line budget or the safe
 * area, every font size steps down together, one step at a time, to a
 * floor (headline >= 75% of its length tier, body >= 24px at 1080 wide).
 * If it still doesn't fit there, all lines are kept at the floor and the
 * layout is flagged `overflow` -- the caller reports "text_overflow".
 */

export const TEXT_OVERFLOW_WARNING = "text_overflow"
export type SlideWarning = typeof TEXT_OVERFLOW_WARNING

// Safe area for 1:1 and 4:5: text and badges stay >= 6% from every edge.
export const SAFE_EDGE_RATIO = 0.06
const BODY_FLOOR_PX = 24
const HEADLINE_FLOOR_RATIO = 0.75
const SIZE_STEPS = [1, 0.92, 0.85, 0.78, 0.72, 0.66, 0.6]
// Rough average advance of the curated fonts, as a fraction of font size
// (the compositors are char-count based, not glyph-measured).
export const AVG_GLYPH_RATIO = 0.55

/** Greedy word wrap that returns EVERY line (the old wrapText sliced to maxLines). */
export function wrapWords(text: string, maxCharsPerLine: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines
}

export interface BlockSpec {
  /** One entry per independently-wrapped item (one for a headline, one per bullet point). */
  texts: string[]
  baseSize: number
  /** Wrap budget at baseSize; scales inversely with the fitted size. */
  charsAtBase: number
  maxLinesEach: number
  lineHeightMult: number
  /** Space above this block when it and an earlier block both have lines. */
  gapBefore: number
  kind: "headline" | "body"
  /** Hard cap from the available width, in px (optional). */
  maxWidthPx?: number
}

export interface FittedBlock {
  /** lines[i] = the wrapped lines of texts[i]. */
  lines: string[][]
  fontSize: number
  lineHeight: number
  height: number
  /** Gap actually applied above this block (0 when it or everything above is empty). */
  gap: number
}

export interface FittedStack {
  blocks: FittedBlock[]
  height: number
  overflow: boolean
}

function floorFor(spec: BlockSpec): number {
  const floor = spec.kind === "headline" ? Math.ceil(spec.baseSize * HEADLINE_FLOOR_RATIO) : BODY_FLOOR_PX
  return Math.min(floor, spec.baseSize)
}

function layoutAt(specs: BlockSpec[], step: number): { stack: FittedStack; fits: boolean } {
  let height = 0
  let fits = true
  let anyAbove = false
  const blocks = specs.map((spec) => {
    const fontSize = Math.max(floorFor(spec), Math.round(spec.baseSize * step))
    let chars = Math.max(6, Math.round((spec.charsAtBase * spec.baseSize) / fontSize))
    if (spec.maxWidthPx) chars = Math.max(6, Math.min(chars, Math.floor(spec.maxWidthPx / (fontSize * AVG_GLYPH_RATIO))))
    const lines = spec.texts.map((t) => (t.trim() ? wrapWords(t, chars) : []))
    if (lines.some((l) => l.length > spec.maxLinesEach)) fits = false
    const lineHeight = fontSize * spec.lineHeightMult
    const count = lines.reduce((n, l) => n + l.length, 0)
    const gap = count > 0 && anyAbove ? spec.gapBefore : 0
    if (count > 0) anyAbove = true
    const blockHeight = count * lineHeight
    height += gap + blockHeight
    return { lines, fontSize, lineHeight, height: blockHeight, gap }
  })
  return { stack: { blocks, height, overflow: false }, fits }
}

/** Fits a vertical stack of text blocks into `maxHeight`, stepping sizes down together. */
export function fitTextStack(specs: BlockSpec[], maxHeight: number): FittedStack {
  let last: FittedStack | null = null
  for (const step of SIZE_STEPS) {
    const { stack, fits } = layoutAt(specs, step)
    if (fits && stack.height <= maxHeight) return stack
    last = stack
  }
  return { ...last!, overflow: true }
}

/** Widest line of a block, estimated in px. */
export function estimateBlockWidth(block: FittedBlock): number {
  return block.lines.flat().reduce((w, l) => Math.max(w, l.length * block.fontSize * AVG_GLYPH_RATIO), 0)
}

/**
 * Keeps a block of `height` px centered near `centerY` inside [top, bottom];
 * a block taller than the space starts at `top`. Returns the block's top y.
 */
export function clampBlockTop(centerY: number, height: number, top: number, bottom: number): number {
  if (height >= bottom - top) return top
  return Math.min(bottom - height, Math.max(top, centerY - height / 2))
}

/** Same for a horizontally-centered block of `width` px (returns the center x). */
export function clampCenterX(centerX: number, width: number, left: number, right: number): number {
  if (width >= right - left) return (left + right) / 2
  return Math.min(right - width / 2, Math.max(left + width / 2, centerX))
}

// ─── Carousel (rich, 1080x1350) ─────────────────────────────────────────────

export const CAROUSEL_CANVAS = { width: 1080, height: 1350 }
// The brand-name line sits on the bottom safe edge; the text block stays above it.
export const CAROUSEL_BRAND_BASELINE = CAROUSEL_CANVAS.height * (1 - SAFE_EDGE_RATIO)
const CAROUSEL_BRAND_CLEARANCE = 26 + 24

export interface CarouselTextInput {
  type: "cover" | "content" | "cta"
  headline: string
  subtext?: string | null
  points?: string[] | null
  ctaText?: string | null
  ctaHandle?: string | null
  text_size_scale?: number | null
  text_position_x?: number | null
  text_position_y?: number | null
}

export interface CarouselTextLayout {
  headline: FittedBlock
  subtext: FittedBlock
  points: FittedBlock
  ctaText: FittedBlock
  ctaHandle: FittedBlock
  /** Block center x in % of the canvas width, after the safe-area clamp. */
  centerX: number
  blockTop: number
  blockHeight: number
  overflow: boolean
}

function carouselHeadlineTier(type: CarouselTextInput["type"], text: string): { size: number; chars: number } {
  const tiers = type === "cover"
    ? [{ max: 20, size: 84 }, { max: 40, size: 68 }, { max: 70, size: 52 }, { max: Infinity, size: 40 }]
    : type === "cta"
      ? [{ max: 20, size: 62 }, { max: 40, size: 50 }, { max: 70, size: 40 }, { max: Infinity, size: 32 }]
      : [{ max: 20, size: 54 }, { max: 40, size: 44 }, { max: 70, size: 36 }, { max: Infinity, size: 30 }]
  const tier = tiers.find((t) => text.length < t.max) ?? tiers[tiers.length - 1]!
  return { size: tier.size, chars: tier.size < 45 ? 26 : tier.size < 60 ? 20 : 16 }
}

/** Inputs must already be sanitized for compositing (the compositor does that). */
export function layoutCarouselText(input: CarouselTextInput): CarouselTextLayout {
  const { width: W, height: H } = CAROUSEL_CANVAS
  const scale = input.text_size_scale ?? 1
  const edge = W * SAFE_EDGE_RATIO
  const top = H * SAFE_EDGE_RATIO
  const bottom = CAROUSEL_BRAND_BASELINE - CAROUSEL_BRAND_CLEARANCE
  const requestedX = input.text_position_x ?? 50
  const tier = carouselHeadlineTier(input.type, input.headline)
  // Points are left-aligned from (center - 14%) -- their width budget runs
  // from there to the right safe edge.
  const pointsStartPx = ((requestedX - 14) / 100) * W
  const pointsWidth = Math.max(W * 0.4, W - edge - pointsStartPx)

  const specs: BlockSpec[] = [
    { texts: [input.headline], baseSize: Math.round(tier.size * scale), charsAtBase: Math.max(6, Math.round(tier.chars / scale)), maxLinesEach: 4, lineHeightMult: 1.18, gapBefore: 0, kind: "headline", maxWidthPx: W - 2 * edge },
    { texts: [input.type === "cover" ? input.subtext ?? "" : ""], baseSize: Math.round(34 * scale), charsAtBase: Math.max(10, Math.round(34 / scale)), maxLinesEach: 3, lineHeightMult: 1.4, gapBefore: 36, kind: "body", maxWidthPx: W - 2 * edge },
    { texts: input.type === "content" ? (input.points ?? []) : [], baseSize: Math.round(30 * scale), charsAtBase: Math.max(10, Math.round(42 / scale)), maxLinesEach: 2, lineHeightMult: 1.6, gapBefore: 48, kind: "body", maxWidthPx: pointsWidth },
    { texts: [input.type === "cta" ? input.ctaText ?? "" : ""], baseSize: Math.round(34 * scale), charsAtBase: Math.max(10, Math.round(40 / scale)), maxLinesEach: 2, lineHeightMult: 1.4, gapBefore: 32, kind: "body", maxWidthPx: W - 2 * edge },
    // The handle is one unbreakable token -- never wrapped.
    { texts: [input.type === "cta" ? input.ctaHandle ?? "" : ""], baseSize: Math.round(30 * scale), charsAtBase: 999, maxLinesEach: 1, lineHeightMult: 1.4, gapBefore: 20, kind: "body" },
  ]
  const stack = fitTextStack(specs, bottom - top)
  const [headline, subtext, points, ctaText, ctaHandle] = stack.blocks as [FittedBlock, FittedBlock, FittedBlock, FittedBlock, FittedBlock]

  const centeredWidth = Math.max(estimateBlockWidth(headline), estimateBlockWidth(subtext), estimateBlockWidth(ctaText), estimateBlockWidth(ctaHandle))
  const centerXPx = clampCenterX((requestedX / 100) * W, centeredWidth, edge, W - edge)
  const centerYPx = ((input.text_position_y ?? 50) / 100) * H
  return {
    headline, subtext, points, ctaText, ctaHandle,
    centerX: (centerXPx / W) * 100,
    blockTop: clampBlockTop(centerYPx, stack.height, top, bottom),
    blockHeight: stack.height,
    overflow: stack.overflow,
  }
}

// ─── Story (1080x1920) ──────────────────────────────────────────────────────

export const STORY_CANVAS = { width: 1080, height: 1920 }
// Instagram's own top/bottom chrome -- story-compositor's existing SAFE_ZONE.
export const STORY_SAFE_ZONE = 250

export interface StoryTextInput {
  text: string
  subtext: string
  pollText: string
  text_size_scale?: number | null
}

export interface StoryTextLayout {
  headline: FittedBlock
  subtext: FittedBlock
  poll: FittedBlock
  height: number
  overflow: boolean
}

function storyHeadlineBase(text: string): { size: number; chars: number } {
  return text.length < 20 ? { size: 92, chars: 15 }
    : text.length < 40 ? { size: 72, chars: 19 }
    : text.length < 70 ? { size: 56, chars: 24 }
    : { size: 44, chars: 30 }
}

export const STORY_TEXT_AREA = {
  top: STORY_SAFE_ZONE,
  bottom: STORY_CANVAS.height - STORY_SAFE_ZONE,
  left: STORY_CANVAS.width * SAFE_EDGE_RATIO,
  right: STORY_CANVAS.width * (1 - SAFE_EDGE_RATIO),
}

export function layoutStoryText(input: StoryTextInput): StoryTextLayout {
  const scale = input.text_size_scale ?? 1
  const base = storyHeadlineBase(input.text)
  const width = STORY_TEXT_AREA.right - STORY_TEXT_AREA.left
  const stack = fitTextStack([
    { texts: [input.text], baseSize: Math.round(base.size * scale), charsAtBase: Math.max(6, Math.round(base.chars / scale)), maxLinesEach: 4, lineHeightMult: 1.15, gapBefore: 0, kind: "headline", maxWidthPx: width },
    { texts: [input.subtext], baseSize: Math.round(42 * scale), charsAtBase: Math.max(10, Math.round(36 / scale)), maxLinesEach: 3, lineHeightMult: 1.4, gapBefore: 28, kind: "body", maxWidthPx: width },
    { texts: [input.pollText], baseSize: Math.round(34 * scale), charsAtBase: Math.max(10, Math.round(40 / scale)), maxLinesEach: 2, lineHeightMult: 1.4, gapBefore: 64, kind: "body", maxWidthPx: width },
  ], STORY_TEXT_AREA.bottom - STORY_TEXT_AREA.top)
  const [headline, subtext, poll] = stack.blocks as [FittedBlock, FittedBlock, FittedBlock]
  return { headline, subtext, poll, height: stack.height, overflow: stack.overflow }
}

/** Checklist hook slide: one headline, up to 4 lines. */
export function layoutStoryChecklistHook(text: string, scale = 1): FittedStack {
  const base = storyHeadlineBase(text)
  return fitTextStack([
    { texts: [text], baseSize: Math.round(base.size * scale), charsAtBase: Math.max(6, Math.round(base.chars / scale)), maxLinesEach: 4, lineHeightMult: 1.2, gapBefore: 0, kind: "headline" },
  ], STORY_TEXT_AREA.bottom - STORY_TEXT_AREA.top)
}

/** Checklist reveal/buildup slide: a wrong item and a right item, up to 3 lines each. */
export function layoutStoryChecklistPair(wrong: string, right: string, scale = 1): FittedStack {
  const size = Math.round(52 * scale)
  return fitTextStack([
    { texts: [wrong], baseSize: size, charsAtBase: Math.max(8, Math.round(22 / scale)), maxLinesEach: 3, lineHeightMult: 1.3, gapBefore: 0, kind: "body" },
    { texts: [right], baseSize: size, charsAtBase: Math.max(8, Math.round(22 / scale)), maxLinesEach: 3, lineHeightMult: 1.3, gapBefore: size * 1.6, kind: "body" },
  ], STORY_TEXT_AREA.bottom - STORY_TEXT_AREA.top)
}

/** Story slide overflow from its stored fields -- for the builder notice and generate-route events. */
export function storySlideOverflows(slide: {
  type: string
  text: string
  subtext?: string | null
  has_poll?: boolean
  poll_options?: string[] | null
  text_size_scale?: number | null
  checklist_highlighted_phrase?: string | null
  checklist_wrong_item?: string | null
  checklist_right_item?: string | null
}): boolean {
  const scale = slide.text_size_scale ?? 1
  if (slide.type === "hook" && slide.checklist_highlighted_phrase) return layoutStoryChecklistHook(slide.text, scale).overflow
  if ((slide.type === "reveal" || slide.type === "buildup") && slide.checklist_wrong_item && slide.checklist_right_item) {
    return layoutStoryChecklistPair(slide.checklist_wrong_item, slide.checklist_right_item, scale).overflow
  }
  const pollText = slide.has_poll && slide.poll_options?.length ? slide.poll_options.join("  ·  ") : ""
  return layoutStoryText({ text: slide.text, subtext: slide.subtext ?? "", pollText, text_size_scale: scale }).overflow
}

/** Indices (0-based) of slides whose text overflows. */
export function overflowingSlides<T>(slides: T[], overflows: (slide: T) => boolean): number[] {
  return slides.flatMap((s, i) => (overflows(s) ? [i] : []))
}
