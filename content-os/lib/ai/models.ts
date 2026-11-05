import Groq from "groq-sdk"
import OpenAI from "openai"

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1"

// Every text and vision model runs on Groq (2026-11-05); OpenAI is used for
// image generation only (gpt-image-2, lib/ai/image-provider.ts). Call sites
// use the OpenAI SDK pointed at Groq's OpenAI-compatible API
// (getTextClientFor, routed by exact id through GROQ_MODEL_IDS), through
// lib/ai/provider-fallback.ts's createTextCompletion for text -- which waits
// out a short per-minute 429 on Groq and otherwise throws; there is no
// OpenAI fallback.
//
// - caption / creative / generation: openai/gpt-oss-120b. Reasoning models:
//   every call sets reasoning_effort (low / medium) and sizes its token cap
//   with headroom for hidden reasoning tokens -- never leave it unset.
// - extraction / scoring: openai/gpt-oss-20b (one value, two names).
// - vision: qwen/qwen3.8-27b (console.groq.com/docs/model/qwen/qwen3.8-27b,
//   checked 2026-11-05): text + image in, at most 3 images a request, 20MB
//   per image URL, 2,048 input tokens per image, 16,384 max output tokens,
//   JSON mode. reasoning_effort "none" (instruct, no reasoning tokens) for
//   perception / extraction, "low" (short thinking) for judgements with
//   reasoning_format "hidden" -- see visionReasoning below. Images go through
//   lib/ai/vision-image.ts (JPEG, <= 1536px) first.
export const MODELS = {
  extraction: "openai/gpt-oss-20b",
  generation: "openai/gpt-oss-120b",
  scoring: "openai/gpt-oss-20b",
  vision: "qwen/qwen3.8-27b",
  caption: "openai/gpt-oss-120b",
  creative: "openai/gpt-oss-120b",
} as const

export type ModelKey = keyof typeof MODELS

export function getApiKey(): string {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error("GROQ_API_KEY is not set")
  return key
}

export function getGroqClient(): Groq {
  return new Groq({ apiKey: getApiKey() })
}

export function getOpenAIApiKey(): string {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error("OPENAI_API_KEY is not set")
  return key
}

let cachedOpenAIClient: OpenAI | null = null
export function getOpenAIClient(): OpenAI {
  if (cachedOpenAIClient) return cachedOpenAIClient
  cachedOpenAIClient = new OpenAI({ apiKey: getOpenAIApiKey() })
  return cachedOpenAIClient
}

/** Every Groq model id this app calls -- routed to Groq's OpenAI-compatible API by exact id. */
export const GROQ_MODEL_IDS: ReadonlySet<string> = new Set(["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"])

/** Groq model ids served through its OpenAI-compatible API (exact match -- a prefix would misroute). */
export function isGroqTextModel(model: string): boolean {
  return GROQ_MODEL_IDS.has(model)
}

/**
 * Reasoning settings for a MODELS.vision (qwen/qwen3.8-27b) call. "none" is
 * Qwen's instruct mode (no reasoning tokens) for perception / extraction;
 * "low" is short thinking for a judgement, with reasoning_format "hidden" --
 * Groq rejects raw reasoning with JSON mode (400), and hidden keeps the
 * thinking out of the JSON content. Groq-only field, so cast for the SDK type.
 */
export function visionReasoning(effort: "none" | "low"): { reasoning_effort: "none" | "low" } {
  return (effort === "low" ? { reasoning_effort: "low", reasoning_format: "hidden" } : { reasoning_effort: "none" }) as { reasoning_effort: "none" | "low" }
}

/** "groq" | "openai" -- for the provider= field in text-call log lines. */
export function textProviderFor(model: string): "groq" | "openai" {
  return isGroqTextModel(model) ? "groq" : "openai"
}

// The OpenAI SDK pointed at Groq (same API shape): the client for every
// text and vision call. A non-Groq model id is a bug -- text and vision
// never go to OpenAI, which serves image generation only (getOpenAIClient).
let cachedGroqOpenAIClient: OpenAI | null = null
export function getTextClientFor(model: string): OpenAI {
  if (!isGroqTextModel(model)) throw new Error(`[models] ${model} is not a Groq model -- text and vision calls run on Groq only`)
  if (cachedGroqOpenAIClient) return cachedGroqOpenAIClient
  // GROQ_BASE_URL env (optional): a proxy, or a local stand-in for scripts/test-provider-fallback.ts.
  cachedGroqOpenAIClient = new OpenAI({ apiKey: getApiKey(), baseURL: process.env.GROQ_BASE_URL || GROQ_BASE_URL })
  return cachedGroqOpenAIClient
}

