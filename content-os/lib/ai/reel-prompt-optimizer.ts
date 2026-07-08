import { MODELS, getGroqClient } from "./models"

function sanitizeJsonString(raw: string): string {
  return raw
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim()
}

export interface PromptSuggestions {
  suggestions: string[]
  enhancedPrompt: string
}

/**
 * Reviews a user's raw video-scene prompt and suggests concrete
 * improvements for Kling generation (motion cues, camera direction,
 * lighting) plus one enhanced rewrite. Purely advisory — this never
 * decides what actually gets sent to Kling; the caller (and ultimately the
 * user) chooses whether to keep their original prompt or opt into the
 * enhanced one. On any failure this falls back to the user's own prompt
 * with no suggestions rather than throwing, since it's an optional step,
 * not a hard dependency for generation.
 */
export async function suggestPromptImprovements(
  userPrompt: string,
  brandContext: { niche: string; tone_of_voice: string }
): Promise<PromptSuggestions> {
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
          content: `You are a video-generation prompt specialist for Kling AI, an AI video model. Given a user's short video-scene prompt, suggest specific improvements that make it more effective for Kling to execute -- explicit subject, action, camera movement, lighting -- without changing what the user is asking for. Never invent a different scene, add props, or change details the user didn't mention. Always respond with valid JSON only. No markdown, no explanation.`,
        },
        {
          role: "user",
          content: `Brand niche: ${brandContext.niche || "not specified"}
Brand tone of voice: ${brandContext.tone_of_voice || "not specified"}

User's video scene prompt: "${userPrompt}"

Give 2-3 short, specific suggestions for how to improve this prompt for AI video generation (e.g. adding a camera movement like "slow pan" or "zoom in", specifying lighting, being more explicit about the action). Then write one enhanced version of the SAME prompt that incorporates good practice -- explicit subject, action, camera, lighting -- while preserving the user's original creative intent exactly. Do not change what they're asking for, only make the same request more effective to execute.

Respond with this exact JSON:
{
  "suggestions": ["suggestion 1", "suggestion 2", "suggestion 3"],
  "enhancedPrompt": "the enhanced prompt text"
}`,
        },
      ],
    })

    const raw = res.choices[0]?.message?.content ?? "{}"
    let cleaned = sanitizeJsonString(raw)
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    if (jsonMatch) cleaned = jsonMatch[0]

    const parsed = JSON.parse(cleaned) as Partial<PromptSuggestions>

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
    console.error("[reel-prompt-optimizer] suggestion generation failed (non-fatal):", err instanceof Error ? err.message : err)
    return { suggestions: [], enhancedPrompt: userPrompt }
  }
}
