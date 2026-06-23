import OpenAI from "openai"
import type { BrandRow, ProductRow } from "@/types/database"
import type { ContentFormat, ContentFormatOutputMap, Platform } from "@/types/app"
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
}

type PromptConfig = { system: string; user: string; maxTokens: number }

function buildPrompts(
  format: ContentFormat,
  brand: BrandRow,
  options: GenerateContentOptions
): PromptConfig {
  switch (format) {
    case "social_post":
      return {
        system: buildCaptionSystemPrompt(),
        user: buildCaptionUserPrompt(brand, {
          platform: options.platform ?? "instagram",
          contentType: "post",
          hookText: options.hookText,
          additionalContext: options.additionalContext,
          product: options.product,
        }),
        maxTokens: 1200,
      }
    case "reel_script":
      return {
        system: buildReelScriptSystemPrompt(),
        user: buildReelScriptUserPrompt(brand, options),
        maxTokens: 1500,
      }
    case "story":
      return {
        system: buildStorySystemPrompt(),
        user: buildStoryUserPrompt(brand, options),
        maxTokens: 300,
      }
    case "carousel":
      return {
        system: buildCarouselSystemPrompt(),
        user: buildCarouselUserPrompt(brand, options),
        maxTokens: 2000,
      }
    case "blog_post":
      return {
        system: buildBlogPostSystemPrompt(),
        user: buildBlogPostUserPrompt(brand, options),
        maxTokens: 2000,
      }
    case "ad_copy":
      return {
        system: buildAdCopySystemPrompt(),
        user: buildAdCopyUserPrompt(brand, options),
        maxTokens: 600,
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
  usage: OpenAI.Completions.CompletionUsage | undefined
}> {
  const apiKey = process.env.NVIDIA_API_KEY
  if (!apiKey) throw new Error("NVIDIA_API_KEY is not configured on the server.")
  const openai = new OpenAI({
    apiKey,
    baseURL: "https://integrate.api.nvidia.com/v1",
  })

  const model = "meta/llama-3.1-70b-instruct"
  const { system, user, maxTokens } = buildPrompts(format, brand, options)

  const response = await openai.chat.completions.create({
    model,
    temperature: 0.8,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  })

  const raw = response.choices[0]?.message?.content ?? "{}"
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`AI returned invalid JSON for format "${format}"`)
  }

  const data = validateAndCast(format, parsed)

  // Ensure character_count is accurate for social posts
  if (format === "social_post") {
    const caption = data as ContentFormatOutputMap["social_post"]
    caption.character_count = caption.caption_text.length
  }

  return { data, model, usage: response.usage ?? undefined }
}
