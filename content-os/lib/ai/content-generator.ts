import type { BrandRow, ProductRow } from "@/types/database"
import type { ContentFormat, ContentFormatOutputMap, GeneratedCaption, Platform } from "@/types/app"
import { MODELS, getTextClientFor, textProviderFor } from "./models"
import { buildFactSource, guardCopy } from "./fact-guard"
import { addTextUsage, sumCostUsd, textCostUsd, toTextUsage, type TextUsage } from "./pricing"
import { runQualityGate, type GateReport } from "./quality-gate"
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions"
import {
  buildCaptionSystemPrompt,
  buildCaptionUserPrompt,
  buildReelScriptSystemPrompt,
  buildReelScriptUserPrompt,
  buildStorySystemPrompt,
  buildStoryUserPrompt,
  buildCarouselSystemPrompt,
  buildCarouselUserPrompt,
  buildBlogPostSystemPrompt,
  buildBlogPostUserPrompt,
  buildAdCopySystemPrompt,
  buildAdCopyUserPrompt,
} from "./prompts"
import { generateValidatedCaption, type CaptionChatMessage } from "./caption-validation"
import { findContentQualityIssues, sanitizeLeakedArtifacts } from "./content-quality-check"
import { sanitizeVisualBrief } from "./visual-brief"
import type { BrandLesson } from "./brand-brain"

export type GenerateContentOptions = {
  product?: ProductRow | null
  platform?: Platform
  additionalContext?: string
  hookText?: string
  /** Brand's own past highly-rated content of this format, fed back in as few-shot examples. */
  pastExamples?: string[]
  /** social_post only — asks the same caption-model call to also produce an image_prompt grounded in this post's specific message, for the Create → Full Post AI image pipeline. */
  includeImagePrompt?: boolean
  /** social_post + includeImagePrompt only — the brand's resolved color themes, so the same caption-model call can pick a suggested_color_theme_id from real ids rather than guessing. */
  availableColorThemes?: { id: string; label: string }[]
  /** Epoch ms by which this text step must finish -- set by routes with a
   * hard maxDuration. The fact guard's corrective retry is skipped (claim
   * stripped instead) when it can't fit before this. Omitted = no limit. */
  factGuardDeadline?: number
  /** Brand lessons (lib/ai/brand-brain.ts) for this format's scope, fetched
   * by the route -- used by the caption, story, carousel and ad_copy prompts. */
  lessons?: BrandLesson[]
}

type ReasoningEffort = "none" | "low" | "medium" | "high"
type PromptConfig = { system: string; user: string; maxTokens: number; reasoningEffort: ReasoningEffort }

// GPT-OSS reasoning tokens count against max_tokens — every value below was
// recalibrated against live-measured reasoning consumption on
// openai/gpt-oss-120b, not just bumped arbitrarily. "low" for short, single-
// shot creative output (measured ~230-370 total completion tokens for a
// comparable caption task); "medium" for structurally complex, multi-part
// JSON (measured ~1500 total completion tokens for a comparable 7-slide
// carousel) — the old Llama-era max_tokens values 400s outright
// ("json_validate_failed") once reasoning tokens are in play at all.
function buildPrompts(
  format: ContentFormat,
  brand: BrandRow,
  options: GenerateContentOptions
): PromptConfig {
  switch (format) {
    case "social_post":
      return {
        system: buildCaptionSystemPrompt(brand.vibe, options.includeImagePrompt ?? false),
        user: buildCaptionUserPrompt(brand, {
          platform: options.platform ?? "instagram",
          contentType: "post",
          hookText: options.hookText,
          additionalContext: options.additionalContext,
          product: options.product,
          pastExamples: options.pastExamples,
          includeImagePrompt: options.includeImagePrompt,
          availableColorThemes: options.availableColorThemes,
          lessons: options.lessons,
        }),
        reasoningEffort: "low",
        // A bit more headroom when image_prompt is also being generated in
        // the same JSON response, so it doesn't get truncated mid-field.
        // includeImagePrompt raised from 1600 for the post_plan + visual
        // brief Full Post now asks for -- an ESTIMATE, not measured.
        maxTokens: options.includeImagePrompt ? 2000 : 1200,
      }
    case "reel_script":
      return {
        system: buildReelScriptSystemPrompt(),
        user: buildReelScriptUserPrompt(brand, options),
        reasoningEffort: "medium",
        maxTokens: 2500,
      }
    case "story":
      return {
        system: buildStorySystemPrompt(),
        user: buildStoryUserPrompt(brand, options),
        reasoningEffort: "low",
        maxTokens: 800,
      }
    case "carousel":
      return {
        system: buildCarouselSystemPrompt(brand.vibe),
        user: buildCarouselUserPrompt(brand, options),
        reasoningEffort: "medium",
        maxTokens: 3000,
      }
    case "blog_post":
      return {
        system: buildBlogPostSystemPrompt(),
        user: buildBlogPostUserPrompt(brand, options),
        reasoningEffort: "medium",
        maxTokens: 2500,
      }
    case "ad_copy":
      return {
        system: buildAdCopySystemPrompt(brand.vibe),
        user: buildAdCopyUserPrompt(brand, options),
        reasoningEffort: "low",
        maxTokens: 1200,
      }
  }
}

