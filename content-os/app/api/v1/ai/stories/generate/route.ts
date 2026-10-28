import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { MODELS, classifyOpenAIError } from "@/lib/ai/models"
import { checkAndIncrementUsage, refundGenerationUsage, logGenerationOutcome } from "@/lib/usage/check-and-increment-usage"
import { STORY } from "@/lib/usage/credit-costs"
import { requestStorySequence } from "@/lib/ai/story-sequence-generator"
import { findContentQualityIssues, sanitizeLeakedArtifacts } from "@/lib/ai/content-quality-check"
import { z } from "zod"
import type { BrandRow } from "@/types/database"
import { resolveSuggestedFont, type FontId } from "@/lib/design/fonts"
import type { VisualBrief } from "@/lib/ai/visual-brief"
import { timedGenerationRoute, type GenerationTimer } from "@/lib/utils/generation-timing"
import { withDeadline, DeadlineExceededError, GENERATION_TIMED_OUT_MESSAGE } from "@/lib/utils/with-deadline"
import { getActiveLessons } from "@/lib/ai/brand-brain"

const schema = z.object({
  brandId: z.string().uuid(),
  topic: z.string().min(3).max(300),
  storyCount: z.number().int().min(1).max(10).default(3),
  vibe: z.string().optional(),
})

export type StorySlide = {
  story_number: number
  type: "hook" | "reveal" | "buildup" | "cta"
  text: string
  subtext: string
  background: "gradient_violet" | "gradient_pink" | "gradient_dark" | "gradient_warm" | "white" | "vibe_fun_playful" | "vibe_professional" | "vibe_trendy_genz" | "checklist_cream"
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
  background_image_provider?: "pollinations" | "openai"
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
  return stories.map((s) => ({
    ...s,
    text: typeof s.text === "string" ? sanitizeStoryText(s.text) : s.text,
    subtext: typeof s.subtext === "string" ? sanitizeStoryText(s.subtext) : s.subtext,
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

  const { brandId, topic, storyCount, vibe } = parsed.data

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

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
    const lessons = await getActiveLessons(supabase, brandId, "story")
    gen = await timer.step("caption", withDeadline(requestStorySequence(brand, topic, storyCount, vibe, pastExamples, lessons), deadlineAt - Date.now(), "story copy"))
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
    if (vibeBackground) {
      d.stories = (d.stories as Record<string, unknown>[]).map((s) => ({ ...s, background: vibeBackground }))
    }

    // One font for the whole sequence -- same rule as the carousel route:
    // the model's pick if valid, else the brand / story vibe fallback.
    // Stamped on every slide; still changeable per slide in the editor.
    const fontId = resolveSuggestedFont(d.suggested_font_id, brand.vibe, effectiveVibe)
    d.suggested_font_id = fontId
    d.stories = (d.stories as Record<string, unknown>[]).map((s) => ({ ...s, font_id: fontId }))

    d.stories = sanitizeStorySlides(d.stories as Record<string, unknown>[])
    const caption = d.caption as { caption_text?: unknown; hashtags?: unknown } | undefined
    if (caption && typeof caption.caption_text === "string") {
      d.caption = { ...caption, caption_text: sanitizeStoryText(caption.caption_text) }
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

    await recordOutcome(true)
    return NextResponse.json({ data: { ...d, id: storyRowId } }, { status: 200 })
  } catch (err) {
    console.error("[ai/stories/generate] error:", err)
    await recordOutcome(false, err instanceof Error ? err.message : "Unknown error")
    await refundGenerationUsage(supabase, user.id, STORY, logId)
    // A raw thrown error here can be the OpenAI SDK's own error object
    // (network/auth/rate-limit/timeout failures), which can surface the
    // provider in its message text -- classifyOpenAIError strips that
    // before this ever reaches the user.
    const timedOut = err instanceof DeadlineExceededError
    return NextResponse.json(
      buildError(ErrorCodes.AI_GENERATION_FAILED, timedOut ? GENERATION_TIMED_OUT_MESSAGE : classifyOpenAIError(err)),
      { status: timedOut ? 504 : 500 }
    )
  }
}
