import type OpenAI from "openai"

// Official OpenAI per-token prices used to write ai_generation_logs.cost_usd
// from each call's real `usage`. Source: OpenAI's pricing page
// (developers.openai.com/api/docs/pricing), checked 2026-10-25, standard
// tier, USD per 1M tokens:
//   gpt-5.5 (<272K context): input $5.00, cached input $0.50, output $30.00
//     (hidden reasoning tokens are billed as output -- they're already
//     included in usage.completion_tokens)
//   gpt-image-2: text input $5.00 (cached $1.25), image input $8.00
//     (cached $2.00), image output $30.00. The page lists no separate
//     text-output rate for gpt-image-2, so all output tokens are priced at
//     the image-output rate.
// These are list prices, not our invoice -- if a request runs over 272K
// context, or OpenAI changes prices, these numbers drift. Update this file
// (and its date) rather than the call sites.
const TEXT_PRICES_PER_1M: Record<string, { input: number; cachedInput: number; output: number }> = {
  "gpt-5.5": { input: 5.0, cachedInput: 0.5, output: 30.0 },
}

const IMAGE_PRICES_PER_1M: Record<string, { textInput: number; imageInput: number; output: number }> = {
  "gpt-image-2": { textInput: 5.0, imageInput: 8.0, output: 30.0 },
}

/** Chat-completions usage, summable across calls (retries, multi-step flows). */
export type TextUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  /** From usage.prompt_tokens_details.cached_tokens -- a subset of prompt_tokens. */
  cached_tokens?: number
}

export function toTextUsage(usage: OpenAI.CompletionUsage | null | undefined): TextUsage | undefined {
  if (!usage) return undefined
  return {
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
    cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
  }
}

/** Sums two usages; undefined + undefined stays undefined (no usage reported at all). */
export function addTextUsage(a: TextUsage | undefined, b: TextUsage | undefined): TextUsage | undefined {
  if (!a) return b
  if (!b) return a
  return {
    prompt_tokens: (a.prompt_tokens ?? 0) + (b.prompt_tokens ?? 0),
    completion_tokens: (a.completion_tokens ?? 0) + (b.completion_tokens ?? 0),
    total_tokens: (a.total_tokens ?? 0) + (b.total_tokens ?? 0),
    cached_tokens: (a.cached_tokens ?? 0) + (b.cached_tokens ?? 0),
  }
}

/** USD cost of a chat completion's usage, or null if the model has no price entry / no usage was reported. */
export function textCostUsd(model: string, usage: TextUsage | undefined): number | null {
  const price = TEXT_PRICES_PER_1M[model]
  if (!price || !usage) return null
  const prompt = usage.prompt_tokens ?? 0
  const cached = Math.min(usage.cached_tokens ?? 0, prompt)
  const cost = ((prompt - cached) * price.input + cached * price.cachedInput + (usage.completion_tokens ?? 0) * price.output) / 1_000_000
  return roundUsd(cost)
}

/** USD cost of one Images API response's usage, or null if unpriced / no usage reported. */
export function imageCostUsd(model: string, usage: OpenAI.ImagesResponse.Usage | null | undefined): number | null {
  const price = IMAGE_PRICES_PER_1M[model]
  if (!price || !usage) return null
  const textIn = usage.input_tokens_details?.text_tokens ?? 0
  const imageIn = usage.input_tokens_details?.image_tokens ?? 0
  // If the details block is missing, price all input as text (the cheaper
  // rate) rather than dropping it -- an under-estimate, never a guess upward.
  const unsplitIn = textIn + imageIn === 0 ? usage.input_tokens ?? 0 : 0
  const cost = ((textIn + unsplitIn) * price.textInput + imageIn * price.imageInput + (usage.output_tokens ?? 0) * price.output) / 1_000_000
  return roundUsd(cost)
}

/** Sums nullable costs: null only if every part is null (nothing priced at all). */
export function sumCostUsd(...costs: (number | null | undefined)[]): number | null {
  const known = costs.filter((c): c is number => typeof c === "number")
  return known.length === 0 ? null : roundUsd(known.reduce((a, b) => a + b, 0))
}

/** Thrown when billed calls succeeded at the API level but the generation
 * still failed (e.g. unparseable JSON twice), so the route's failure log
 * can still record what was spent. */
export class UsageCarryingError extends Error {
  constructor(message: string, readonly usage: TextUsage | undefined, readonly costUsd: number | null) {
    super(message)
  }
}

// ai_generation_logs.cost_usd is DECIMAL(10,6) (supabase/migrations/001_initial_schema.sql).
function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}
