import type { BrandRow, ProductRow } from "@/types/database"
import type { GeneratedCaption, Platform } from "@/types/app"
import { buildCaptionSystemPrompt, buildCaptionUserPrompt } from "./prompts"
import { MODELS, getGroqClient } from "./models"

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
): Promise<{ caption: GeneratedCaption; model: string; usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined }> {
  const groq = getGroqClient()
  const model = MODELS.generation

  const response = await groq.chat.completions.create({
    model,
    temperature: 0.8,
    // GPT-OSS reasoning tokens count against max_tokens. Measured live:
    // this exact caption task at reasoning_effort "medium" burned 1079 of
    // 1239 completion tokens (87%) on hidden reasoning — wildly wasteful
    // for short, punchy copywriting. "low" dropped that to 232/364 (64%,
    // but a much smaller absolute budget) with equally valid output, so
    // that's what's used here. max_tokens raised well past the old
    // Llama-era 400, which now 400s outright ("json_validate_failed") once
    // reasoning tokens are in play at all.
    reasoning_effort: "low",
    max_tokens: 1200,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildCaptionSystemPrompt() },
      { role: "user", content: buildCaptionUserPrompt(brand, options) },
    ],
  })

  const raw = response.choices[0]?.message?.content ?? "{}"
  let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").replace(/[\x00-\x1F\x7F]/g, " ").trim()
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (jsonMatch) cleaned = jsonMatch[0]
  let parsed: GeneratedCaption

  try {
    parsed = JSON.parse(cleaned)
  } catch {
    console.error("[captions-generator] JSON parse failed. Raw:", raw.slice(0, 500))
    throw new Error("AI returned invalid JSON for caption")
  }

  if (!parsed.caption_text) {
    throw new Error("AI response missing caption_text")
  }

  parsed.character_count = parsed.caption_text.length

  return { caption: parsed, model, usage: response.usage ?? undefined }
}
