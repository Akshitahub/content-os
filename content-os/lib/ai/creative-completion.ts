import { MODELS } from "./models"
import { createTextCompletion } from "./provider-fallback"
import { textCostUsd, toTextUsage, type TextUsage } from "./pricing"

// Shared OpenAI call for the Phase 1b creative-stages migration (story,
// carousel, repurpose, occasion-content, Autopilot) -- same API style as
// the Phase 1 call sites (lib/ai/hooks-generator.ts, content-generator.ts):
// max_completion_tokens instead of the deprecated max_tokens (gpt-5.5 is a
// reasoning model, hidden reasoning tokens count against it), no
// `temperature` (not verified live that this reasoning model accepts a
// non-default one), JSON mode, an explicit per-call timeout and
// maxRetries: 1. Exists only so those 8 new call sites share one
// provider/model/stage/latency/success log line instead of each
// duplicating it; the Phase 1 call sites are deliberately left as they are.
//
// JSON mode is json_object, not json_schema structured outputs: none of
// these stages has a zod OUTPUT schema to derive one from (every zod
// schema in this codebase validates request input), and strict
// json_schema would also force every currently-optional field (poll_options,
// checklist_*, scenes, slides...) to become required -- a real behavior
// change, not a provider swap. Each caller keeps its existing
// parse/validate/fallback logic unchanged.
export type CreativeCompletionParams = {
  /** Log label, e.g. "story" or "autopilot_slot". */
  stage: string
  /** Log prefix of the calling module, e.g. "ai/stories/generate". */
  logPrefix: string
  system: string
  user: string
  /** Optional correction turn (e.g. lib/ai/fact-guard.ts's retry): the
   * model's own previous answer plus what to fix in it, appended after
   * `user` -- same shape caption-validation.ts's retry already uses. */
  followUp?: { previous: string; correction: string }
  reasoningEffort: "low" | "medium" | "high"
  maxCompletionTokens: number
  timeoutMs: number
}

// `content` is null (not a default) when the model returned nothing, so
// each caller keeps applying the exact empty-response default it already
// used ("{}" in most, "" in Autopilot's regex-fallback path). `costUsd` is
// priced from this call's real usage (lib/ai/pricing.ts) for
// ai_generation_logs.cost_usd.
export async function createCreativeCompletion(params: CreativeCompletionParams): Promise<{
  content: string | null
  model: string
  usage: TextUsage | undefined
  costUsd: number | null
}> {
  const model = MODELS.creative
  const startTime = Date.now()
  try {
    // Groq first; the same request on OpenAI when Groq can't serve it
    // (lib/ai/provider-fallback.ts) -- priced and logged with the model
    // that actually answered.
    const { response, model: usedModel, provider } = await createTextCompletion(
      {
        model,
        reasoning_effort: params.reasoningEffort,
        max_completion_tokens: params.maxCompletionTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: params.system },
          { role: "user", content: params.user },
          ...(params.followUp
            ? [
                { role: "assistant" as const, content: params.followUp.previous },
                { role: "user" as const, content: params.followUp.correction },
              ]
            : []),
        ],
      },
      { stage: params.stage, timeout: params.timeoutMs, maxRetries: 1 }
    )
    const usage = toTextUsage(response.usage)
    const costUsd = textCostUsd(usedModel, usage)
    console.log(`[${params.logPrefix}] provider=${provider} model=${usedModel} stage=${params.stage} latencyMs=${Date.now() - startTime} costUsd=${costUsd ?? "unknown"} success=true`)
    return { content: response.choices[0]?.message?.content ?? null, model: usedModel, usage, costUsd }
  } catch (err) {
    console.error(`[${params.logPrefix}] model=${model} stage=${params.stage} latencyMs=${Date.now() - startTime} success=false:`, err)
    throw err
  }
}