// Classifies a raw OpenAI SDK error into a short, user-facing message --
// same provider-name-free convention as classifyGroqError below. The SDK
// object is the same for Groq calls (getTextClientFor), so routes use this
// for any error they forward toward the user.
export function classifyOpenAIError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  const errObj = err as Record<string, unknown>
  const status = typeof errObj?.status === "number" ? errObj.status : null

  if (message.includes("OPENAI_API_KEY not set") || status === 401) {
    return "Configuration issue. Please contact support."
  }
  if (status === 429 || message.toLowerCase().includes("rate limit")) {
    return "Generation limit reached, please try again in a moment"
  }
  if (message.toLowerCase().includes("model") && (message.toLowerCase().includes("not available") || message.toLowerCase().includes("not found") || message.toLowerCase().includes("does not exist"))) {
    return "Selected AI model is not available"
  }
  return "AI generation failed, please try again"
}

// Classifies a raw Groq SDK error into a short, user-facing message --
// CONFIRMED (2026-09-15) this used to return "GROQ_API_KEY not set in
// environment" and "Groq API key is invalid" literally, and at least two
// routes (app/api/v1/ai/topics/suggest/route.ts,
// app/api/v1/ai/image-prompt/write/route.ts) pass this straight into
// buildError()'s user-facing message with no further filtering -- a real,
// direct leak of the provider name to the end user, not a hypothetical
// one. Every branch below is now provider-name-free; the classification
// logic itself (which condition maps to which message) is unchanged.
export function classifyGroqError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  const errObj = err as Record<string, unknown>
  const status = typeof errObj?.status === "number" ? errObj.status : null

  if (message.includes("GROQ_API_KEY not set")) {
    return "Configuration issue. Please contact support."
  }
  if (status === 401 || message.toLowerCase().includes("invalid api key") || message.toLowerCase().includes("unauthorized")) {
    return "Configuration issue. Please contact support."
  }
  if (status === 429 || message.toLowerCase().includes("rate limit")) {
    return "Generation limit reached, please try again in a moment"
  }
  if (message.toLowerCase().includes("model") && (message.toLowerCase().includes("not available") || message.toLowerCase().includes("not found"))) {
    return "Selected AI model is not available"
  }
  return "AI generation failed, please try again"
}

function isRateLimitError(err: unknown): boolean {
  const errObj = err as Record<string, unknown>
  const status = typeof errObj?.status === "number" ? errObj.status : null
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()
  return status === 429 || message.includes("rate_limit") || message.includes("rate limit")
}

// Groq's 429 body names a precise suggested wait ("...Please try again in
// 1.845s.") — parsed here instead of guessing a fixed delay. Measured live
// against the on-demand tier's per-model TPM cap: suggested waits ranged up
// to ~9s, so a short fixed retry (the 3000ms fastlane.ts uses) frequently
// wasn't enough headroom and just failed again. Capped so one unusually
// long suggested wait can't stall a caller indefinitely.
function parseRetryAfterMs(err: unknown): number {
  const message = err instanceof Error ? err.message : String(err)
  const match = message.match(/try again in ([\d.]+)(ms|s)\b/i)
  if (!match) return 4000
  const value = parseFloat(match[1])
  const ms = match[2].toLowerCase() === "ms" ? value : value * 1000
  return Math.min(Math.ceil(ms) + 250, 10_000)
}

/**
 * Retries a Groq call exactly once, and only if it failed with a 429 —
 * every other error (invalid JSON, model unavailable, etc.) rethrows
 * immediately, identical to calling the SDK directly. Exists specifically
 * because influencer scoring was silently swallowing 429s into a
 * null-score "success" (see lib/ai/influencer-discovery.ts and
 * app/api/v1/brands/[brandId]/influencers/discover/route.ts) — this
 * recovers those calls instead of quietly discarding them, without
 * papering over any other kind of failure.
 */
export async function withGroqRateLimitRetry<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (err) {
    if (!isRateLimitError(err)) throw err
    const waitMs = parseRetryAfterMs(err)
    console.log(`[groq] rate limited, retrying once after ${waitMs}ms`)
    await new Promise((resolve) => setTimeout(resolve, waitMs))
    return call()
  }
}

// Legacy alias for any code that still references classifyNvidiaError
export const classifyNvidiaError = classifyGroqError

// NVIDIA kept as fallback reference (unused but preserves env var)
export const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"
export const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY
