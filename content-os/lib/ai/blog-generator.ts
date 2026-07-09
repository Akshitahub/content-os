import type { BrandRow, ProductRow } from "@/types/database"
import type { BlogPost } from "@/types/app"
import { buildBlogArticleSystemPrompt, buildBlogArticleUserPrompt } from "./prompts"
import { MODELS, getGroqClient } from "./models"

function sanitizeJsonString(raw: string): string {
  return raw
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim()
}

export async function generateBlogPost(
  brand: BrandRow,
  options: {
    userPrompt: string
    product?: ProductRow | null
    pastExamples?: string[]
  }
): Promise<{ post: BlogPost; model: string; usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined }> {
  const groq = getGroqClient()
  const model = MODELS.generation

  const response = await groq.chat.completions.create({
    model,
    temperature: 0.75,
    max_tokens: 2000,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildBlogArticleSystemPrompt() },
      { role: "user", content: buildBlogArticleUserPrompt(brand, options) },
    ],
  })

  const raw = response.choices[0]?.message?.content ?? "{}"
  let cleaned = sanitizeJsonString(raw)
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (jsonMatch) cleaned = jsonMatch[0]

  let parsed: BlogPost
  try {
    parsed = JSON.parse(cleaned) as BlogPost
  } catch {
    console.error("[blog-generator] JSON parse failed. Raw:", raw.slice(0, 500))
    throw new Error("AI returned invalid JSON for blog post")
  }

  if (!parsed.title || !parsed.body) {
    throw new Error("AI response missing title or body")
  }

  if (!Array.isArray(parsed.suggested_tags)) {
    parsed.suggested_tags = []
  }

  return { post: parsed, model, usage: response.usage ?? undefined }
}
