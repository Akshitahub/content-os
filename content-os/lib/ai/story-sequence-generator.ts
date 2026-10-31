import type { BrandRow, ProductRow } from "@/types/database"
import type { StorySlide } from "@/app/api/v1/ai/stories/generate/route"
import { buildPastExamplesBlock, buildSuggestedFontField, buildTopicSubjectBlock, QUALITY_BAR } from "./prompts"
import { createCreativeCompletion } from "./creative-completion"
import { buildFactSource, guardCopy, stripGuard } from "./fact-guard"
import { runQualityGate, type GateReport } from "./quality-gate"
import { addTextUsage, sumCostUsd, type TextUsage } from "./pricing"
import { CANDID_PHOTO_RULE, NO_TEXT_BEARING_SUBJECTS_RULE, VISUAL_KINDS, sanitizeVisualBrief, type VisualBrief, artDirectionBriefRules } from "./visual-brief"
import { allowedMiddleFrames, exampleFrameFields, finalizeStoryFrames, frameSlots, storyFrameContext, storyFrameRules, type StoryFrameContext } from "./story-frames"
import { withLessons, type BrandLesson, artDirectionFrom } from "./brand-brain"
import { buildBrandBrainLines, parseBrandBrain } from "@/lib/brand-brain-profile"

// Story-sequence prompt building + the model call, moved verbatim out of
// app/api/v1/ai/stories/generate/route.ts during the Phase 1b Groq ->
// OpenAI migration so scripts/test-creative-stages.ts can exercise the
// real prompt (a Next.js route file can't export non-route helpers). All
// post-processing (slide-count backstop, vibe background override,
// sanitizing, persistence, credits) stays in the route.

/**
 * Builds the narrative-beat sequence for any story count from 1-10.
 * The shape is always hook → reveal → (storyCount - 3) buildups → cta for
 * 3+ stories (matching the previous hardcoded 3/4/5 sequences exactly),
 * tapering down to just ["hook"] or ["hook", "cta"] for 1-2 stories.
 */
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
const EXAMPLE_SLIDE_BY_TYPE: Record<string, { text: string; subtext: string; background: StorySlide["background"]; text_position: StorySlide["text_position"]; has_poll: boolean; poll_options?: [string, string]; visual: VisualBrief }> = {
  hook: {
    text: "What if your inbox emptied itself",
    subtext: "Most founders find out too late",
    background: "gradient_violet",
    text_position: "top",
    has_poll: false,
    visual: { kind: "detail_closeup", must_show: "A phone lying face up on a cluttered desk, its screen glowing but blurred, beside a cold cup of coffee, shot from directly above", composition: "phone and cup stacked in the lower half, top third calm for text" },
  },
  reveal: {
    text: "Your mornings, back to yourself",
    subtext: "That's what automation actually buys back",
    background: "gradient_pink",
    text_position: "center",
    has_poll: false,
    visual: { kind: "product_scene", must_show: "A founder leaning back in a chair by a sunny window, laptop closed on the desk, morning light, vertical mid shot", composition: "subject in the lower third, vertical centre calm for text" },
  },
  buildup: {
    text: "Manual replies vs. automated ones",
    subtext: "A customer left waiting vs. an instant answer",
    background: "gradient_warm",
    text_position: "bottom",
    has_poll: true,
    poll_options: ["Manual, always", "Ready to automate"],
    visual: { kind: "side_by_side", must_show: "Left half a desk buried under unopened parcels and tangled cables, right half the same desk cleared with a single plant, eye level", composition: "both halves fill the upper two-thirds, bottom third calm for text", left: "A desk buried under unopened parcels and tangled cables, eye level", right: "The same desk cleared, a single plant on it, eye level" },
  },
  cta: {
    text: "Your inbox, handled",
    subtext: "Link in bio",
    background: "gradient_dark",
    text_position: "center",
    has_poll: false,
    visual: { kind: "detail_closeup", must_show: "A hand setting a phone face down on a tidy desk next to a fresh cup of tea, soft evening light", composition: "hand and phone at the bottom, vertical centre calm for text" },
  },
}

