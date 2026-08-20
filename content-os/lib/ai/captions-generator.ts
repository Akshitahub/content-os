import type { BrandRow, ProductRow } from "@/types/database"
import type { Platform } from "@/types/app"
import { buildCaptionSystemPrompt, buildCaptionUserPrompt } from "./prompts"
import { MODELS, getGroqClient } from "./models"
import { generateValidatedCaption, type CaptionChatMessage } from "./caption-validation"

export async function generateCaption(
  brand: BrandRow,
  options: {
    hookText?: string
    platform: Platform
    contentType: string
    additionalContext?: string
    product?: ProductRow | null
    pastExamples?: string[]
  }
): Promise<{ caption: import("@/types/app").GeneratedCaption; model: string; usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined }> {
  const groq = getGroqClient()
  const model = MODELS.generation

  const b = brand as BrandRow & { cta_phrase?: string | null }
  const ctaPhrase = b.cta_phrase || "Shop now"
  const handle = brand.instagram_handle ? `@${brand.instagram_handle}` : ""

  const messages: CaptionChatMessage[] = [
    { role: "system", content: buildCaptionSystemPrompt(brand.vibe) },
    { role: "user", content: buildCaptionUserPrompt(brand, options) },
  ]

  // GPT-OSS reasoning tokens count against max_tokens. Measured live:
  // this exact caption task at reasoning_effort "medium" burned 1079 of
  // 1239 completion tokens (87%) on hidden reasoning — wildly wasteful
  // for short, punchy copywriting. "low" dropped that to 232/364 (64%,
  // but a much smaller absolute budget) with equally valid output, so
  // that's what's used here. max_tokens raised well past the old
  // Llama-era 400, which now 400s outright ("json_validate_failed") once
  // reasoning tokens are in play at all.
  const requestParams = {
    model,
    temperature: 0.8,
    reasoning_effort: "low" as const,
    max_tokens: 1200,
    response_format: { type: "json_object" as const },
  }

  const { caption, usage } = await generateValidatedCaption({
    messages,
    callModel: async (msgs) => {
      const res = await groq.chat.completions.create({ ...requestParams, messages: msgs })
      return { content: res.choices[0]?.message?.content ?? "{}", usage: res.usage ?? undefined }
    },
    brand,
    ctaPhrase,
    handle,
    platform: options.platform,
  })

  return { caption, model, usage }
}
