import type { BrandRow, ProductRow } from "@/types/database"
import type { Platform } from "@/types/app"
import { buildCaptionSystemPrompt, buildCaptionUserPrompt } from "./prompts"
import { MODELS, getTextClientFor } from "./models"
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
  const model = MODELS.caption
  const openai = getTextClientFor(model)

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
      // Explicit timeout + one retry, like every other model call here --
      // this used to pass none, so the SDK default (10 minutes, 2
      // retries) applied: a slow caption could outlive the route's
      // maxDuration, Vercel killed the function, and the client got a
      // non-JSON error page. 40s is the same estimate the other
      // medium-length text calls use (not measured live).
      const res = await openai.chat.completions.create({ ...requestParams, messages: msgs }, { timeout: 40_000, maxRetries: 1 })
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
