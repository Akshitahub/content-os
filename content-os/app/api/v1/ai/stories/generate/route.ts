import { NextResponse } from "next/server"
import { noteGenerationBrand } from "@/lib/ai/provider-fallback"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { MODELS, classifyOpenAIError } from "@/lib/ai/models"
import { checkAndIncrementUsage, refundGenerationUsage, logGenerationOutcome } from "@/lib/usage/check-and-increment-usage"
import { STORY } from "@/lib/usage/credit-costs"
import { requestStorySequence } from "@/lib/ai/story-sequence-generator"
import { findContentQualityIssues, normalizeHashtags, sanitizeLeakedArtifacts } from "@/lib/ai/content-quality-check"
import { z } from "zod"
import type { BrandRow, ProductRow } from "@/types/database"
import { resolveTypography, type FontId } from "@/lib/design/fonts"
import { rememberBrandTypography } from "@/lib/design/brand-typography"
import type { VisualBrief } from "@/lib/ai/visual-brief"
import type { StoryFrameFields } from "@/lib/ai/story-frames"
import { timedGenerationRoute, type GenerationTimer } from "@/lib/utils/generation-timing"
import { withDeadline, DeadlineExceededError, GENERATION_TIMED_OUT_MESSAGE } from "@/lib/utils/with-deadline"
import { getActiveLessons } from "@/lib/ai/brand-brain"
import { recordContentEvent } from "@/lib/usage/content-events"
import { gateEventMeta } from "@/lib/ai/quality-gate"
import type { TextStyle } from "@/lib/design/text-style"
import { overflowingSlides, storySlideOverflows } from "@/lib/design/slide-text-layout"
import { stampSequenceLayouts, type TextLayoutId } from "@/lib/design/text-layouts"
import { getPrimaryColor } from "@/lib/design/post-card-generator"
import { artDirectionForRequest } from "@/lib/ai/art-direction"
import { toBrandPreset, type BrandPresetId } from "@/lib/design/color-themes"
import { OffTopicError, onTopicOrRegenerate } from "@/lib/ai/quality-gate"
import { PHOTO_KINDS_FOR, download } from "@/lib/brand-photos"
import { chooseFittingPhotos, photoFitItem } from "@/lib/ai/photo-fit"
import { createAdminClient } from "@/lib/supabase/server"
import { computeTextStyleSafe } from "@/lib/image/text-contrast"
import { storyTextRegion } from "@/lib/design/text-style"
import { ShortGenerationError, generationErrorMessage, regenerateIfShort } from "@/lib/ai/generation-retry"

const schema = z.object({
  brandId: z.string().uuid(),
  topic: z.string().min(3).max(300),
  storyCount: z.number().int().min(1).max(10).default(3),
  vibe: z.string().optional(),
  // The picked product -- its own brand photos are preferred for the frames.
  productId: z.string().uuid().optional(),
  // False for the client's Custom color mode (flat colours, never a photo).
  brandPhotos: z.boolean().default(true),
})

