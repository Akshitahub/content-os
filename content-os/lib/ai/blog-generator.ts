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
    /** Target body word count (see buildBlogArticleUserPrompt) — also
     * drives max_tokens below so the ceiling scales with what was actually
     * asked for, instead of a single fixed value regardless of length. */
    wordLimit: number
  }
): Promise<{ post: BlogPost; model: string; usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined }> {
  const groq = getGroqClient()
  const model = MODELS.generation

  // ~3 tokens/word gives headroom for the JSON wrapper (title,
  // meta_description, tags) plus the tokenizer's real word:token ratio for
  // English prose, PLUS hidden GPT-OSS reasoning tokens that count against
  // this same budget. Measured live: an 800-word blog target at
  // reasoning_effort "medium" consumed 1320 total tokens (273 of them
  // reasoning, ~21% overhead) — moderate and worth paying for real long-form
  // reasoning quality. Floored at 1800 so a short target still has room to
  // finish the JSON structure cleanly rather than getting cut off mid-object.
  const maxTokens = Math.max(1800, Math.round(options.wordLimit * 3))

  const response = await groq.chat.completions.create({
    model,
    temperature: 0.75,
    reasoning_effort: "medium",
    max_tokens: maxTokens,
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
