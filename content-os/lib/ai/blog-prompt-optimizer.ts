import { MODELS, getGroqClient } from "./models"

function sanitizeJsonString(raw: string): string {
  return raw
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim()
}

export interface BlogPromptSuggestions {
  suggestions: string[]
  enhancedPrompt: string
}

/**
 * Reviews a user's raw blog topic/prompt and suggests concrete improvements
 * for generating a stronger SEO article (angle, specificity, target
 * reader) plus one enhanced rewrite. Purely advisory — mirrors
 * lib/ai/reel-prompt-optimizer.ts exactly. This never decides what
 * actually gets sent to the blog generator; the caller (and ultimately the
 * user) chooses whether to keep their original topic or opt into the
 * enhanced one. On any failure this falls back to the user's own prompt
 * with no suggestions rather than throwing, since it's an optional step,
 * not a hard dependency for generation.
 */
export async function suggestBlogPromptImprovements(
  userPrompt: string,
  brandContext: { niche: string; tone_of_voice: string }
): Promise<BlogPromptSuggestions> {
  try {
    const groq = getGroqClient()

    const res = await groq.chat.completions.create({
      model: MODELS.generation,
      temperature: 0.6,
      max_tokens: 500,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are an SEO content strategist. Given a user's short blog topic/prompt, suggest specific improvements that make it more effective for generating a strong, rankable article -- a clearer angle, more specificity, a named target reader or use-case -- without changing what the user is actually asking to write about. Never invent a different topic or add claims the user didn't mention. Always respond with valid JSON only. No markdown, no explanation.`,
        },
        {
          role: "user",
          content: `Brand niche: ${brandContext.niche || "not specified"}
Brand tone of voice: ${brandContext.tone_of_voice || "not specified"}

User's blog topic/prompt: "${userPrompt}"

Give 2-3 short, specific suggestions for how to sharpen this topic for a better SEO article (e.g. narrowing to a specific angle, naming the target reader, adding a concrete use-case or comparison to structure the piece around). Then write one enhanced version of the SAME topic that incorporates good practice -- clearer angle, more specificity -- while preserving the user's original creative intent exactly. Do not change what they're asking to write about, only make the same request more effective to execute.

Respond with this exact JSON:
{
  "suggestions": ["suggestion 1", "suggestion 2", "suggestion 3"],
  "enhancedPrompt": "the enhanced topic/prompt text"
}`,
        },
      ],
    })

    const raw = res.choices[0]?.message?.content ?? "{}"
    let cleaned = sanitizeJsonString(raw)
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    if (jsonMatch) cleaned = jsonMatch[0]

    const parsed = JSON.parse(cleaned) as Partial<BlogPromptSuggestions>

    return {
      suggestions: Array.isArray(parsed.suggestions)
        ? parsed.suggestions.filter((s): s is string => typeof s === "string").slice(0, 3)
        : [],
      enhancedPrompt:
        typeof parsed.enhancedPrompt === "string" && parsed.enhancedPrompt.trim()
          ? parsed.enhancedPrompt
          : userPrompt,
    }
  } catch (err) {
    console.error("[blog-prompt-optimizer] suggestion generation failed (non-fatal):", err instanceof Error ? err.message : err)
    return { suggestions: [], enhancedPrompt: userPrompt }
  }
}