export type StorySlide = StoryFrameFields & {
  story_number: number
  type: "hook" | "reveal" | "buildup" | "cta"
  text: string
  subtext: string
  // New generations: a brand preset (lib/design/color-themes.ts); the old ids stay readable for saved stories.
  background: BrandPresetId | "gradient_violet" | "gradient_pink" | "gradient_dark" | "gradient_warm" | "white" | "vibe_fun_playful" | "vibe_professional" | "vibe_trendy_genz" | "checklist_cream"
  text_position: "top" | "center" | "bottom"
  has_poll: boolean
  poll_options?: [string, string]
  /** Only populated when vibe is "hard_truth_checklist" -- hook slide
   * only. A short, exact substring of `text` (the contrarian headline) to
   * visually highlight -- same approach as the Post template's
   * checklist_highlighted_phrase (types/app.ts's GeneratedCaption). See
   * lib/image/story-compositor.ts's checklist-aware rendering. */
  checklist_highlighted_phrase?: string | null
  /** Only populated when vibe is "hard_truth_checklist" -- reveal/buildup
   * slides only, exactly one wrong/right pair per slide. Also mirrored
   * into `text`/`subtext` (text=wrong, subtext=right) so this slide reads
   * correctly anywhere only those two generic fields are shown (the live
   * CSS preview, plain-text copy/export) -- the compositor uses these two
   * dedicated fields specifically to trigger the ✗/✓ marked rendering. */
  checklist_wrong_item?: string | null
  checklist_right_item?: string | null
  /** What this frame's AI background must show (lib/ai/visual-brief.ts),
   * already sanitized by lib/ai/story-sequence-generator.ts. Persisted with
   * the slide; sent back as the slide-image route's visualBrief. */
  visual?: VisualBrief
  /** Client-only, from the slide-image response alongside
   * background_image_url: how text is drawn over it (lib/design/text-style.ts). */
  text_style?: TextStyle | null
  /** Content-matched text layout (lib/design/text-layouts.ts) + extras,
   * stamped here; absent on older stories = the original layout. */
  text_layout?: TextLayoutId | null
  kicker?: string | null
  highlight?: string | null
  text_layout_source?: "auto" | "user" | null
  accent_color?: string | null
  /** Client-only enrichment — never set by this route. Filled in by
   * StorySequence.tsx as a best-effort follow-up (hook/cta slides only)
   * after generation succeeds; falls back to the flat `background` gradient
   * above when absent. Part of StorySlide (not separate component state)
   * so it round-trips through the existing whole-array sessionStorage
   * persistence for free. */
  background_image_url?: string
  /** Client-only, set alongside background_image_url above from the same
   * /api/v1/ai/stories/slide-image/generate response — which provider
   * actually produced it. Used by PhoneStory to skip the redundant
   * full-bleed product-photo overlay for an "openai" background, since an
   * OpenAI image-to-image reference generation already has the real
   * product realistically placed in the scene itself (unlike
   * "pollinations", which has no image-to-image capability and still
   * needs that overlay). */
  background_image_provider?: "pollinations" | "openai" | "brand_photo"
  /** The brand's own photo on this frame (brand_images.id, lib/brand-photos.ts)
   * -- set when background_image_url is a real brand photo. Every frame in a
   * sequence gets a different one; sent back as the slide-image route's
   * excludePhotoIds so a regenerated frame never repeats one. */
  brand_photo_id?: string | null
  /** "Custom color" mode (see components/shared/VibePicker.tsx +
   * ColorWheelPicker) -- an exact user-picked flat/gradient, applied
   * uniformly to every slide when active. Client-only, same as
   * background_image_url above; takes priority over both it and the
   * named `background` enum wherever a slide is rendered. 1 hex = solid,
   * 2 = a gradient. */
  custom_background_colors?: string[] | null
  /** Client-only, never set by this route. Exact user-picked hex for the
   * headline/subtext text itself (see StorySequence.tsx's PhoneStory) --
   * a single color, not an array like custom_background_colors above,
   * since text has no gradient mode. Absent means "use the normal
   * background-derived text color", not a specific color. */
  custom_text_color?: string | null
  /** Free-drag override for where the headline+subtext block sits on the
   * slide -- confirmed live (2026-08-29): the fixed top/center/bottom
   * choice above looks awkward against an AI-generated background whose
   * busy areas vary per generation (a real slide's text box landed on top
   * of a visually busy part of its own background with no way to nudge
   * it clear). Client-only, set by dragging the text block in
   * StorySequence.tsx's PhoneStory preview -- absent on freshly generated
   * slides (text_position above still governs placement until the user
   * actually drags). Percentages (0-100 of the slide's full width/height,
   * not just the safe-zone interior), not pixels, so one stored position
   * renders identically at the small editor preview's size and the real
   * 1080x1920 export canvas (lib/image/story-compositor.ts) -- see
   * components/shared/useDraggableText.ts. x/y mark the block's
   * horizontal/vertical CENTER, matching the CSS
   * `left/top + translate(-50%,-50%)` anchor used to render it. */
  text_position_x?: number
  text_position_y?: number
  /** Client-only, never set by this route. Overrides the default "hide the
   * product overlay once background_image_provider is 'openai'" rule (see
   * StorySequence.tsx's PhoneStory) -- lets a user turn the raw product
   * photo back on (or off) regardless of provider, e.g. when a
   * generation dropped the product from the scene. Absent means "use the
   * provider-based default", not "off". */
  show_product_overlay?: boolean
  /** Free-drag override for where the product photo overlay sits on the
   * slide -- same percentage-of-frame-center convention as
   * text_position_x/y above, just for the separate draggable image block
   * instead of the text block. Absent falls back to a fixed default
   * position (see StorySequence.tsx's PhoneStory). */
  product_position_x?: number
  product_position_y?: number
  /** Client-only, never set by this route. Which curated font
   * (lib/design/fonts.ts) renders this slide's text -- set by
   * StorySequence.tsx's font picker, same per-slide pattern as
   * custom_text_color above. Absent means the compositor's own
   * DEFAULT_FONT_ID (Anton). */
  font_id?: FontId | null
  /** Body font (subtext/points/poll/CTA lines) -- the brand's body face
   * (lib/design/fonts.ts resolveTypography). Absent = font_id for all text. */
  body_font_id?: FontId | null
  /** Client-only, never set by this route. Uniform font-size multiplier
   * for this slide -- set by StorySequence.tsx's size picker, same
   * per-slide pattern as custom_text_color above. Absent means 1.0 (the
   * compositor's pre-existing fixed sizes). */
  text_size_scale?: number | null
}

