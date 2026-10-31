import { AsyncLocalStorage } from "node:async_hooks"
import type OpenAI from "openai"
import type { ChatCompletion, ChatCompletionChunk, ChatCompletionCreateParamsNonStreaming, ChatCompletionCreateParamsStreaming } from "openai/resources/chat/completions"
import type { Stream } from "openai/streaming"
import { getOpenAIClient, getTextClientFor, isGroqTextModel } from "./models"
import { textCostUsd, toTextUsage } from "./pricing"

/**
 * Text generation never fails just because Groq is out of tokens: every
 * Groq text call goes through createTextCompletion, which retries the SAME
 * request once on OpenAI when Groq can't serve it --
 * - a 429 whose suggested wait is long (> 20s) or a daily token / request
 *   limit (a short per-minute 429 is waited out and retried on Groq once
 *   first, and only falls over if that fails too);
 * - a 413 "request too large" (one request over the per-minute token cap);
 * - a Groq 5xx, a timeout or an unreachable Groq.
 * Any other error (a bad request, a refusal) is rethrown untouched.
 *
 * The OpenAI model is mapped by size (FALLBACK_MODEL) and the request is
 * adapted: max_tokens -> max_completion_tokens, sampling params dropped
 * (reasoning models reject them). Every fallback is logged with its reason
 * and cost, and -- inside a generation route or an Autopilot slot (see
 * runWithGenerationContext) -- recorded as a "provider_fallback" content
 * event, so /admin/metrics shows how often it happens. Without an
 * OPENAI_API_KEY, or when the OpenAI call fails too, the Groq error is
 * rethrown as before.
 */

/** Groq model -> the OpenAI model that stands in for it (lib/ai/pricing.ts has both prices). */
export const FALLBACK_MODEL: Record<string, string> = {
  // creative / caption / generation
  "openai/gpt-oss-120b": "gpt-5.4",
  // scoring / extraction
  "openai/gpt-oss-20b": "gpt-5.4-mini",
}

export type FallbackReason = "daily_limit" | "rate_limit" | "request_too_large" | "server_error" | "timeout" | "unreachable"

/** A per-minute 429 at most this long is waited out on Groq before falling over. */
const SHORT_WAIT_MAX_MS = 20_000