// social_post is validated/cast via generateValidatedCaption in
// generateContent() instead — it never reaches this function.
function validateAndCast(
  format: Exclude<ContentFormat, "social_post">,
  parsed: unknown
): ContentFormatOutputMap[ContentFormat] {
  const obj = parsed as Record<string, unknown>
  switch (format) {
    case "reel_script":
      if (!obj.hook || !Array.isArray(obj.scenes) || obj.scenes.length === 0)
        throw new Error("AI response missing hook or scenes")
      break
    case "story":
      if (!obj.text) throw new Error("AI response missing text")
      break
    case "carousel":
      if (!Array.isArray(obj.slides) || obj.slides.length === 0)
        throw new Error("AI response missing slides")
      break
    case "blog_post":
      if (!obj.title || !obj.body) throw new Error("AI response missing title or body")
      break
    case "ad_copy":
      if (!obj.headline || !obj.primary_text)
        throw new Error("AI response missing headline or primary_text")
      break
  }
  return parsed as ContentFormatOutputMap[ContentFormat]
}

// Lightweight sanity pass over every real text field before it's returned
// -- see lib/ai/content-quality-check.ts for what this catches (leaked
// "✓"/"✗" formatting markers, unfilled "[Placeholder]" brackets, raw
// template expressions, a stray unattached "x"). Mechanical fix-in-place,
// same reasoning as fastlane.ts's identical helper: this generic
// multi-format path has no per-format validate-and-retry loop of its own
// (social_post is the one exception, handled separately by
// generateValidatedCaption/caption-validation.ts), so re-running an entire
// generation over one bad word in one field would be a much heavier fix
// than the problem warrants. Logged loudly whenever it actually changes
// something.
function fixText(value: string, label: string): string {
  if (!value || findContentQualityIssues(value).length === 0) return value
  const cleaned = sanitizeLeakedArtifacts(value)
  console.error(`[content-generator] stripped leaked artifact(s) from generated ${label}: ${JSON.stringify(value)} -> ${JSON.stringify(cleaned)}`)
  return cleaned
}

function sanitizeContent(
  format: Exclude<ContentFormat, "social_post">,
  data: ContentFormatOutputMap[ContentFormat]
): ContentFormatOutputMap[ContentFormat] {
  switch (format) {
    case "reel_script": {
      const d = data as ContentFormatOutputMap["reel_script"]
      return { ...d, hook: fixText(d.hook, "hook"), caption: fixText(d.caption, "caption"), scenes: d.scenes.map((s) => ({ ...s, visual_direction: fixText(s.visual_direction, "scene visual_direction"), voiceover_or_text_overlay: fixText(s.voiceover_or_text_overlay, "scene voiceover_or_text_overlay") })) }
    }
    case "story": {
      const d = data as ContentFormatOutputMap["story"]
      return { ...d, text: fixText(d.text, "text") }
    }
    case "carousel": {
      const d = data as ContentFormatOutputMap["carousel"]
      return { ...d, caption: fixText(d.caption, "caption"), slides: d.slides.map((s) => ({ ...s, headline: fixText(s.headline, "slide headline"), body: fixText(s.body, "slide body") })) }
    }
    case "blog_post": {
      const d = data as ContentFormatOutputMap["blog_post"]
      return { ...d, title: fixText(d.title, "title"), body: fixText(d.body, "body") }
    }
    case "ad_copy": {
      const d = data as ContentFormatOutputMap["ad_copy"]
      return { ...d, headline: fixText(d.headline, "headline"), primary_text: fixText(d.primary_text, "primary_text"), description: fixText(d.description, "description") }
    }
  }
}