// The frame-format example (lib/ai/story-frames.ts): one object per slot,
// with that slot's frame fields and the type / visual the rest of the
// pipeline still reads.
function buildExampleFrameStoriesJson(typeSequence: string[], slots: string[]): string {
  const exampleStories = typeSequence.map((type, i) => {
    const example = EXAMPLE_SLIDE_BY_TYPE[type] ?? EXAMPLE_SLIDE_BY_TYPE.hook!
    return {
      story_number: i + 1,
      type,
      ...exampleFrameFields(slots[i] ?? "hook"),
      text_position: example.text_position,
      visual: example.visual,
    }
  })
  return JSON.stringify(exampleStories, null, 2)
    .split("\n")
    .map((line, i) => (i === 0 ? line : `  ${line}`))
    .join("\n")
}

// ─── Hard Truth Checklist (Story vibe) ─────────────────────────────────────
// Same concept the Post template (commit 16a7e8a) already shipped, adapted
// to Stories' hook->reveal/buildup->cta sequence instead of one flat card:
// the hook slide is the contrarian headline (one highlighted phrase), each
// reveal/buildup slide holds exactly one ✗ wrong-way line paired with its
// ✓ right-way line, and the cta slide is the closing reframing line + the
// usual handle/CTA (that's exactly what a normal cta slide's text/subtext
// already are -- no new field needed there). No AI photo on any slide --
// see StorySequence.tsx's generate() early-exit and lib/image/
// story-compositor.ts's checklist-aware rendering, both keyed off the
// presence of the new checklist_* fields below, not a separate flag.
const CHECKLIST_EXAMPLE_SLIDE_BY_TYPE: Record<string, { text: string; subtext: string; checklist_highlighted_phrase?: string; checklist_wrong_item?: string; checklist_right_item?: string }> = {
  hook: {
    text: "Cold showers aren't making you tougher",
    subtext: "",
    checklist_highlighted_phrase: "aren't making you tougher",
  },
  reveal: {
    text: "Icy showers every single morning",
    subtext: "A quick warm-to-cool rinse instead",
    checklist_wrong_item: "Icy showers every single morning",
    checklist_right_item: "A quick warm-to-cool rinse instead",
  },
  buildup: {
    text: "Forcing yourself through the shock",
    subtext: "Breathing calmly through 30 cool seconds",
    checklist_wrong_item: "Forcing yourself through the shock",
    checklist_right_item: "Breathing calmly through 30 cool seconds",
  },
  cta: {
    text: "Real resilience is built gradually",
    subtext: "Link in bio",
  },
}

function buildChecklistExampleStoriesJson(typeSequence: string[]): string {
  const exampleStories = typeSequence.map((type, i) => {
    const example = CHECKLIST_EXAMPLE_SLIDE_BY_TYPE[type] ?? CHECKLIST_EXAMPLE_SLIDE_BY_TYPE.hook!
    return {
      story_number: i + 1,
      type,
      text: example.text,
      subtext: example.subtext,
      // Ignored entirely for this vibe (see the prose instructions below)
      // -- still required fields on StorySlide, so any valid placeholder
      // works; the route overrides `background` deterministically anyway
      // (VIBE_TO_STORY_BACKGROUND above), same as every other vibe.
      background: "white",
      text_position: "center",
      has_poll: false,
      ...(example.checklist_highlighted_phrase ? { checklist_highlighted_phrase: example.checklist_highlighted_phrase } : {}),
      ...(example.checklist_wrong_item ? { checklist_wrong_item: example.checklist_wrong_item } : {}),
      ...(example.checklist_right_item ? { checklist_right_item: example.checklist_right_item } : {}),
    }
  })
  // Indented so nested lines line up under the "stories": key it gets
  // interpolated into below -- same convention buildExampleFrameStoriesJson
  // above already uses.
  return JSON.stringify(exampleStories, null, 2)
    .split("\n")
    .map((line, i) => (i === 0 ? line : `  ${line}`))
    .join("\n")
}