// The actual Instagram caption text for this story sequence — separate
// from the slides themselves. Previously there was no AI-generated caption
// at all: StorySequence.tsx's ScheduleAction used the user's raw topic
// input as the literal caption when scheduling. See CAPTION section in
// buildStoriesPrompt (lib/ai/story-sequence-generator.ts).
export type StoryCaption = {
  caption_text: string
  hashtags: string[]
}

/** The plan the story model writes before its frames (lib/ai/story-sequence-generator.ts). Returned with the sequence; not persisted (the stories row has no column for it). */
export type StoryPlan = {
  goal?: string
  next_action?: string
  arc?: { story_number: number; type: string; message: string }[]
}

export type GeneratedStorySequence = {
  stories: StorySlide[]
  caption?: StoryCaption
  story_plan?: StoryPlan
}

// Confirmed live (2026-08-28): the LLM's `background` choice was almost
// entirely type-based (hook→gradient_violet, reveal→gradient_pink,
// cta→gradient_dark, per the literal JSON example below) and effectively
// ignored `vibe` — two generations with vibe="professional" and
// vibe="fun_playful" produced byte-for-byte identical backgrounds for
// every slide. Rather than trying to prompt-engineer the model into
// reliably tying an enum field to a loose "Visual Vibe: X" context line —
// the exact kind of instruction-following diffusion/LLM models in this
// codebase are already documented as unreliable at (see
// vibe-background-styles.ts's describeColor comment) — background is now
// assigned deterministically in code from the selected vibe, overriding
// whatever the LLM put in each slide's `background` field. Only falls
// through to the LLM's own (type-based) choice when no vibe was selected
// at all, preserving that as the pre-existing default behavior.
const VIBE_TO_STORY_BACKGROUND: Record<string, StorySlide["background"]> = {
  fun_playful: "vibe_fun_playful",
  clean_minimal: "white",
  bold_dramatic: "gradient_dark",
  warm_cozy: "gradient_warm",
  professional: "vibe_professional",
  trendy_genz: "vibe_trendy_genz",
  // Same flat off-white/cream card the Post template's hard_truth_checklist
  // uses (lib/image/post-compositor.ts's CHECKLIST_BG_COLOR) -- applied
  // uniformly to every slide including cta, same as every other vibe here.
  hard_truth_checklist: "checklist_cream",
}


