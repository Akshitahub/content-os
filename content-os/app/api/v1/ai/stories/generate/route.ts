import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { MODELS, getGroqClient } from "@/lib/ai/models"
import { checkAndIncrementUsage, refundGenerationUsage } from "@/lib/usage/check-and-increment-usage"
import { STORY } from "@/lib/usage/credit-costs"
import { buildPastExamplesBlock, QUALITY_BAR } from "@/lib/ai/prompts"
import { z } from "zod"
import type { BrandRow } from "@/types/database"

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
  background: "gradient_violet" | "gradient_pink" | "gradient_dark" | "gradient_warm" | "white" | "vibe_fun_playful" | "vibe_professional" | "vibe_trendy_genz"
  text_position: "top" | "center" | "bottom"
  has_poll: boolean
  poll_options?: [string, string]
  /** Client-only enrichment — never set by this route. Filled in by
   * StorySequence.tsx as a best-effort follow-up (hook/cta slides only)
   * after generation succeeds; falls back to the flat `background` gradient
   * above when absent. Part of StorySlide (not separate component state)
   * so it round-trips through the existing whole-array sessionStorage
   * persistence for free. */
  background_image_url?: string
  /** "Custom color" mode (see components/shared/VibePicker.tsx +
   * ColorWheelPicker) -- an exact user-picked flat/gradient, applied
   * uniformly to every slide when active. Client-only, same as
   * background_image_url above; takes priority over both it and the
   * named `background` enum wherever a slide is rendered. 1 hex = solid,
   * 2 = a gradient. */
  custom_background_colors?: string[] | null
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
}

// The actual Instagram caption text for this story sequence — separate
// from the slides themselves. Previously there was no AI-generated caption
// at all: StorySequence.tsx's ScheduleAction used the user's raw topic
// input as the literal caption when scheduling. See CAPTION section in
// buildStoriesPrompt below.
export type StoryCaption = {
  caption_text: string
  hashtags: string[]
}

export type GeneratedStorySequence = {
  stories: StorySlide[]
  caption?: StoryCaption
}

/**
 * Builds the narrative-beat sequence for any story count from 1-10.
 * The shape is always hook → reveal → (storyCount - 3) buildups → cta for
 * 3+ stories (matching the previous hardcoded 3/4/5 sequences exactly),
 * tapering down to just ["hook"] or ["hook", "cta"] for 1-2 stories.
 */
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
}

function buildStoryTypeSequence(storyCount: number): string[] {
  if (storyCount <= 1) return ["hook"]
  if (storyCount === 2) return ["hook", "cta"]
  const buildupCount = storyCount - 3
  return ["hook", "reveal", ...Array(buildupCount).fill("buildup"), "cta"]
}

// One example slide per type, reused however many times that type shows up
// in typeSequence — building the JSON example dynamically (below) instead
// of a hardcoded 4-slide array so the example the model sees always
// matches the count it's told to produce, for every storyCount from 1-10.
const EXAMPLE_SLIDE_BY_TYPE: Record<string, { text: string; subtext: string; background: StorySlide["background"]; text_position: StorySlide["text_position"]; has_poll: boolean; poll_options?: [string, string] }> = {
  hook: {
    text: "What if your inbox emptied itself",
    subtext: "Most founders find out too late",
    background: "gradient_violet",
    text_position: "top",
    has_poll: false,
  },
  reveal: {
    text: "3 hours saved every single day",
    subtext: "That's what automation actually buys back",
    background: "gradient_pink",
    text_position: "center",
    has_poll: false,
  },
  buildup: {
    text: "Manual replies vs. automated ones",
    subtext: "18-minute average wait vs. instant",
    background: "gradient_warm",
    text_position: "bottom",
    has_poll: true,
    poll_options: ["Manual, always", "Ready to automate"],
  },
  cta: {
    text: "Your inbox, handled",
    subtext: "Link in bio",
    background: "gradient_dark",
    text_position: "center",
    has_poll: false,
  },
}

