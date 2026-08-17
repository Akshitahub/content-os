import type { BrandRow, ProductRow } from "@/types/database"
import type { ContentFormat, ContentFormatOutputMap, Platform } from "@/types/app"
import { MODELS, getGroqClient } from "./models"
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

export type GenerateContentOptions = {
  product?: ProductRow | null
  platform?: Platform
  additionalContext?: string
  hookText?: string
  /** Brand's own past highly-rated content of this format, fed back in as few-shot examples. */
  pastExamples?: string[]
  /** social_post only — asks the same Groq call to also produce an image_prompt grounded in this post's specific message, for the Create → Full Post AI image pipeline. */
  includeImagePrompt?: boolean
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
        system: buildCaptionSystemPrompt(options.includeImagePrompt ?? false),
        user: buildCaptionUserPrompt(brand, {
          platform: options.platform ?? "instagram",
          contentType: "post",
          hookText: options.hookText,
          additionalContext: options.additionalContext,
          product: options.product,
          pastExamples: options.pastExamples,
          includeImagePrompt: options.includeImagePrompt,
        }),
        reasoningEffort: "low",
        // A bit more headroom when image_prompt is also being generated in
        // the same JSON response, so it doesn't get truncated mid-field.
        maxTokens: options.includeImagePrompt ? 1600 : 1200,
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
        system: buildCarouselSystemPrompt(),
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
        system: buildAdCopySystemPrompt(),
        user: buildAdCopyUserPrompt(brand, options),
        reasoningEffort: "low",
        maxTokens: 1200,
      }
  }
}

function validateAndCast(
  format: ContentFormat,
  parsed: unknown
): ContentFormatOutputMap[ContentFormat] {
  const obj = parsed as Record<string, unknown>
  switch (format) {
    case "social_post":
      if (!obj.caption_text) throw new Error("AI response missing caption_text")
      break
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

export async function generateContent(
  brand: BrandRow,
  format: ContentFormat,
  options: GenerateContentOptions
): Promise<{
  data: ContentFormatOutputMap[ContentFormat]
  model: string
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined
}> {
  const groq = getGroqClient()
  const model = MODELS.generation
  const { system, user, maxTokens, reasoningEffort } = buildPrompts(format, brand, options)

  const response = await groq.chat.completions.create({
    model,
    temperature: 0.8,
    reasoning_effort: reasoningEffort,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  })

  const raw = response.choices[0]?.message?.content ?? "{}"
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

  const data = validateAndCast(format, parsed)

  if (format === "social_post") {
    const caption = data as ContentFormatOutputMap["social_post"]
    caption.character_count = caption.caption_text.length
  }

  return { data, model, usage: response.usage ?? undefined }
}
