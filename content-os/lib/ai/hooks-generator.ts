import OpenAI from "openai"
import type { BrandRow, ProductRow } from "@/types/database"
import type { GeneratedHook, HookType, Platform } from "@/types/app"
import { buildHookSystemPrompt, buildHookUserPrompt } from "./prompts"
import { MODELS, NVIDIA_BASE_URL, getApiKey } from "./models"

export async function generateHooks(
  brand: BrandRow,
  options: {
    hookTypes?: HookType[]
    count?: number
    platform?: Platform
    additionalContext?: string
    product?: ProductRow | null
  }
): Promise<{ hooks: GeneratedHook[]; model: string; usage: OpenAI.Completions.CompletionUsage | undefined }> {
  const openai = new OpenAI({ apiKey: getApiKey(), baseURL: NVIDIA_BASE_URL })

  const hookTypes = options.hookTypes?.length
    ? options.hookTypes
    : (["question", "bold_statement", "story", "statistic", "controversial", "how_to"] as HookType[])

  const count = options.count ?? 5
  const model = MODELS.generation

  const response = await openai.chat.completions.create({
    model,
    temperature: 0.85,
    max_tokens: 1500,
    messages: [
      { role: "system", content: buildHookSystemPrompt() },
      { role: "user", content: buildHookUserPrompt(brand, { hookTypes, count, platform: options.platform, additionalContext: options.additionalContext, product: options.product }) },
    ],
  })

  const raw = response.choices[0]?.message?.content ?? "{}"
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
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
