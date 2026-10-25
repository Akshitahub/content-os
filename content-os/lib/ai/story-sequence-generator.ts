import type { BrandRow } from "@/types/database"
import type { StorySlide } from "@/app/api/v1/ai/stories/generate/route"
import { buildPastExamplesBlock, QUALITY_BAR } from "./prompts"
import { createCreativeCompletion } from "./creative-completion"

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
  // interpolated into below -- same convention buildExampleStoriesJson
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
  return `${brandCtx}${pastExamplesBlock}

STORY TOPIC: "${topic}"
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
  }
}

Make the text punchy and specific. Each story should make the viewer want to tap to the next one.`
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

  if (vibe === "hard_truth_checklist") {
    return buildHardTruthChecklistStoriesPrompt(brandCtx, pastExamplesBlock, topic, storyCount, typeSequence, ctaPhrase, handle)
  }

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
  },
  "suggested_vibe": "one of: fun_playful | clean_minimal | bold_dramatic | warm_cozy | professional | trendy_genz — whichever best fits this topic and the brand's own tone_of_voice/vibe above"
}

Make the text punchy and emotion-led. Each story should make the viewer want to tap to the next one.`
}

/**
 * One OpenAI call for the WHOLE story sequence -- every slide plus the
 * caption come back in a single JSON object, so there is nothing to
 * parallelize per slide. Returns the raw model text (the route parses and
 * validates it, exactly as before); throws on provider error/timeout so
 * the route's existing refund-and-500 path handles it unchanged.
 */
export async function requestStorySequence(
  brand: BrandRow,
  topic: string,
  storyCount: number,
  vibe: string | undefined,
  pastExamples: string[]
): Promise<string> {
  const { content } = await createCreativeCompletion({
    stage: "story",
    logPrefix: "ai/stories/generate",
    system: `You are an expert Instagram story creator for Indian D2C brands. Always return valid JSON only.
${QUALITY_BAR}`,
    user: buildStoriesPrompt(brand, topic, storyCount, vibe, pastExamples),
    // Structured multi-slide JSON needs real reasoning to keep the
    // narrative arc coherent across slides -- same "medium" as on Groq.
    // Budget scales with storyCount (up to 10), unchanged from Groq: hidden
    // reasoning tokens count against it on gpt-5.5 too.
    reasoningEffort: "medium",
    maxCompletionTokens: Math.max(3000, storyCount * 350),
    // ESTIMATE, not measured (no OPENAI_API_KEY where this was written) --
    // see scripts/test-creative-stages.ts. Sized for a 10-slide sequence
    // at medium effort; revisit against real latency.
    timeoutMs: 60_000,
  })
  return content ?? "{}"
}
