import { MODELS, getOpenAIClient } from "./models"

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
  reasoningEffort: "low" | "medium" | "high"
  maxCompletionTokens: number
  timeoutMs: number
}

// `content` is null (not a default) when the model returned nothing, so
// each caller keeps applying the exact empty-response default it already
// used ("{}" in most, "" in Autopilot's regex-fallback path).
export async function createCreativeCompletion(params: CreativeCompletionParams): Promise<{
  content: string | null
  model: string
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined
}> {
  const model = MODELS.creative
  const startTime = Date.now()
  try {
    // Inside the try so a missing OPENAI_API_KEY is logged as a failed
    // call too, not just thrown past the log line.
    const openai = getOpenAIClient()
    const response = await openai.chat.completions.create(
      {
        model,
        reasoning_effort: params.reasoningEffort,
        max_completion_tokens: params.maxCompletionTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: params.system },
          { role: "user", content: params.user },
        ],
      },
      { timeout: params.timeoutMs, maxRetries: 1 }
    )
    console.log(`[${params.logPrefix}] provider=openai model=${model} stage=${params.stage} latencyMs=${Date.now() - startTime} success=true`)
    return { content: response.choices[0]?.message?.content ?? null, model, usage: response.usage ?? undefined }
  } catch (err) {
    console.error(`[${params.logPrefix}] provider=openai model=${model} stage=${params.stage} latencyMs=${Date.now() - startTime} success=false:`, err)
    throw err
  }
}