export async function generateContent(
  brand: BrandRow,
  format: ContentFormat,
  options: GenerateContentOptions
): Promise<{
  data: ContentFormatOutputMap[ContentFormat]
  model: string
  usage: TextUsage | undefined
  costUsd: number | null
  /** Full Post caption only (includeImagePrompt): the pre-image quality gate's report. */
  gate?: GateReport
}> {
  const { system, user, maxTokens, reasoningEffort } = buildPrompts(format, brand, options)
  const facts = buildFactSource({ brand, product: options.product, brief: [options.hookText, options.additionalContext] })

  // social_post is the only format with real production traffic that
  // needs output enforcement (hashtag count, CTA/handle ending, platform
  // char limit) — see docs/research/captions-generation-audit.md. Routed
  // through the same generateValidatedCaption() orchestrator that
  // lib/ai/captions-generator.ts uses, so the two paths can't drift apart
  // again. Captions moved to OpenAI (MODELS.caption).
  if (format === "social_post") {
    const captionModel = MODELS.caption
    const openai = getTextClientFor(captionModel)
    const b = brand as BrandRow & { cta_phrase?: string | null }
    const ctaPhrase = b.cta_phrase || "Shop now"
    const handle = brand.instagram_handle ? `@${brand.instagram_handle}` : ""
    const platform = options.platform ?? "instagram"

    // max_completion_tokens (not the deprecated max_tokens), same reasoning
    // as lib/ai/captions-generator.ts's identical call -- gpt-5.5-class
    // models are reasoning models. `temperature` deliberately omitted, same
    // reasoning as that file too.
    const requestParams = {
      model: captionModel,
      reasoning_effort: reasoningEffort,
      max_completion_tokens: maxTokens,
      response_format: { type: "json_object" as const },
    }

    const messages: CaptionChatMessage[] = [
      { role: "system", content: system },
      { role: "user", content: user },
    ]

    const callModel = async (msgs: CaptionChatMessage[]) => {
        // Explicit timeout + one retry, like every other model call here --
        // this used to pass none, so the SDK default (10 minutes, 2
        // retries) applied: a slow caption could outlive the route's
        // maxDuration, Vercel killed the function, and the client got a
        // non-JSON error page. 40s is the same estimate the other
        // medium-length text calls use (not measured live).
        const res = await openai.chat.completions.create({ ...requestParams, messages: msgs }, { timeout: 40_000, maxRetries: 1 })
        return { content: res.choices[0]?.message?.content ?? "{}", usage: toTextUsage(res.usage) }
    }
    const validated = await generateValidatedCaption({
      messages,
      callModel,
      brand,
      ctaPhrase,
      handle,
      platform,
      facts,
      deadline: options.factGuardDeadline,
    })
    let captionUsage = validated.usage

    // Full Post's visual brief is model output like any other field -- run it
    // through the same sanitizer carousels/stories use, dropping it if invalid.
    const withCleanVisual = (c: GeneratedCaption): GeneratedCaption => {
      const { visual, ...rest } = c
      const cleanVisual = sanitizeVisualBrief(visual)
      return cleanVisual ? { ...rest, visual: cleanVisual } : rest
    }
    let finalCaption = withCleanVisual(validated.caption)

    // Quality gate (lib/ai/quality-gate.ts) -- Full Post only (it makes an
    // image from this caption's visual brief). The repair re-runs this same
    // validated caption call with the correction as a follow-up.
    let gate: GateReport | undefined
    if (options.includeImagePrompt) {
      const firstCaption = finalCaption
      const gated = await runQualityGate({
        format: "post",
        data: firstCaption,
        brand,
        product: options.product,
        brief: [options.hookText, options.additionalContext],
        deadline: options.factGuardDeadline,
        normalTimeoutMs: 40_000,
        repair: async (correction) => {
          const repaired = await generateValidatedCaption({
            messages: [...messages, { role: "assistant", content: JSON.stringify(firstCaption) }, { role: "user", content: correction }],
            callModel,
            brand,
            ctaPhrase,
            handle,
            platform,
            facts,
            deadline: options.factGuardDeadline,
          })
          captionUsage = addTextUsage(captionUsage, repaired.usage)
          return withCleanVisual(repaired.caption)
        },
      })
      finalCaption = gated.data
      gate = gated.gate
    }

    return {
      data: finalCaption,
      model: captionModel,
      usage: addTextUsage(captionUsage, gate?.usage),
      costUsd: sumCostUsd(textCostUsd(captionModel, captionUsage), gate?.costUsd),
      gate,
    }
  }

  // Every non-social_post format is on OpenAI (MODELS.creative) now:
  // reel_script/blog_post/ad_copy moved in Phase 1, story/carousel in
  // Phase 1b. The JSON parsing and validateAndCast/sanitizeContent below
  // are unchanged -- the output SHAPE per format never changed, only which
  // provider produced it.
  const model = MODELS.creative
  const openai = getTextClientFor(model)
  const baseMessages: ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ]

  const normalTimeoutMs = format === "story" ? 30_000 : 40_000
  const callOnce = async (messages: ChatCompletionMessageParam[], timeoutMs = normalTimeoutMs): Promise<{ raw: string; usage: TextUsage | undefined }> => {
    const startTime = Date.now()
    try {
      const response = await openai.chat.completions.create(
        {
          model,
          reasoning_effort: reasoningEffort,
          // max_completion_tokens (not the deprecated max_tokens) since
          // gpt-5.5-class models are reasoning models, same convention as
          // lib/ai/captions-generator.ts. `temperature` deliberately
          // omitted, same reasoning as that file.
          max_completion_tokens: maxTokens,
          response_format: { type: "json_object" },
          messages,
        },
        // ESTIMATES, not measured live (no working OPENAI_API_KEY in the
        // environment this was written in) -- see
        // scripts/test-creative-stages.ts. 40s is sized for the "medium"
        // formats (reel_script/blog_post/carousel); story runs at "low" with
        // an 800-token budget. Carousel is deliberately NOT given more than
        // 40s: calendar/[entryId]/regenerate (maxDuration 60) calls it, and
        // a longer timeout would outlive that route. Revisit all of these
        // once real latency data exists.
        { timeout: timeoutMs, maxRetries: 1 }
      )
      console.log(`[content-generator] provider=${textProviderFor(model)} model=${model} stage=${format} latencyMs=${Date.now() - startTime} success=true`)
      return { raw: response.choices[0]?.message?.content ?? "{}", usage: toTextUsage(response.usage) }
    } catch (err) {
      console.error(`[content-generator] provider=${textProviderFor(model)} model=${model} stage=${format} latencyMs=${Date.now() - startTime} success=false:`, err)
      throw err
    }
  }

  const first = await callOnce(baseMessages)
  let usage = first.usage
  let data = parseFormat(format, first.raw)

  // Fact guard (lib/ai/fact-guard.ts) for every format's copy: one
  // corrective retry (time budget permitting), then strip whatever's still
  // unsupported. Fail-soft: never fails a generation that already succeeded.
  data = await guardCopy({
    stage: format,
    data,
    facts,
    normalTimeoutMs,
    deadline: options.factGuardDeadline,
    retry: async (correction, timeoutMs) => {
      const retry = await callOnce([...baseMessages, { role: "assistant", content: first.raw }, { role: "user", content: correction }], timeoutMs)
      usage = addTextUsage(usage, retry.usage)
      return parseFormat(format, retry.raw)
    },
  })

  return { data, model, usage, costUsd: textCostUsd(model, usage) }
}

function parseFormat(format: Exclude<ContentFormat, "social_post">, raw: string): ContentFormatOutputMap[ContentFormat] {
  let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").replace(/[\x00-\x1F\x7F]/g, " ").trim()
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (jsonMatch) cleaned = jsonMatch[0]
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    console.error(`[content-generator] JSON parse failed for "${format}". Raw:`, raw.slice(0, 500))
    throw new Error(`AI returned invalid JSON for format "${format}"`)
  }

  return sanitizeContent(format, validateAndCast(format, parsed))
}
