import OpenAI from "openai"
import type { BrandRow, ProductRow } from "@/types/database"
import type { GeneratedCaption, Platform } from "@/types/app"
import { buildCaptionSystemPrompt, buildCaptionUserPrompt } from "./prompts"
import { MODELS, NVIDIA_BASE_URL, getApiKey } from "./models"

export async function generateCaption(
  brand: BrandRow,
  options: {
    hookText?: string
    platform: Platform
    contentType: string
    additionalContext?: string
    product?: ProductRow | null
  }
): Promise<{ caption: GeneratedCaption; model: string; usage: OpenAI.Completions.CompletionUsage | undefined }> {
  const openai = new OpenAI({ apiKey: getApiKey(), baseURL: NVIDIA_BASE_URL })
  const model = MODELS.generation

  const response = await openai.chat.completions.create({
    model,
    temperature: 0.8,
    max_tokens: 1200,
    messages: [
      { role: "system", content: buildCaptionSystemPrompt() },
      { role: "user", content: buildCaptionUserPrompt(brand, options) },
    ],
  })

  const raw = response.choices[0]?.message?.content ?? "{}"
  let parsed: GeneratedCaption

  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error("AI returned invalid JSON for caption")
  }

  if (!parsed.caption_text) {
    throw new Error("AI response missing caption_text")
  }

  // Ensure character_count is accurate
  parsed.character_count = parsed.caption_text.length

  return { caption: parsed, model, usage: response.usage ?? undefined }
}
