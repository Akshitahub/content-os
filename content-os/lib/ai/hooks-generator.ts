import type { BrandRow, ProductRow } from "@/types/database"
import type { GeneratedHook, HookType, Platform } from "@/types/app"
import { buildHookSystemPrompt, buildHookUserPrompt } from "./prompts"
import { MODELS, getGroqClient } from "./models"

export async function generateHooks(
  brand: BrandRow,
  options: {
    hookTypes?: HookType[]
    count?: number
    platform?: Platform
    additionalContext?: string
    product?: ProductRow | null
  }
): Promise<{ hooks: GeneratedHook[]; model: string; usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined }> {
  const groq = getGroqClient()

  const hookTypes = options.hookTypes?.length
    ? options.hookTypes
    : (["question", "bold_statement", "story", "statistic", "controversial", "how_to"] as HookType[])

  const count = options.count ?? 3
  const model = MODELS.generation

  const response = await groq.chat.completions.create({
    model,
    temperature: 0.85,
    max_tokens: 600,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildHookSystemPrompt() },
      { role: "user", content: buildHookUserPrompt(brand, { hookTypes, count, platform: options.platform, additionalContext: options.additionalContext, product: options.product }) },
    ],
  })

  const raw = response.choices[0]?.message?.content ?? "{}"
  let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").replace(/[\x00-\x1F\x7F]/g, " ").trim()
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (jsonMatch) cleaned = jsonMatch[0]
  let parsed: { hooks: GeneratedHook[] }

  try {
    parsed = JSON.parse(cleaned)
  } catch {
    console.error("[hooks-generator] JSON parse failed. Raw:", raw.slice(0, 500))
    throw new Error("AI returned invalid JSON for hooks")
  }

  if (!Array.isArray(parsed.hooks)) {
    throw new Error("AI response missing hooks array")
  }

  return { hooks: parsed.hooks, model, usage: response.usage ?? undefined }
}