function buildHardTruthChecklistStoriesPrompt(
  brandCtx: string,
  pastExamplesBlock: string,
  topic: string,
  storyCount: number,
  typeSequence: string[],
  ctaPhrase: string,
  handle: string
): string {
  return `${buildTopicSubjectBlock(topic, "story")}

${brandCtx}${pastExamplesBlock}

NUMBER OF STORIES: ${storyCount}

Create a "Hard Truth Checklist" Instagram story sequence: a genuine myth-busting/contrarian or problem-and-solution take on the topic above, structured as a wrong-way vs. right-way comparison across the sequence.

Story type sequence: ${typeSequence.join(" → ")}

What each slide type means for THIS format specifically:
- hook: a genuine contrarian/myth-busting headline challenging a real misconception in this space (under 10 words) -- goes in "text". Also set "checklist_highlighted_phrase" to a short 2-4 word phrase taken VERBATIM from "text" to visually highlight. Leave "subtext" as an empty string -- this slide has no subtext.
- reveal / buildup: each of these slides holds EXACTLY ONE wrong-way vs. right-way pair -- a real mistake people make in this space, and its direct fix. Set "checklist_wrong_item" (the wrong way, under 8 words) and "checklist_right_item" (the direct fix for that SAME specific wrong item, under 8 words, matched 1-to-1 in theme). Also copy the same two lines into "text" (the wrong item) and "subtext" (the right item). Each reveal/buildup slide across the sequence must cover a DIFFERENT wrong/right pair -- never repeat the same mistake twice.
- cta: one closing line that reframes the whole point (not a summary -- a sharper final statement) in "text". "subtext" is the usual brief sign-off ("Link in bio" or similar).

"background" and "text_position" are ignored entirely for this format -- a fixed flat card layout renders regardless of what's set here. Just fill them with any valid placeholder value, e.g. "white" and "center". "has_poll" must always be false -- a poll doesn't fit this format.

TEXT RULES: No exclamation marks, no hashtags, no emojis anywhere. Plain, punchy, specific language -- a genuine insight, not a generic productivity-hack list.

CAPTION — separate from the story slides above: this is the actual Instagram caption text posted alongside the story sequence when it's scheduled, so it needs its own real copy, not a placeholder.
- caption_text: a short hook line (can echo the story's opening headline, doesn't need to repeat it word-for-word), 1-2 lines of value or context, then end with "${ctaPhrase}" followed by "${handle}" on its own line. Keep it tight — a few short lines, not an essay. Aim for under ~150 characters total unless the topic genuinely needs more room to explain.
- hashtags: 15 tags using the 5+5+5 rule:
  - 5 niche-specific (medium competition, 100K–2M posts): e.g. #SkincareRoutine, #CleanBeautyIndia
  - 5 brand/product-specific (low competition, unique to brand): e.g. #BrandName, #ProductName
  - 5 broad/trending (high volume, 5M+ posts): e.g. #Skincare, #Beauty, #SelfCare
${QUALITY_BAR}

Respond with ONLY this JSON:
{
  "stories": ${buildChecklistExampleStoriesJson(typeSequence)},
  "caption": {
    "caption_text": "hook line, 1-2 lines of value, then ${ctaPhrase} and ${handle} on its own line — see CAPTION above",
    "hashtags": ["niche1", "niche2", "niche3", "niche4", "niche5", "brand1", "brand2", "brand3", "brand4", "brand5", "broad1", "broad2", "broad3", "broad4", "broad5"]
  },
  ${buildSuggestedFontField("the flat cream checklist card")}
}

Make the text punchy and specific. Each story should make the viewer want to tap to the next one.`
}

