import { AsyncLocalStorage } from "node:async_hooks"
import type OpenAI from "openai"
import type { ChatCompletion, ChatCompletionChunk, ChatCompletionCreateParamsNonStreaming, ChatCompletionCreateParamsStreaming } from "openai/resources/chat/completions"
import type { Stream } from "openai/streaming"
import { getTextClientFor, isGroqTextModel } from "./models"

/**
 * Every text call goes through createTextCompletion, on Groq only -- there
 * is no OpenAI fallback for text (OpenAI is used for gpt-image-2 image
 * generation alone). A short per-minute 429 (Groq suggests a wait of at
 * most SHORT_WAIT_MAX_MS) is waited out and retried on Groq once; any other
 * error -- a daily limit, a long wait, a 413, a 5xx, a timeout -- is thrown
 * as Groq's own error, and the generation routes refund the user's credits
 * on it (refundGenerationUsage in their catch paths).
 */

/** A per-minute 429 at most this long is waited out on Groq before giving up. */
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

/** A per-minute 429 worth waiting out on Groq: not a daily limit, and a suggested wait under SHORT_WAIT_MAX_MS. */
export function isShortRateLimit(err: unknown): boolean {
  const text = errText(err).toLowerCase()
  if (errStatus(err) !== 429 && !text.includes("rate limit") && !text.includes("rate_limit")) return false
  if (/per day|\btpd\b|\brpd\b|daily/.test(text)) return false
  const wait = suggestedWaitMs(err)
  return wait !== null && wait <= SHORT_WAIT_MAX_MS
}

// ─── The generation a call belongs to ───────────────────────────────────────

interface GenerationContext {
  /** The generation route / job, e.g. "stories", "autopilot-slot". */
  route: string
  /** content_events.content_type for events in this generation. */
  contentType: string
  brandId?: string
  userId?: string | null
}

const generationContext = new AsyncLocalStorage<GenerationContext>()

/** Runs `fn` as one generation (a route request, an Autopilot slot). */
export function runWithGenerationContext<T>(ctx: { route: string; contentType: string; brandId?: string; userId?: string | null }, fn: () => Promise<T>): Promise<T> {
  return generationContext.run({ ...ctx }, fn)
}

/** Called by a route once it knows (and has checked) the brand. */
export function noteGenerationBrand(brandId: string, userId: string | null): void {
  const ctx = generationContext.getStore()
  if (ctx) {
    ctx.brandId = brandId
    ctx.userId = userId
  }
}

// ─── The call ───────────────────────────────────────────────────────────────

interface CallOptions {
  /** Short stage label for logs ("story", "quality_gate", "hooks", ...). */
  stage: string
  timeout?: number
}

export interface TextCompletionResult<R> {
  response: R
  /** The model that answered -- price and log with this one. */
  model: string
  provider: "groq"
}

async function onGroq<R>(params: { model: string }, opts: CallOptions, call: (client: OpenAI, maxRetries: number) => Promise<R>): Promise<TextCompletionResult<R>> {
  const model = params.model
  // Text never goes to OpenAI: a non-Groq model id here is a bug, not a fallback.
  if (!isGroqTextModel(model)) throw new Error(`[provider-fallback] ${model} is not a Groq model -- text calls run on Groq only`)
  const client = getTextClientFor(model)
  try {
    // No SDK retries: a short 429 is waited out below, anything else is thrown.
    return { response: await call(client, 0), model, provider: "groq" }
  } catch (err) {
    if (!isShortRateLimit(err)) throw err
    const wait = Math.min(SHORT_WAIT_MAX_MS, (suggestedWaitMs(err) ?? 2000) + 250)
    console.log(`[provider-fallback] stage=${opts.stage} groq rate limited, retrying on groq after ${wait}ms`)
    await new Promise((r) => setTimeout(r, wait))
    return { response: await call(client, 0), model, provider: "groq" }
  }
}

/** chat.completions.create on Groq, with one wait-and-retry on a short 429. Throws Groq's error otherwise. */
export function createTextCompletion(params: ChatCompletionCreateParamsNonStreaming & { max_tokens?: number | null }, opts: CallOptions): Promise<TextCompletionResult<ChatCompletion>> {
  return onGroq(params, opts, (client, maxRetries) => client.chat.completions.create(params as ChatCompletionCreateParamsNonStreaming, { timeout: opts.timeout, maxRetries }))
}

/** The streaming variant -- the wait-and-retry applies only while the stream is being opened. */
export function createTextCompletionStream(params: ChatCompletionCreateParamsStreaming & { max_tokens?: number | null }, opts: CallOptions): Promise<TextCompletionResult<Stream<ChatCompletionChunk>>> {
  return onGroq(params, opts, (client, maxRetries) => client.chat.completions.create(params as ChatCompletionCreateParamsStreaming, { timeout: opts.timeout, maxRetries }))
}
