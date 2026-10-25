import type { BrandRow, ProductRow } from "@/types/database"
import type { GeneratedHook, HookType, Platform } from "@/types/app"
import { buildHookSystemPrompt, buildHookUserPrompt } from "./prompts"
import { MODELS, getOpenAIClient } from "./models"
import { findContentQualityIssues, sanitizeLeakedArtifacts } from "./content-quality-check"
import { buildFactCorrection, buildFactSource, findUnsupportedClaims, logFactGuard, stripUnsupportedClaims } from "./fact-guard"
import { addTextUsage, textCostUsd, toTextUsage, type TextUsage } from "./pricing"
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions"

// Hooks moved from Groq to OpenAI (MODELS.creative) as part of the Phase 1
// creative-stages migration -- same API style as lib/ai/captions-generator.ts's
// earlier OpenAI migration, for consistency.
export async function generateHooks(
  brand: BrandRow,
  options: {
    hookTypes?: HookType[]
    count?: number
    platform?: Platform
    additionalContext?: string
    product?: ProductRow | null
  }
): Promise<{ hooks: GeneratedHook[]; model: string; usage: TextUsage | undefined; costUsd: number | null }> {
  const openai = getOpenAIClient()

  const hookTypes = options.hookTypes?.length
    ? options.hookTypes
    : (["question", "bold_statement", "story", "statistic", "controversial", "how_to"] as HookType[])

  const count = options.count ?? 3
  const model = MODELS.creative

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: buildHookSystemPrompt() },
    { role: "user", content: buildHookUserPrompt(brand, { hookTypes, count, platform: options.platform, additionalContext: options.additionalContext, product: options.product }) },
  ]
  const callModel = async (msgs: ChatCompletionMessageParam[]): Promise<{ raw: string; usage: TextUsage | undefined }> => {
    const startTime = Date.now()
    let response: Awaited<ReturnType<typeof openai.chat.completions.create>>
    try {
      response = await openai.chat.completions.create(
        {
          model,
          // Speed matters here (a short brainstorming list, same reasoning
          // this stage already used on Groq) -- "low" per the migration spec.
          reasoning_effort: "low",
          // max_completion_tokens (not the deprecated max_tokens) since
          // gpt-5.5-class models are reasoning models, same convention as
          // lib/ai/captions-generator.ts. `temperature` deliberately omitted,
          // same reasoning as that file: not verified live whether this
          // reasoning model accepts a non-default sampling temperature.
          max_completion_tokens: 1000,
          response_format: { type: "json_object" },
          messages: msgs,
        },
        // ESTIMATE, not measured live (no working OPENAI_API_KEY in the
        // environment this was written in) -- see scripts/test-creative-stages.ts
        // for the real measurement. 20s is generous headroom over a short,
        // low-effort JSON completion; revisit once real latency data exists.
        { timeout: 20_000, maxRetries: 1 }
      )
    } catch (err) {
      console.error(`[hooks-generator] provider=openai model=${model} stage=hooks latencyMs=${Date.now() - startTime} success=false:`, err)
      throw err
    }
    console.log(`[hooks-generator] provider=openai model=${model} stage=hooks latencyMs=${Date.now() - startTime} success=true`)
    return { raw: response.choices[0]?.message?.content ?? "{}", usage: toTextUsage(response.usage) }
  }

  const first = await callModel(messages)
  let usage = first.usage
  let hooks = parseHooks(first.raw)

  // Fact guard (lib/ai/fact-guard.ts): a hook using a number that isn't in
  // the brand/product facts or the brief gets one corrective retry; if the
  // retry fails or still has one, the offending part is stripped. Hooks
  // that strip down to nothing are dropped rather than shipped empty --
  // unless that would leave no hooks at all, in which case the stripped
  // set is kept (fail-soft, same as every other path here).
  const facts = buildFactSource({ brand, product: options.product, brief: [options.additionalContext] })
  const claims = hooks.flatMap((h) => findUnsupportedClaims(h.hook_text ?? "", facts))
  if (claims.length > 0) {
    logFactGuard("hooks", "retry", claims.length)
    try {
      const retry = await callModel([...messages, { role: "assistant", content: first.raw }, { role: "user", content: buildFactCorrection(claims) }])
      usage = addTextUsage(usage, retry.usage)
      hooks = parseHooks(retry.raw)
    } catch (err) {
      console.error("[hooks-generator] fact-guard retry failed, stripping instead:", err instanceof Error ? err.message : err)
    }
    const remaining = hooks.flatMap((h) => findUnsupportedClaims(h.hook_text ?? "", facts))
    if (remaining.length > 0) {
      logFactGuard("hooks", "strip", remaining.length)
      const stripped = hooks.map((h) => ({ ...h, hook_text: stripUnsupportedClaims(h.hook_text ?? "", facts) }))
      const nonEmpty = stripped.filter((h) => h.hook_text)
      hooks = nonEmpty.length > 0 ? nonEmpty : stripped
    }
  }

  return { hooks, model, usage, costUsd: textCostUsd(model, usage) }
}

function parseHooks(raw: string): GeneratedHook[] {
  let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").replace(/[\x00-\x1F\x7F]/g, " ").trim()
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (jsonMatch) cleaned = jsonMatch[0]
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

  // Lightweight sanity pass -- see lib/ai/content-quality-check.ts for what
  // this catches (leaked "✓"/"✗" formatting markers, unfilled
  // "[Placeholder]" brackets, raw template expressions, a stray unattached
  // "x"). Mechanical fix-in-place rather than re-rolling the whole batch:
  // a single bad hook out of several is still a minor annoyance, not worth
  // burning another full generation call over.
  return parsed.hooks.map((h) => {
    if (!h.hook_text || findContentQualityIssues(h.hook_text).length === 0) return h
    const cleaned = sanitizeLeakedArtifacts(h.hook_text)
    console.error(`[hooks-generator] stripped leaked artifact(s) from generated hook: ${JSON.stringify(h.hook_text)} -> ${JSON.stringify(cleaned)}`)
    return { ...h, hook_text: cleaned }
  })
}