function buildStoriesPrompt(brand: BrandRow, topic: string, storyCount: number, vibe?: string, pastExamples: string[] = [], frameCtx: StoryFrameContext = storyFrameContext(brand, null, topic)): string {
  const brandCtx = [
    `Brand: ${brand.name}`,
    brand.niche ? `Niche: ${brand.niche}` : null,
    brand.tone_of_voice ? `Tone: ${brand.tone_of_voice}` : null,
    brand.instagram_handle ? `Handle: @${brand.instagram_handle}` : null,
    vibe ? `Visual Vibe: ${vibe}` : null,
    ...buildBrandBrainLines(parseBrandBrain(brand.brand_brain)),
  ].filter(Boolean).join("\n")

  const typeSequence = buildStoryTypeSequence(storyCount)
  const pastExamplesBlock = buildPastExamplesBlock(pastExamples, "stories")

  const b = brand as BrandRow & { cta_phrase?: string | null }
  const ctaPhrase = b.cta_phrase || "Shop now"
  const handle = brand.instagram_handle ? `@${brand.instagram_handle}` : "@handle"

  if (vibe === "hard_truth_checklist") {
    return buildHardTruthChecklistStoriesPrompt(brandCtx, pastExamplesBlock, topic, storyCount, typeSequence, ctaPhrase, handle)
  }

  // The topic first (the subject); the brand and any past examples after it (style only).
  return `${buildTopicSubjectBlock(topic, "story")}

${brandCtx}${pastExamplesBlock}

NUMBER OF STORIES: ${storyCount}

Create ${storyCount} connected Instagram stories that build narrative momentum, all about the STORY TOPIC above.

Story type sequence: ${typeSequence.join(" → ")}

Story types:
- hook: Stops the scroll, creates curiosity, "Wait till you see this" energy
- reveal: Shows/introduces the main thing (product, concept, transformation)
- buildup: Adds details, benefits, social proof, or context
- cta: Final slide with strong call to action and @handle

STEP 1 — STORY PLAN (do this first, emit it as "story_plan" before the stories):
- "goal": the one thing this sequence should make the viewer think or do.
- "next_action": the concrete action the cta frame asks for (tap link, reply, DM, shop).
- "arc": one entry per frame, in the type sequence above — its "story_number", its "type", and the single "message" that frame carries.
Then write every frame from its arc entry.

${storyFrameRules(frameCtx, storyCount)}

VISUAL DIRECTION — every story object gets a "visual" brief for its full-screen 9:16 background image:
- "kind": one of ${VISUAL_KINDS.join(" | ")}.
- "must_show": 1-2 sentences, concrete and photographable — which objects, in what arrangement, from what angle.
- "composition": where the subject sits and which region stays calm for the text.
- For side_by_side or before_after, also give "left" and "right": what each half alone shows (before / first option on the left), visible things only, under 200 characters each.
Rules:
- Compose for a vertical phone screen: subject stacked vertically, not a wide landscape scene.
- Keep the frame's text_position region (top / center / bottom) calm — put the subject elsewhere.
- The visual must DEMONSTRATE the frame's message, not decorate it: a comparison shows both things, a process shows its stages, a material shows the actual material.
- Consecutive frames vary the subject and the framing (wide / mid / close-up) — never the same scene twice.
- Use "abstract_mood" only for the hook or cta frame, and only when no concrete visual fits the brand.
- must_show describes ONLY visible things. Never put words, labels, headlines, quotes, numbers, logos or captions in it — the image model renders those as garbled text.
- Only depict what's plausible for this brand's actual products or services in the brand context above.
${NO_TEXT_BEARING_SUBJECTS_RULE}
${CANDID_PHOTO_RULE}
${artDirectionBriefRules(artDirectionFrom(brand))}

CAPTION — separate from the story slides above: this is the actual Instagram caption text posted alongside the story sequence when it's scheduled, so it needs its own real copy, not a placeholder.
- caption_text: a short hook line (can echo the story's opening hook, doesn't need to repeat it word-for-word), 1-2 lines of value or context, then end with "${ctaPhrase}" followed by "${handle}" on its own line. Keep it tight — a few short lines, not an essay. Aim for under ~150 characters total unless the topic genuinely needs more room to explain.
- hashtags: 15 tags using the 5+5+5 rule:
  - 5 niche-specific (medium competition, 100K–2M posts): e.g. #SkincareRoutine, #CleanBeautyIndia
  - 5 brand/product-specific (low competition, unique to brand): e.g. #BrandName, #ProductName
  - 5 broad/trending (high volume, 5M+ posts): e.g. #Skincare, #Beauty, #SelfCare
${QUALITY_BAR}

Respond with ONLY this JSON:
{
  "story_plan": {
    "goal": "the one thing this sequence should make the viewer think or do",
    "next_action": "the concrete action the cta frame asks for",
    "arc": [${typeSequence.map((type, i) => `{ "story_number": ${i + 1}, "type": "${type}", "message": "the single message of this frame" }`).join(", ")}]
  },
  "stories": ${buildExampleFrameStoriesJson(typeSequence, frameSlots(storyCount, allowedMiddleFrames(frameCtx)))},
  "caption": {
    "caption_text": "hook line, 1-2 lines of value, then ${ctaPhrase} and ${handle} on its own line — see CAPTION above",
    "hashtags": ["niche1", "niche2", "niche3", "niche4", "niche5", "brand1", "brand2", "brand3", "brand4", "brand5", "broad1", "broad2", "broad3", "broad4", "broad5"]
  },
  "suggested_vibe": "one of: fun_playful | clean_minimal | bold_dramatic | warm_cozy | professional | trendy_genz — whichever best fits this topic and the brand's own tone_of_voice/vibe above",
  ${buildSuggestedFontField("the suggested_vibe you picked (it sets the slide colors)")}
}

Make every frame punchy and emotion-led. Each story should make the viewer want to tap to the next one.`
}

