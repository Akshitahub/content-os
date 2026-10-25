import type { BrandRow } from "@/types/database"
import type { RepurposedContent } from "@/app/api/v1/ai/repurpose/route"
import { createCreativeCompletion } from "./creative-completion"
import { buildFactSource, guardCopy } from "./fact-guard"
import { MODELS } from "./models"
import { addTextUsage, sumCostUsd, type TextUsage } from "./pricing"

// Repurpose prompt building + the model call, moved verbatim out of
// app/api/v1/ai/repurpose/route.ts during the Phase 1b Groq -> OpenAI
// migration so scripts/test-creative-stages.ts can exercise the real
// prompt (a Next.js route file can't export non-route helpers). Credits,
// refunds and the shape check stay in the route.

function extractJSON(raw: string): string {
  let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").replace(/[\x00-\x1F\x7F]/g, " ").trim()
  const firstBrace = cleaned.indexOf("{")
  const lastBrace = cleaned.lastIndexOf("}")
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1)
  }
  return cleaned
}

function buildRepurposePrompt(content: string, brand: BrandRow): string {
  const brandCtx = [
    `Brand: ${brand.name}`,
    brand.niche ? `Niche: ${brand.niche}` : null,
    brand.tone_of_voice ? `Tone: ${brand.tone_of_voice}` : null,
    brand.instagram_handle ? `Handle: @${brand.instagram_handle}` : null,
  ].filter(Boolean).join("\n")

  return `${brandCtx}

ORIGINAL CONTENT:
${content}

Repurpose this content into multiple social media formats for the brand above.

RULES:
- hooks: max 8 words each, no product/brand name, stop-scroll energy
- tweets: max 280 characters each, punchy
- carousel_ideas: each slide is one key point (5-7 words max)
- reel_scripts: each scene is a visual instruction + text overlay
- linkedin: professional storytelling, 200-400 words, ends with a question

Respond with ONLY this JSON:
{
  "hooks": ["hook 1", "hook 2", "hook 3", "hook 4", "hook 5"],
  "carousel_ideas": [
    { "title": "carousel title", "slides": ["Slide 1 point", "Slide 2 point", "Slide 3 point", "Slide 4 point", "Save this!"] },
    { "title": "carousel title 2", "slides": ["Slide 1 point", "Slide 2 point", "Slide 3 point", "Slide 4 point", "Follow for more!"] },
    { "title": "carousel title 3", "slides": ["Slide 1 point", "Slide 2 point", "Slide 3 point", "Slide 4 point", "DM us to learn more!"] }
  ],
  "reel_scripts": [
    { "hook": "opening hook line", "scenes": ["Scene 1: visual | audio/text", "Scene 2: visual | audio/text", "Scene 3: CTA | text overlay"] },
    { "hook": "opening hook line 2", "scenes": ["Scene 1: visual | audio/text", "Scene 2: visual | audio/text", "Scene 3: CTA | text overlay"] }
  ],
  "tweets": ["tweet 1 under 280 chars", "tweet 2", "tweet 3", "tweet 4", "tweet 5"],
  "linkedin": "full LinkedIn post 200-400 words"
}`
}

const REPURPOSE_SYSTEM_PROMPTS = [
  "You are an expert content repurposer for Indian D2C brands. You transform any content into multiple platform-native formats. Always respond with valid JSON only. No markdown, no explanation.",
  "You are an expert content repurposer for Indian D2C brands. CRITICAL: Respond with ONLY valid JSON. No markdown code fences, no explanation text before or after. The response must be parseable by JSON.parse() directly.",
] as const

/**
 * One OpenAI call producing every repurposed format in a single JSON blob,
 * retried once (with the stricter second system prompt, same as on Groq)
 * only if the response isn't parseable JSON. `result` is null when both
 * attempts were unparseable -- the route refunds and returns its existing
 * "invalid JSON" error for that (usage/cost still reported, since both
 * calls were billed). Throws on provider error/timeout so the route's
 * existing refund-and-500 path handles it unchanged.
 */
export async function generateRepurposedContent(content: string, brand: BrandRow): Promise<{
  result: RepurposedContent | null
  model: string
  usage: TextUsage | undefined
  costUsd: number | null
}> {
  let lastRaw = ""
  let usage: TextUsage | undefined
  let costUsd: number | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await createCreativeCompletion({
      stage: "repurpose",
      logPrefix: "ai/repurpose",
      system: REPURPOSE_SYSTEM_PROMPTS[attempt]!,
      user: buildRepurposePrompt(content, brand),
      // The widest single output of any generation surface -- 5 hooks, 3
      // carousel outlines, 2 reel scripts, 5 tweets and a 200-400 word
      // LinkedIn post in one JSON blob -- same "medium" and budget as on
      // Groq (reasoning tokens count against it on gpt-5.5 too).
      reasoningEffort: "medium",
      maxCompletionTokens: 4500,
      // ESTIMATE, not measured (no OPENAI_API_KEY where this was written) --
      // see scripts/test-creative-stages.ts. Revisit against real latency.
      timeoutMs: 60_000,
    })
    usage = addTextUsage(usage, result.usage)
    costUsd = sumCostUsd(costUsd, result.costUsd)
    const raw = result.content ?? "{}"
    lastRaw = raw
    let parsed: RepurposedContent
    try {
      parsed = JSON.parse(extractJSON(raw)) as RepurposedContent
    } catch {
      if (attempt === 1) {
        console.error("[ai/repurpose] JSON parse failed after retry. Raw:", lastRaw.slice(0, 500))
      }
      continue
    }

    // Fact guard (lib/ai/fact-guard.ts): numbers from the user's own source
    // content count as facts. One corrective retry, then strip. Fail-soft.
    const guarded = await guardCopy({
      stage: "repurpose",
      data: parsed,
      facts: buildFactSource({ brand, brief: [content] }),
      normalTimeoutMs: 60_000,
      retry: async (correction, timeoutMs) => {
        const retry = await createCreativeCompletion({
          stage: "repurpose",
          logPrefix: "ai/repurpose",
          system: REPURPOSE_SYSTEM_PROMPTS[0],
          user: buildRepurposePrompt(content, brand),
          followUp: { previous: raw, correction },
          reasoningEffort: "medium",
          maxCompletionTokens: 4500,
          timeoutMs,
        })
        usage = addTextUsage(usage, retry.usage)
        costUsd = sumCostUsd(costUsd, retry.costUsd)
        const retryParsed = JSON.parse(extractJSON(retry.content ?? "")) as RepurposedContent
        if (!Array.isArray(retryParsed?.hooks)) throw new Error("malformed retry")
        return retryParsed
      },
    })
    return { result: guarded, model: result.model, usage, costUsd }
  }
  return { result: null, model: MODELS.creative, usage, costUsd }
}