function buildExampleStoriesJson(typeSequence: string[]): string {
  const exampleStories = typeSequence.map((type, i) => {
    const example = EXAMPLE_SLIDE_BY_TYPE[type] ?? EXAMPLE_SLIDE_BY_TYPE.hook!
    return {
      story_number: i + 1,
      type,
      text: example.text,
      subtext: example.subtext,
      background: example.background,
      text_position: example.text_position,
      has_poll: example.has_poll,
      ...(example.poll_options ? { poll_options: example.poll_options } : {}),
    }
  })
  // Indented so nested lines line up under the "stories": key it gets
  // interpolated into below — JSON.stringify's own indentation is
  // 0-based, so every line but the opening "[" needs 2 extra spaces.
  return JSON.stringify(exampleStories, null, 2)
    .split("\n")
    .map((line, i) => (i === 0 ? line : `  ${line}`))
    .join("\n")
}

function buildStoriesPrompt(brand: BrandRow, topic: string, storyCount: number, vibe?: string, pastExamples: string[] = []): string {
  const brandCtx = [
    `Brand: ${brand.name}`,
    brand.niche ? `Niche: ${brand.niche}` : null,
    brand.tone_of_voice ? `Tone: ${brand.tone_of_voice}` : null,
    brand.instagram_handle ? `Handle: @${brand.instagram_handle}` : null,
    vibe ? `Visual Vibe: ${vibe}` : null,
  ].filter(Boolean).join("\n")

  const typeSequence = buildStoryTypeSequence(storyCount)
  const pastExamplesBlock = buildPastExamplesBlock(pastExamples, "stories")

  const b = brand as BrandRow & { cta_phrase?: string | null }
  const ctaPhrase = b.cta_phrase || "Shop now"
  const handle = brand.instagram_handle ? `@${brand.instagram_handle}` : "@handle"

  return `${brandCtx}${pastExamplesBlock}

STORY TOPIC: "${topic}"
NUMBER OF STORIES: ${storyCount}

Create ${storyCount} connected Instagram stories that build narrative momentum.

Story type sequence: ${typeSequence.join(" → ")}

Story types:
- hook: Stops the scroll, creates curiosity, "Wait till you see this" energy
- reveal: Shows/introduces the main thing (product, concept, transformation)
- buildup: Adds details, benefits, social proof, or context
- cta: Final slide with strong call to action and @handle

TEXT RULES: No exclamation marks, no hashtags, no emojis in "text" or "subtext" — plain, punchy text only.

SLIDE TEXT FORMATS — confirmed live (2026-08-29): every slide defaulting
to the same "punchy claim + supporting detail" shape for "text"/"subtext"
reads as repetitive across a sequence, even when the wording changes.
Vary the structure slide-by-slide instead — don't force every sequence
through the same rotation, and don't use the same format twice in a row:
- Direct statement — "text" states the value prop or fact outright,
  "subtext" adds one supporting detail. (The default shape — use it,
  but not for every slide.)
- Question — "text" poses a real question the viewer would ask
  themselves, "subtext" teases the answer without fully giving it away.
- Stat / number callout — "text" leads with a striking number or
  statistic, "subtext" explains what it means.
- Contrast — "text" names a before/after or old-way/new-way shift,
  "subtext" is the other half of the contrast.
Also vary "text_position" genuinely across the sequence (top/center/
bottom) rather than defaulting to the same position for every slide of
a given type. "has_poll" isn't cta-exclusive either — a reveal or
buildup slide can carry a real poll (e.g. "Which do you prefer?") when
it fits the content; use it on at most one non-cta slide, only when it
genuinely fits, not as a default.

Background options:
- "gradient_violet": Purple/violet gradient (great for hook)
- "gradient_pink": Pink/rose gradient (great for reveal)
- "gradient_dark": Dark dramatic (great for CTA)
- "gradient_warm": Warm orange/amber (great for buildup)
- "white": Clean white (great for text-heavy slides)

CAPTION — separate from the story slides above: this is the actual Instagram caption text posted alongside the story sequence when it's scheduled, so it needs its own real copy, not a placeholder.
- caption_text: a short hook line (can echo the story's opening hook, doesn't need to repeat it word-for-word), 1-2 lines of value or context, then end with "${ctaPhrase}" followed by "${handle}" on its own line. Keep it tight — a few short lines, not an essay. Aim for under ~150 characters total unless the topic genuinely needs more room to explain.
- hashtags: 15 tags using the 5+5+5 rule:
  - 5 niche-specific (medium competition, 100K–2M posts): e.g. #SkincareRoutine, #CleanBeautyIndia
  - 5 brand/product-specific (low competition, unique to brand): e.g. #BrandName, #ProductName
  - 5 broad/trending (high volume, 5M+ posts): e.g. #Skincare, #Beauty, #SelfCare
${QUALITY_BAR}

Respond with ONLY this JSON:
{
  "stories": ${buildExampleStoriesJson(typeSequence)},
  "caption": {
    "caption_text": "hook line, 1-2 lines of value, then ${ctaPhrase} and ${handle} on its own line — see CAPTION above",
    "hashtags": ["niche1", "niche2", "niche3", "niche4", "niche5", "brand1", "brand2", "brand3", "brand4", "brand5", "broad1", "broad2", "broad3", "broad4", "broad5"]
  }
}

Make the text punchy and emotion-led. Each story should make the viewer want to tap to the next one.`
}