function errStatus(err: unknown): number | null {
  const status = (err as { status?: unknown })?.status
  return typeof status === "number" ? status : null
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Groq's suggested wait ("...try again in 1.845s" / "in 4m19.2s"), in ms; null when it gives none. */
export function suggestedWaitMs(err: unknown): number | null {
  const m = errText(err).match(/try again in\s+((?:\d+h)?(?:\d+m(?!s))?(?:[\d.]+(?:ms|s))?)/i)
  if (!m || !m[1]) return null
  const part = (re: RegExp) => Number(m[1]!.match(re)?.[1] ?? 0)
  const ms = part(/(\d+)h/) * 3_600_000 + part(/(\d+)m(?!s)/) * 60_000 + (/[\d.]+ms/.test(m[1]) ? part(/([\d.]+)ms/) : part(/([\d.]+)s/) * 1000)
  return ms > 0 ? ms : null
}

/**
 * Why this Groq error should fall over to OpenAI -- or "wait" for a short
 * per-minute 429 worth retrying on Groq, or null for an error OpenAI can't fix.
 */
export function classifyGroqFailure(err: unknown): FallbackReason | "wait" | null {
  const status = errStatus(err)
  const text = errText(err).toLowerCase()
  if (status === 429 || text.includes("rate limit") || text.includes("rate_limit")) {
    if (/per day|\btpd\b|\brpd\b|daily/.test(text)) return "daily_limit"
    const wait = suggestedWaitMs(err)
    return wait !== null && wait <= SHORT_WAIT_MAX_MS ? "wait" : "rate_limit"
  }
  if (status === 413 || text.includes("request too large")) return "request_too_large"
  if (status !== null && status >= 500) return "server_error"
  const name = (err as { name?: string })?.name ?? ""
  if (name === "APIConnectionTimeoutError" || /timed? ?out/.test(text)) return "timeout"
  if (name === "APIConnectionError" || /econnreset|enotfound|fetch failed|socket hang up/.test(text)) return "unreachable"
  return null
}

// ─── Where a fallback is recorded ───────────────────────────────────────────

interface GenerationContext {
  /** The generation route / job, e.g. "stories", "autopilot-slot". */
  route: string
  /** content_events.content_type the fallback is filed under (lib/admin/metrics.ts). */
  contentType: string
  brandId?: string
  userId?: string | null
  fallbacks: number
}

const generationContext = new AsyncLocalStorage<GenerationContext>()

/** Runs `fn` as one generation (a route request, an Autopilot slot): fallbacks inside it are recorded against it. */
export function runWithGenerationContext<T>(ctx: { route: string; contentType: string; brandId?: string; userId?: string | null }, fn: () => Promise<T>): Promise<T> {
  return generationContext.run({ ...ctx, fallbacks: 0 }, fn)
}

/** Called by a route once it knows (and has checked) the brand -- fallbacks are content events per brand. */
export function noteGenerationBrand(brandId: string, userId: string | null): void {
  const ctx = generationContext.getStore()
  if (ctx) {
    ctx.brandId = brandId
    ctx.userId = userId
  }
}

/** How many calls in the current generation fell over to OpenAI (for the route's timing line). */
export function generationFallbackCount(): number {
  return generationContext.getStore()?.fallbacks ?? 0
}

async function recordFallback(meta: { stage: string; reason: FallbackReason; from: string; to: string; costUsd: number | null }): Promise<void> {
  const ctx = generationContext.getStore()
  if (!ctx) return
  ctx.fallbacks++
  if (!ctx.brandId) return
  try {
    const [{ createAdminClient }, { recordContentEvent }] = await Promise.all([import("@/lib/supabase/server"), import("@/lib/usage/content-events")])
    recordContentEvent(await createAdminClient(), {
      userId: ctx.userId ?? null,
      brandId: ctx.brandId,
      contentType: ctx.contentType as never,
      event: "provider_fallback",
      meta: { route: ctx.route, stage: meta.stage, reason: meta.reason, from_model: meta.from, to_model: meta.to, cost_usd: meta.costUsd },
    })
  } catch (err) {
    console.error("[provider-fallback] couldn't record the fallback event (non-fatal):", errText(err))
  }
}

// ─── The request on OpenAI ──────────────────────────────────────────────────

/** The same request for OpenAI: mapped model, max_completion_tokens, no sampling params. */
function toOpenAIRequest<P extends { model: string; max_tokens?: number | null; max_completion_tokens?: number | null }>(params: P, model: string): P {
  const { max_tokens: maxTokens, temperature: _t, top_p: _p, ...rest } = params as P & { temperature?: unknown; top_p?: unknown }
  void _t
  void _p
  return { ...rest, model, max_completion_tokens: params.max_completion_tokens ?? maxTokens ?? undefined } as unknown as P
}

let warnedNoOpenAIKey = false

interface CallOptions {
  /** Short stage label for logs and events ("story", "quality_gate", "hooks", ...). */
  stage: string
  timeout?: number
  /** SDK retries on the OpenAI path (Groq's own retries are handled here). Default 1. */
  maxRetries?: number
}

export interface TextCompletionResult<R> {
  response: R
  /** The model that actually answered (the fallback's when it fell over) -- price and log with this one. */
  model: string
  provider: "groq" | "openai"
  fallbackReason: FallbackReason | null
}

async function withFallback<R>(params: { model: string }, opts: CallOptions, call: (client: OpenAI, request: typeof params, maxRetries: number) => Promise<R>, usageOf: (r: R) => ChatCompletion["usage"] | undefined): Promise<TextCompletionResult<R>> {
  const groqModel = params.model
  if (!isGroqTextModel(groqModel)) {
    return { response: await call(getTextClientFor(groqModel), params, opts.maxRetries ?? 1), model: groqModel, provider: "openai", fallbackReason: null }
  }
  let firstErr: unknown
  try {
    // No SDK retries on Groq: a short 429 is waited out below, anything else falls over at once.
    return { response: await call(getTextClientFor(groqModel), params, 0), model: groqModel, provider: "groq", fallbackReason: null }
  } catch (err) {
    firstErr = err
  }
  let reason = classifyGroqFailure(firstErr)
  if (reason === "wait") {
    const wait = Math.min(SHORT_WAIT_MAX_MS, (suggestedWaitMs(firstErr) ?? 2000) + 250)
    console.log(`[provider-fallback] stage=${opts.stage} groq rate limited, retrying on groq after ${wait}ms`)
    await new Promise((r) => setTimeout(r, wait))
    try {
      return { response: await call(getTextClientFor(groqModel), params, 0), model: groqModel, provider: "groq", fallbackReason: null }
    } catch (err) {
      firstErr = err
      const again = classifyGroqFailure(err)
      reason = again === "wait" ? "rate_limit" : again
    }
  }
  if (!reason) throw firstErr
  const fallbackModel = FALLBACK_MODEL[groqModel]
  if (!fallbackModel) throw firstErr
  if (!process.env.OPENAI_API_KEY) {
    if (!warnedNoOpenAIKey) {
      warnedNoOpenAIKey = true
      console.error("[provider-fallback] OPENAI_API_KEY is not set -- Groq failures can't fall back to OpenAI")
    }
    throw firstErr
  }
  const startedAt = Date.now()
  console.warn(`[provider-fallback] stage=${opts.stage} groq model=${groqModel} failed (${reason}: ${errText(firstErr).slice(0, 160)}) -- retrying on openai model=${fallbackModel}`)
  let response: R
  try {
    response = await call(getOpenAIClient(), toOpenAIRequest(params, fallbackModel), opts.maxRetries ?? 1)
  } catch (err) {
    // The fallback failing too never makes things worse than before: the
    // caller gets Groq's own error, exactly as without a fallback.
    console.error(`[provider-fallback] stage=${opts.stage} openai fallback model=${fallbackModel} failed too (${errText(err).slice(0, 160)}) -- rethrowing the groq error`)
    throw firstErr
  }
  const costUsd = textCostUsd(fallbackModel, toTextUsage(usageOf(response)))
  console.log(`[provider-fallback] stage=${opts.stage} provider=openai model=${fallbackModel} fallback_reason=${reason} latencyMs=${Date.now() - startedAt} costUsd=${costUsd ?? "unknown"} success=true`)
  await recordFallback({ stage: opts.stage, reason, from: groqModel, to: fallbackModel, costUsd })
  return { response, model: fallbackModel, provider: "openai", fallbackReason: reason }
}

/** chat.completions.create with the Groq -> OpenAI fallback. Throws what the provider throws otherwise. */
export function createTextCompletion(params: ChatCompletionCreateParamsNonStreaming & { max_tokens?: number | null }, opts: CallOptions): Promise<TextCompletionResult<ChatCompletion>> {
  return withFallback(
    params,
    opts,
    (client, request, maxRetries) => client.chat.completions.create(request as ChatCompletionCreateParamsNonStreaming, { timeout: opts.timeout, maxRetries }),
    (r) => r.usage,
  )
}

/** The streaming variant -- falls over only while the stream is being opened. */
export function createTextCompletionStream(params: ChatCompletionCreateParamsStreaming & { max_tokens?: number | null }, opts: CallOptions): Promise<TextCompletionResult<Stream<ChatCompletionChunk>>> {
  return withFallback(
    params,
    opts,
    (client, request, maxRetries) => client.chat.completions.create(request as ChatCompletionCreateParamsStreaming, { timeout: opts.timeout, maxRetries }),
    () => undefined,
  )
}