/**
 * One OpenAI call for the WHOLE story sequence -- every slide plus the
 * caption come back in a single JSON object, so there is nothing to
 * parallelize per slide. Returns the raw model text (the route parses and
 * validates it, exactly as before) plus usage/cost for
 * ai_generation_logs; throws on provider error/timeout so the route's
 * existing refund-and-500 path handles it unchanged.
 *
 * Fact guard (lib/ai/fact-guard.ts): if the parsed slides/caption use a
 * number that isn't in the brand facts or topic, retries once with an
 * explicit correction; if that still fails (or the retry itself errors),
 * strips the offending sentences. Unparseable JSON is passed through
 * untouched -- the route already handles that.
 */
export async function requestStorySequence(
  brand: BrandRow,
  topic: string,
  storyCount: number,
  vibe: string | undefined,
  pastExamples: string[],
  /** "story"-scope brand lessons (lib/ai/brand-brain.ts), fetched by the route. */
  lessons?: BrandLesson[],
  /** Epoch ms the route must finish by -- the quality gate skips its repair past it. */
  deadline?: number,
  /** The picked product: product frames, callout facts and offer numbers. */
  product: ProductRow | null = null
): Promise<{ raw: string; model: string; usage: TextUsage | undefined; costUsd: number | null; gate?: GateReport }> {
  // Story frames (lib/ai/story-frames.ts) -- not for Hard Truth Checklist,
  // which keeps its own wrong-way / right-way design.
  const frameCtx = storyFrameContext(brand, product, topic)
  const frames = vibe !== "hard_truth_checklist"
  const withFrames = (d: Record<string, unknown>) => (frames && Array.isArray(d.stories)
    ? { ...d, stories: finalizeStoryFrames(d.stories.filter((x): x is Record<string, unknown> => !!x && typeof x === "object"), frameCtx) }
    : d)
  const base = {
    stage: "story",
    logPrefix: "ai/stories/generate",
    system: `You are an expert Instagram story creator for Indian D2C brands. Always return valid JSON only.
${QUALITY_BAR}`,
    user: withLessons(buildStoriesPrompt(brand, topic, storyCount, vibe, pastExamples, frameCtx), lessons),
    // Structured multi-slide JSON needs real reasoning to keep the
    // narrative arc coherent across slides -- same "medium" as on Groq.
    // Budget scales with storyCount (up to 10), unchanged from Groq: hidden
    // reasoning tokens count against it on gpt-5.5 too.
    reasoningEffort: "medium" as const,
    // Raised from max(3000, storyCount * 350) for the story_plan and the
    // per-frame visual briefs the normal prompt now asks for -- an
    // ESTIMATE, not measured. Hard Truth Checklist (no AI image, no plan)
    // keeps the old budget.
    maxCompletionTokens: vibe === "hard_truth_checklist" ? Math.max(3000, storyCount * 350) : Math.max(4000, storyCount * 600),
    // ESTIMATE, not measured (no OPENAI_API_KEY where this was written) --
    // see scripts/test-creative-stages.ts. Sized for a 10-slide sequence
    // at medium effort; revisit against real latency.
    timeoutMs: 60_000,
  }
  const first = await createCreativeCompletion(base)
  let raw = first.content ?? "{}"
  const firstRaw = raw
  let usage = first.usage
  let costUsd = first.costUsd
  let gate: GateReport | undefined

  const parsedRaw = parseStoryJson(raw)
  const parsed = parsedRaw ? withFrames(parsedRaw) : null
  if (parsed) {
    const guarded = withFrames(await guardCopy({
      stage: "story",
      data: parsed,
      facts: buildFactSource({ brand, product, brief: [topic] }),
      normalTimeoutMs: base.timeoutMs,
      retry: async (correction, timeoutMs) => {
        const retry = await createCreativeCompletion({ ...base, timeoutMs, followUp: { previous: raw, correction } })
        usage = addTextUsage(usage, retry.usage)
        costUsd = sumCostUsd(costUsd, retry.costUsd)
        const retryParsed = parseStoryJson(retry.content ?? "")
        if (!retryParsed) throw new Error("unparseable retry")
        return withFrames(retryParsed)
      },
    }))
    const withVisuals = sanitizeStoryVisuals(guarded)
    if (withVisuals !== parsedRaw) raw = JSON.stringify(withVisuals)

    // Quality gate (lib/ai/quality-gate.ts) -- normal prompt only; Hard
    // Truth Checklist has no image and stays exactly as is.
    if (vibe !== "hard_truth_checklist") {
      const facts = buildFactSource({ brand, product, brief: [topic] })
      const gated = await runQualityGate({
        format: "story",
        data: withVisuals,
        brand,
        brief: [topic],
        topic,
        deadline,
        normalTimeoutMs: base.timeoutMs,
        repair: async (correction, timeoutMs) => {
          const fix = await createCreativeCompletion({ ...base, timeoutMs, followUp: { previous: firstRaw, correction } })
          usage = addTextUsage(usage, fix.usage)
          costUsd = sumCostUsd(costUsd, fix.costUsd)
          const fixParsed = parseStoryJson(fix.content ?? "")
          if (!fixParsed) throw new Error("unparseable repair")
          return sanitizeStoryVisuals(withFrames(stripGuard("story", fixParsed, facts)))
        },
      })
      gate = gated.gate
      usage = addTextUsage(usage, gate.usage)
      costUsd = sumCostUsd(costUsd, gate.costUsd)
      if (gated.data !== withVisuals) raw = JSON.stringify(gated.data)
    }
  }
  return { raw, model: first.model, usage, costUsd, gate }
}

// Runs sanitizeVisualBrief (lib/ai/visual-brief.ts) on every story's
// "visual", dropping an invalid one. Returns `data` itself when no story
// carries a "visual" key (e.g. Hard Truth Checklist), so its raw text is
// left untouched.
function sanitizeStoryVisuals(data: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(data.stories) || !data.stories.some((s) => s && typeof s === "object" && "visual" in s)) return data
  return {
    ...data,
    stories: data.stories.map((s) => {
      if (!s || typeof s !== "object" || Array.isArray(s)) return s
      const { visual, ...rest } = s as Record<string, unknown>
      const clean = sanitizeVisualBrief(visual)
      return clean ? { ...rest, visual: clean } : rest
    }),
  }
}

// Same lenient cleanup the route applies before its own JSON.parse.
function parseStoryJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim())
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}
