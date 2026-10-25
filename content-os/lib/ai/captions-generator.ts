import type { BrandRow, ProductRow } from "@/types/database"
import type { Platform } from "@/types/app"
import { buildCaptionSystemPrompt, buildCaptionUserPrompt } from "./prompts"
import { MODELS, getOpenAIClient } from "./models"
import { generateValidatedCaption, type CaptionChatMessage } from "./caption-validation"
import { buildFactSource } from "./fact-guard"
import { textCostUsd, toTextUsage, type TextUsage } from "./pricing"

// Captions moved from Groq to OpenAI (MODELS.caption) -- every other
// caption-producing call site (lib/ai/content-generator.ts's social_post
// case) still shares generateValidatedCaption's provider-agnostic
// call/validate/retry loop via the same `callModel` injection, so this is
// the only file that actually talks to a model for captions.
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
): Promise<{ caption: import("@/types/app").GeneratedCaption; model: string; usage: TextUsage | undefined; costUsd: number | null }> {
  const openai = getOpenAIClient()
  const model = MODELS.caption

  const b = brand as BrandRow & { cta_phrase?: string | null }
  const ctaPhrase = b.cta_phrase || "Shop now"
  const handle = brand.instagram_handle ? `@${brand.instagram_handle}` : ""

  const messages: CaptionChatMessage[] = [
    { role: "system", content: buildCaptionSystemPrompt(brand.vibe) },
    { role: "user", content: buildCaptionUserPrompt(brand, options) },
  ]

  // Same reasoning-effort budgeting concern as the old Groq call (reasoning
  // tokens count against the completion budget for a reasoning-class
  // model) -- "low" is plenty for short, punchy copywriting, no need for
  // deeper reasoning here. max_completion_tokens (not the deprecated
  // max_tokens) since gpt-5.5-class models are reasoning models.
  // `temperature` deliberately omitted -- not verified live whether this
  // reasoning model accepts a non-default sampling temperature the way
  // Groq's gpt-oss models did; left at the model's own default rather than
  // guessing and risking a rejected request.
  const requestParams = {
    model,
    reasoning_effort: "low" as const,
    max_completion_tokens: 1200,
    response_format: { type: "json_object" as const },
  }

  const { caption, usage } = await generateValidatedCaption({
    messages,
    callModel: async (msgs) => {
      const res = await openai.chat.completions.create({ ...requestParams, messages: msgs })
      return { content: res.choices[0]?.message?.content ?? "{}", usage: toTextUsage(res.usage) }
    },
    brand,
    ctaPhrase,
    handle,
    platform: options.platform,
    facts: buildFactSource({ brand, product: options.product, brief: [options.hookText, options.additionalContext] }),
  })

  return { caption, model, usage, costUsd: textCostUsd(model, usage) }
}