// Lightweight sanity pass over every real text field before it's persisted
// or returned — see lib/ai/content-quality-check.ts for what this catches
// (leaked "✓"/"✗" formatting markers, unfilled "[Placeholder]" brackets,
// raw template expressions, a stray unattached "x"). Mechanical
// fix-in-place, mirroring carousel/generate/route.ts's identical helper --
// this route has no validate-and-retry infrastructure of its own, and
// re-generating an entire story sequence over one bad word in one field
// would be a much heavier fix than the problem warrants. Logged loudly
// whenever it actually changes something, never a silent rewrite.
function sanitizeStoryText(value: string | undefined): string | undefined {
  if (typeof value !== "string" || !value) return value
  if (findContentQualityIssues(value).length === 0) return value
  const cleaned = sanitizeLeakedArtifacts(value)
  console.error(`[ai/stories/generate] stripped leaked artifact(s) from generated text: ${JSON.stringify(value)} -> ${JSON.stringify(cleaned)}`)
  return cleaned
}

function sanitizeStorySlides(stories: Record<string, unknown>[]): Record<string, unknown>[] {
  const clean = (v: unknown) => (typeof v === "string" ? sanitizeStoryText(v) : v)
  return stories.map((s) => ({
    ...s,
    text: clean(s.text),
    subtext: clean(s.subtext),
    // Story frame copy (lib/ai/story-frames.ts).
    big_words: clean(s.big_words),
    script_line: clean(s.script_line),
    badge: clean(s.badge),
    quote: clean(s.quote),
    cta_label: clean(s.cta_label),
    callouts: Array.isArray(s.callouts) ? s.callouts.map(clean) : s.callouts,
    checklist_highlighted_phrase: typeof s.checklist_highlighted_phrase === "string" ? sanitizeStoryText(s.checklist_highlighted_phrase) : s.checklist_highlighted_phrase,
    checklist_wrong_item: typeof s.checklist_wrong_item === "string" ? sanitizeStoryText(s.checklist_wrong_item) : s.checklist_wrong_item,
    checklist_right_item: typeof s.checklist_right_item === "string" ? sanitizeStoryText(s.checklist_right_item) : s.checklist_right_item,
  }))
}

// One model call for the whole sequence (60s timeout + one SDK retry), a
// possible fact-guard retry -- the worst case can approach or pass
// Vercel's 300s. 300s is the Hobby maximum with fluid compute
// (vercel.com/docs/functions/configuring-functions/duration, checked
// 2026-10-26); the route's own deadline stops 30s earlier so the refund +
// JSON error path below always runs instead of Vercel killing the function.
export const maxDuration = 300
const COPY_DEADLINE_MS = 270_000

/** How many story frames a raw model response holds (0 when unparseable). */
function countStoryFrames(raw: string): number {
  try {
    const d = JSON.parse(raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()) as { stories?: unknown }
    return Array.isArray(d.stories) ? d.stories.length : 0
  } catch {
    return 0
  }
}

/**
 * A brand photo for each frame it FITS (lib/ai/photo-fit.ts: the frame's
 * own brief and copy, fit 4+), never the same photo twice in the sequence
 * and never another product's photo; brand_images is read with the service
 * role after the brand's ownership was checked, like the photos routes.
 * Each assigned frame also gets its text_style from the photo. Frames with
 * no fitting photo keep no background_image_url (generated from the brief
 * by the client). Never throws.
 */
async function assignBrandPhotos(brand: BrandRow, stories: Record<string, unknown>[], product: Pick<ProductRow, "id" | "name"> | null): Promise<Record<string, unknown>[]> {
  try {
    const admin = await createAdminClient()
    const str = (v: unknown) => (typeof v === "string" ? v : null)
    const photos = await chooseFittingPhotos(admin, brand, {
      productId: product?.id ?? null,
      productName: product?.name ?? null,
      kinds: PHOTO_KINDS_FOR.story,
      items: stories.map((s) => photoFitItem(s.visual as VisualBrief | undefined, null, [str(s.big_words), str(s.script_line), str(s.quote), str(s.text), str(s.subtext)])),
      label: "story",
    })
    if (photos.every((p) => !p)) return stories
    const styles = await Promise.all(photos.map(async (p, i) => {
      if (!p) return null
      const bytes = await download(p.url)
      const position = stories[i]?.text_position as "top" | "center" | "bottom" | undefined
      return bytes ? computeTextStyleSafe(bytes, storyTextRegion(position)) : null
    }))
    console.log(`[ai/stories/generate] ${photos.filter(Boolean).length}/${stories.length} frame(s) use a fitting brand photo`)
    return stories.map((s, i) => {
      const photo = photos[i]
      return photo ? { ...s, background_image_url: photo.url, background_image_provider: "brand_photo", brand_photo_id: photo.id, text_style: styles[i] ?? null } : s
    })
  } catch (err) {
    console.error("[ai/stories/generate] couldn't assign brand photos (non-fatal):", err instanceof Error ? err.message : err)
    return stories
  }
}

