import type { BrandRow } from "@/types/database"
import { findContentQualityIssues, sanitizeLeakedArtifacts } from "./content-quality-check"
import { createCreativeCompletion } from "./creative-completion"
import { UsageCarryingError, addTextUsage, sumCostUsd, type TextUsage } from "./pricing"
import { buildFactSource, guardCopy } from "./fact-guard"

// Occasion-content prompt + model call + parse, moved verbatim out of
// app/api/v1/brands/[brandId]/generate-occasion-content/route.ts during the
// Phase 1b Groq -> OpenAI migration so scripts/test-creative-stages.ts can
// exercise the real prompt (a Next.js route file can't export non-route
// helpers). The empty-output check and persistence stay in the route.

export type OccasionContent = {
  hook: string
  caption: string
  hashtags: string[]
  visual_direction: string
}

function sanitizeJsonString(raw: string): string {
  return raw
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim()
}

/**
 * One OpenAI call. Throws on provider error/timeout AND on unparseable
 * JSON, exactly as the route's single try block did on Groq -- the route
 * catches both into the same "Failed to generate content" 500 (unparseable
 * JSON throws a UsageCarryingError, since that call was still billed).
 */
export async function generateOccasionContent(
  brand: BrandRow,
  occasionName: string,
  occasionAngle: string
): Promise<{ content: OccasionContent; model: string; usage: TextUsage | undefined; costUsd: number | null }> {
  const callParams = {
    stage: "occasion_content",
    logPrefix: "generate-occasion-content",
    system: "You are an expert social media content creator for Indian D2C brands. Respond with valid JSON only. No markdown.",
    user: `Generate a complete social media post for ${brand.name} for ${occasionName}.
Brand niche: ${brand.niche ?? "D2C brand"}
Brand voice: ${brand.ai_persona ?? brand.tone_of_voice ?? "friendly and authentic"}
Content angle: ${occasionAngle}

Return this exact JSON:
{"hook":"attention-grabbing opening line","caption":"full post caption 2-4 sentences in brand voice","hashtags":["hashtag1","hashtag2","hashtag3","hashtag4","hashtag5"],"visual_direction":"describe the ideal image/video for this post"}`,
    // Short structured output (hook + caption + hashtags +
    // visual_direction), same scale as hooks/captions -- "low", same
    // effort and budget as on Groq.
    reasoningEffort: "low" as const,
    maxCompletionTokens: 1200,
    // ESTIMATE, not measured (no OPENAI_API_KEY where this was written) --
    // see scripts/test-creative-stages.ts. Revisit against real latency.
    timeoutMs: 30_000,
  }
  const first = await createCreativeCompletion(callParams)
  let usage = first.usage
  let costUsd = first.costUsd
  const raw = first.content ?? "{}"
  let parsed: OccasionContent
  try {
    parsed = parseOccasionContent(raw)
  } catch {
    throw new UsageCarryingError("AI returned invalid JSON", usage, costUsd)
  }

  // Fact guard (lib/ai/fact-guard.ts): one corrective retry, then strip.
  // Fail-soft -- never fails content that already generated.
  const guarded = await guardCopy({
    stage: "occasion_content",
    data: parsed,
    facts: buildFactSource({ brand, brief: [occasionName, occasionAngle] }),
    normalTimeoutMs: callParams.timeoutMs,
    retry: async (correction, timeoutMs) => {
      const retry = await createCreativeCompletion({ ...callParams, timeoutMs, followUp: { previous: raw, correction } })
      usage = addTextUsage(usage, retry.usage)
      costUsd = sumCostUsd(costUsd, retry.costUsd)
      return parseOccasionContent(retry.content ?? "{}")
    },
  })

  return { content: guarded, model: first.model, usage, costUsd }
}

// Parse + artifact clean-up, shared by the first call and the fact
// guard's retry. Throws on unparseable JSON.
function parseOccasionContent(raw: string): OccasionContent {
  const aiParsed = JSON.parse(sanitizeJsonString(raw)) as {
    hook?: string
    caption?: string
    hashtags?: string[]
    visual_direction?: string
  }

  // Lightweight sanity pass -- see lib/ai/content-quality-check.ts for
  // what this catches (leaked "✓"/"✗" formatting markers, unfilled
  // "[Placeholder]" brackets, raw template expressions, a stray
  // unattached "x"). Mechanical fix-in-place, same reasoning as every
  // other generator in this codebase's identical helper.
  const fix = (value: string, label: string): string => {
    if (!value || findContentQualityIssues(value).length === 0) return value
    const cleaned = sanitizeLeakedArtifacts(value)
    console.error(`[generate-occasion-content] stripped leaked artifact(s) from generated ${label}: ${JSON.stringify(value)} -> ${JSON.stringify(cleaned)}`)
    return cleaned
  }

  return {
    hook: fix(aiParsed.hook ?? "", "hook"),
    caption: fix(aiParsed.caption ?? "", "caption"),
    hashtags: Array.isArray(aiParsed.hashtags) ? aiParsed.hashtags : [],
    visual_direction: aiParsed.visual_direction ?? "",
  }
}
