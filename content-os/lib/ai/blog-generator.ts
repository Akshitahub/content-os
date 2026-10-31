import type { BrandRow, ProductRow } from "@/types/database"
import type { BlogPost } from "@/types/app"
import { buildBlogArticleSystemPrompt, buildBlogArticleUserPrompt } from "./prompts"
import { MODELS } from "./models"
import { createTextCompletion } from "./provider-fallback"
import { addTextUsage, sumCostUsd, textCostUsd, toTextUsage, type TextUsage } from "./pricing"
import { buildFactSource, guardCopy } from "./fact-guard"
import { findContentQualityIssues, sanitizeLeakedArtifacts } from "./content-quality-check"

function sanitizeJsonString(raw: string): string {
  return raw
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim()
}

// Blog (this dedicated tool) moved from Groq to OpenAI (MODELS.creative) as
// part of the Phase 1 creative-stages migration -- same API style as
// lib/ai/captions-generator.ts's earlier OpenAI migration, for consistency.
export async function generateBlogPost(
  brand: BrandRow,
  options: {
    userPrompt: string
    product?: ProductRow | null
    pastExamples?: string[]
    /** Target body word count (see buildBlogArticleUserPrompt) — also
     * drives max_completion_tokens below so the ceiling scales with what
     * was actually asked for, instead of a single fixed value regardless
     * of length. */
    wordLimit: number
  }
): Promise<{ post: BlogPost; model: string; usage: TextUsage | undefined; costUsd: number | null }> {
  const model = MODELS.creative

  // ~3 tokens/word gives headroom for the JSON wrapper (title,
  // meta_description, tags) plus the tokenizer's real word:token ratio for
  // English prose, PLUS hidden reasoning tokens that count against this
  // same budget on a reasoning model. Floored at 1800 so a short target
  // still has room to finish the JSON structure cleanly rather than
  // getting cut off mid-object. (The Groq-era comment this replaced had
  // measured reasoning overhead specifically for openai/gpt-oss-120b --
  // not re-measured yet for gpt-5.5, see scripts/test-creative-stages.ts.)
  const maxTokens = Math.max(1800, Math.round(options.wordLimit * 3))

  const startTime = Date.now()
  let first: Awaited<ReturnType<typeof createTextCompletion>>
  try {
    first = await createTextCompletion(
      {
        model,
        // Long-form -- "medium" (gpt-5.5's own default) per the migration
        // spec's "default for long-form blog/reel scripts" guidance.
        reasoning_effort: "medium",
        max_completion_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildBlogArticleSystemPrompt() },
          { role: "user", content: buildBlogArticleUserPrompt(brand, options) },
        ],
      },
      // ESTIMATE, not measured live (no working OPENAI_API_KEY in the
      // environment this was written in) -- see scripts/test-creative-stages.ts.
      // 45s: long-form generation with a scaling token budget, plus a
      // reasoning model is generally slower than Groq's LPU inference.
      { stage: "blog_post", timeout: 45_000, maxRetries: 1 }
    )
  } catch (err) {
    console.error(`[blog-generator] model=${model} stage=blog_post latencyMs=${Date.now() - startTime} success=false:`, err)
    throw err
  }
  const response = first.response
  // Priced at the model that answered (Groq, or OpenAI on a fallback).
  let answeredModel = first.model
  let costUsd = textCostUsd(first.model, toTextUsage(response.usage))
  console.log(`[blog-generator] provider=${first.provider} model=${first.model} stage=blog_post latencyMs=${Date.now() - startTime} success=true`)

  const raw = response.choices[0]?.message?.content ?? "{}"
  const parsed = parseBlogPost(raw)
  let usage = toTextUsage(response.usage)

  // Fact guard (lib/ai/fact-guard.ts): one corrective retry, then strip
  // whatever's still unsupported. Fail-soft -- never fails a post that
  // already generated.
  const post = await guardCopy({
    stage: "blog_post",
    data: parsed,
    facts: buildFactSource({ brand, product: options.product, brief: [options.userPrompt] }),
    normalTimeoutMs: 45_000,
    retry: async (correction, timeoutMs) => {
      const { response: retry, model: answered } = await createTextCompletion(
        {
          model,
          reasoning_effort: "medium",
          max_completion_tokens: maxTokens,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: buildBlogArticleSystemPrompt() },
            { role: "user", content: buildBlogArticleUserPrompt(brand, options) },
            { role: "assistant", content: raw },
            { role: "user", content: correction },
          ],
        },
        { stage: "blog_post", timeout: timeoutMs, maxRetries: 1 }
      )
      answeredModel = answered
      costUsd = sumCostUsd(costUsd, textCostUsd(answered, toTextUsage(retry.usage)))
      usage = addTextUsage(usage, toTextUsage(retry.usage))
      return parseBlogPost(retry.choices[0]?.message?.content ?? "{}")
    },
  })

  return { post, model: answeredModel, usage, costUsd }
}

// Parse + validate + artifact clean-up, shared by the first call and the
// fact guard's retry.
function parseBlogPost(raw: string): BlogPost {
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

  // Lightweight sanity pass -- see lib/ai/content-quality-check.ts.
  // Mechanical fix-in-place rather than a second Groq call: a full 800+
  // word article is expensive to regenerate over one stray artifact.
  for (const field of ["title", "body"] as const) {
    const value = parsed[field]
    if (findContentQualityIssues(value).length > 0) {
      const cleaned = sanitizeLeakedArtifacts(value)
      console.error(`[blog-generator] stripped leaked artifact(s) from generated ${field}: ${JSON.stringify(value)} -> ${JSON.stringify(cleaned)}`)
      parsed[field] = cleaned
    }
  }

  return parsed
}