export async function POST(request: Request) {
  return timedGenerationRoute("stories", (timer) => handlePost(request, timer))
}

async function handlePost(request: Request, timer: GenerationTimer) {
  const deadlineAt = Date.now() + COPY_DEADLINE_MS
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  }

  const usageCheck = await checkAndIncrementUsage(user.id, STORY, "story")
  if (!usageCheck.ok) {
    const code = usageCheck.status === 429 ? ErrorCodes.USAGE_LIMIT_EXCEEDED : ErrorCodes.INTERNAL_ERROR
    return NextResponse.json(buildError(code, usageCheck.message), { status: usageCheck.status })
  }
  const logId = usageCheck.logId

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.issues[0]?.message), { status: 400 })
  }

  const { brandId, topic, storyCount, vibe, productId, brandPhotos } = parsed.data

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  noteGenerationBrand(brand.id, user.id)

  // The picked product (this brand's only): story frames' product callouts,
  // offer numbers, and its own brand photos first.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: product } = productId ? await (supabase.from("products") as any).select("*").eq("id", productId).eq("brand_id", brandId).maybeSingle() as { data: ProductRow | null } : { data: null }

  // Feed the brand's own past highly-rated stories back into the prompt as
  // few-shot examples — skip entirely if none exist yet.
  const pastExamples: string[] = []
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: pastStories } = await (supabase.from("stories") as any)
      .select("stories")
      .eq("brand_id", brandId)
      .gte("user_rating", 4)
      .order("user_rating", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5) as { data: { stories: unknown }[] | null }

    for (const s of pastStories ?? []) {
      if (!Array.isArray(s.stories)) continue
      const texts = s.stories
        .map((slide) => (slide && typeof slide === "object" && "text" in slide ? String((slide as { text: unknown }).text) : null))
        .filter((t): t is string => !!t)
      if (texts.length > 0) pastExamples.push(texts.join(" / "))
    }
  } catch (err) {
    console.error("[ai/stories/generate] fetching past examples failed (non-fatal):", err)
  }

  // Finalizes this generation's ai_generation_logs row (created by
  // checkAndIncrementUsage above) with model, tokens, cost, latency and
  // outcome -- on every exit path below, success or failure. Never logs
  // the topic or generated copy.
  const startTime = Date.now()
  let gen: Awaited<ReturnType<typeof requestStorySequence>> | null = null
  const recordOutcome = (success: boolean, errorMessage?: string) =>
    logGenerationOutcome(supabase, logId, {
      user_id: user.id, brand_id: brandId, feature: "story", model: gen?.model ?? MODELS.creative,
      prompt_tokens: gen?.usage?.prompt_tokens ?? null,
      completion_tokens: gen?.usage?.completion_tokens ?? null,
      total_tokens: gen?.usage?.total_tokens ?? null,
      cost_usd: gen?.costUsd ?? null,
      latency_ms: Date.now() - startTime, success, error_message: errorMessage ?? null,
    })

  try {
    // Moved from Groq to OpenAI (MODELS.creative) in the Phase 1b
    // migration -- prompt + call now live in lib/ai/story-sequence-generator.ts.
    // Brand art direction (lib/ai/art-direction.ts): the cached one (stale or none;
    // a missing / stale one is re-derived in the background, never awaited) in
    // brand_brain; every brief and image prompt below reads it. Fail-soft.
    await artDirectionForRequest(supabase, brand)
    const lessons = await getActiveLessons(supabase, brandId, "story")
    // Off the topic after the gate's repair -> one regeneration (onTopicOrRegenerate);
    // fewer frames than asked for -> one regeneration (regenerateIfShort). Either
    // still failing is a clear error -- never a silent off-topic or short story.
    gen = await timer.step("caption", withDeadline(regenerateIfShort(
      () => onTopicOrRegenerate(topic, () => requestStorySequence(brand, topic, storyCount, vibe, pastExamples, lessons, deadlineAt, product)),
      (g) => countStoryFrames(g.raw),
      storyCount,
      "stories",
    ), deadlineAt - Date.now(), "story copy"))
    const raw = gen.raw
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()

    let data: unknown
    try {
      data = JSON.parse(cleaned)
    } catch {
      await recordOutcome(false, "AI returned invalid JSON")
      await refundGenerationUsage(supabase, user.id, STORY, logId)
      return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "AI returned invalid JSON. Please try again."), { status: 500 })
    }

    const d = data as Record<string, unknown>
    if (!Array.isArray(d.stories) || d.stories.length === 0) {
      await recordOutcome(false, "AI returned too few or no story slides")
      await refundGenerationUsage(supabase, user.id, STORY, logId)
      return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Story generation failed. Please try again."), { status: 500 })
    }

    // Defensive backstop against the LLM ignoring "NUMBER OF STORIES" and
    // returning the wrong slide count. Too many: truncate to what was
    // actually requested and re-number sequentially, since the LLM's own
    // story_number sequence may no longer be contiguous once a tail is
    // cut. Too few: a genuine generation failure, not silently accepted —
    // a slide sequence with broken story_number/type continuity would be
    // worse than asking the user to retry, same as the empty-array case
    // just above.
    const storiesArr = d.stories as Record<string, unknown>[]
    if (storiesArr.length > storyCount) {
      d.stories = storiesArr.slice(0, storyCount).map((s, i) => ({ ...s, story_number: i + 1 }))
    } else if (storiesArr.length < storyCount) {
      await recordOutcome(false, "AI returned too few or no story slides")
      await refundGenerationUsage(supabase, user.id, STORY, logId)
      return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Story generation failed. Please try again."), { status: 500 })
    }

    // Override the LLM's per-slide background choice with one deterministic,
    // vibe-derived value applied to every slide -- see VIBE_TO_STORY_BACKGROUND
    // above for why. A manual `vibe` from the request (the Customize
    // override) still wins; otherwise the model now picks its own vibe as
    // part of the same JSON response (suggested_vibe), so the user no
    // longer has to choose one separately. Still a no-op if neither exists.
    const effectiveVibe = vibe || (d.suggested_vibe as string | undefined)
    const vibeBackground = effectiveVibe ? VIBE_TO_STORY_BACKGROUND[effectiveVibe] : undefined
    // New generations only use brand presets (built from the brand palette):
    // the vibe's (or the model's) pick mapped to the nearest one.
    d.stories = (d.stories as Record<string, unknown>[]).map((s) => ({ ...s, background: toBrandPreset(vibeBackground ?? (s.background as string | undefined)) }))

    // One font for the whole sequence -- same rule as the carousel route:
    // the model's pick if valid, else the brand / story vibe fallback.
    // Stamped on every slide; still changeable per slide in the editor.
    // Brand-level typography (lib/design/fonts.ts resolveTypography) --
    // checklist cards and long subtext make the body "dense".
    const typography = resolveTypography(brand, {
      density: effectiveVibe === "hard_truth_checklist" || (d.stories as Record<string, unknown>[]).some((s) => typeof s.subtext === "string" && s.subtext.length > 120) ? "dense" : "normal",
      suggested: d.suggested_font_id,
    })
    const fontId = typography.heading
    d.suggested_font_id = fontId
    d.stories = (d.stories as Record<string, unknown>[]).map((s) => ({ ...s, font_id: fontId, body_font_id: typography.body }))
    await rememberBrandTypography(supabase, brand, typography)

    d.stories = sanitizeStorySlides(d.stories as Record<string, unknown>[])
    // Content-matched text layouts (lib/design/text-layouts.ts): one family
    // per story, max two layouts. Checklist frames keep their own design.
    d.stories = stampSequenceLayouts(d.stories as Record<string, unknown>[], {
      format: "story", brand, headingFont: fontId, accentColor: getPrimaryColor(brand), headlineKey: "text",
      toPick: (s) => ({ role: typeof s.type === "string" ? s.type : null, visualKind: (s.visual as { kind?: string } | undefined)?.kind ?? null }),
      // Story frames draw their own design (lib/image/story-frame-compositor.ts).
      skip: (s) => !!s.frame || !!s.checklist_highlighted_phrase || (!!s.checklist_wrong_item && !!s.checklist_right_item),
    })
    const caption = d.caption as { caption_text?: unknown; hashtags?: unknown } | undefined
    if (caption && typeof caption.caption_text === "string") {
      d.caption = { ...caption, caption_text: sanitizeStoryText(caption.caption_text), hashtags: normalizeHashtags(caption.hashtags) }
    }

    // Real photos first: every frame gets one of the brand's own photos
    // (the product's first), never the same photo twice in the sequence --
    // assigned here, in one pick, so frames generated in parallel can't
    // collide. Frames left without one get an AI background from the
    // client, as before. Not for checklist cards (no photo) or Custom color.
    if (brandPhotos && effectiveVibe !== "hard_truth_checklist") {
      d.stories = await assignBrandPhotos(brand, d.stories as Record<string, unknown>[], product)
    }

    // Persist (non-fatal) — matches the pattern used by every other
    // generate route: the generate call itself saves, the client never
    // needs a separate save request. The id is now returned to the client
    // (previously discarded) so it can PUT slide background image URLs
    // back onto this same row once they're generated — see the
    // stories/[storyId] PUT route's new `stories` field.
    let storyRowId: string | null = null
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: saved } = await (supabase.from("stories") as any)
        .insert({
          brand_id: brandId,
          topic,
          stories: d.stories,
          is_saved: true,
        })
        .select("id")
        .single() as { data: { id: string } | null }
      storyRowId = saved?.id ?? null
    } catch (persistErr) {
      console.error("[ai/stories/generate] persist failed (non-fatal):", persistErr)
    }
    // Frames whose text only fits past the compositor's smallest size
    // (lib/design/slide-text-layout.ts) -- the builder shows the same notice.
    const textOverflow = overflowingSlides(d.stories as StorySlide[], storySlideOverflows)
    recordContentEvent(supabase, { userId: user.id, brandId, contentType: "story", contentId: storyRowId, event: "generated", meta: { model: gen.model, cost_usd: gen.costUsd, ...gateEventMeta(gen.gate), ...(textOverflow.length ? { text_overflow: true, text_overflow_slides: textOverflow.map((i) => i + 1) } : {}) } })

    await recordOutcome(true)
    return NextResponse.json({ data: { ...d, id: storyRowId } }, { status: 200 })
  } catch (err) {
    console.error("[ai/stories/generate] error:", err)
    if (err instanceof OffTopicError || err instanceof ShortGenerationError) gen = { raw: "", model: MODELS.creative, usage: err.usage, costUsd: err.costUsd }
    await recordOutcome(false, err instanceof Error ? err.message : "Unknown error")
    await refundGenerationUsage(supabase, user.id, STORY, logId)
    // A raw thrown error here can be the OpenAI SDK's own error object
    // (network/auth/rate-limit/timeout failures), which can surface the
    // provider in its message text -- classifyOpenAIError strips that
    // before this ever reaches the user.
    const timedOut = err instanceof DeadlineExceededError
    // Off the user's topic, or fewer slides than asked for, after a retry: say exactly that.
    const topicError = generationErrorMessage(err)
    return NextResponse.json(
      buildError(ErrorCodes.AI_GENERATION_FAILED, topicError ?? (timedOut ? GENERATION_TIMED_OUT_MESSAGE : classifyOpenAIError(err))),
      { status: topicError ? 422 : timedOut ? 504 : 500 }
    )
  }
}