export async function POST(request: Request) {
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

  const groq = getGroqClient()
  const prompt = buildStoriesPrompt(brand, topic, storyCount, vibe, pastExamples)

  try {
    const response = await groq.chat.completions.create({
      model: MODELS.generation,
      temperature: 0.85,
      // GPT-OSS reasoning tokens count against max_tokens. Structured
      // multi-slide JSON (like the carousel case, measured at 55% reasoning
      // overhead for a comparable 7-item structure) needs real reasoning to
      // keep the narrative arc coherent across slides. Budget scales with
      // storyCount (up to 10) since more slides = more visible output too.
      reasoning_effort: "medium",
      max_tokens: Math.max(3000, storyCount * 350),
      messages: [
        {
          role: "system",
          content: `You are an expert Instagram story creator for Indian D2C brands. Always return valid JSON only.
${QUALITY_BAR}`,
        },
        { role: "user", content: prompt },
      ],
    })

    const raw = response.choices[0]?.message?.content ?? "{}"
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()

    let data: unknown
    try {
      data = JSON.parse(cleaned)
    } catch {
      await refundGenerationUsage(supabase, user.id, STORY, logId)
      return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "AI returned invalid JSON. Please try again."), { status: 500 })
    }

    const d = data as Record<string, unknown>
    if (!Array.isArray(d.stories) || d.stories.length === 0) {
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
      await refundGenerationUsage(supabase, user.id, STORY, logId)
      return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Story generation failed. Please try again."), { status: 500 })
    }

    // Override the LLM's per-slide background choice with one deterministic,
    // vibe-derived value applied to every slide -- see VIBE_TO_STORY_BACKGROUND
    // above for why. No-op (keeps whatever the LLM picked) when no vibe was
    // selected, matching the pre-existing default.
    const vibeBackground = vibe ? VIBE_TO_STORY_BACKGROUND[vibe] : undefined
    if (vibeBackground) {
      d.stories = (d.stories as Record<string, unknown>[]).map((s) => ({ ...s, background: vibeBackground }))
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

    return NextResponse.json({ data: { ...d, id: storyRowId } }, { status: 200 })
  } catch (err) {
    await refundGenerationUsage(supabase, user.id, STORY, logId)
    const msg = err instanceof Error ? err.message : "Generation failed"
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, msg), { status: 500 })
  }
}
