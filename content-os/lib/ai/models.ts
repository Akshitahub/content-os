import Groq from "groq-sdk"

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1"

// `generation` was "llama-3.3-70b-versatile" until Groq removed the entire
// Llama 3.x family from their catalog (~2026-08-17 11:37 UTC — confirmed via
// ai_generation_logs and a live /v1/models check). Every call site using
// this model is a reasoning model now (same class as `extraction`/
// `scoring`'s gpt-oss-20b) and MUST set reasoning_effort explicitly and
// size max_tokens with real headroom for hidden reasoning tokens — see the
// per-call-site fixes shipped alongside this change. Never leave
// reasoning_effort unset on a call using this model.
// `vision` confirmed live against Groq's actual /v1/models endpoint
// (2026-08-26), not from documentation -- neither of the commonly-cited
// meta-llama/llama-4-scout-17b-16e-instruct nor
// meta-llama/llama-4-maverick-17b-128e-instruct exist on this account at
// all right now. qwen/qwen3.6-27b is the only model whose live metadata
// lists "image" in input_modalities. Its reasoning_effort only accepts
// "none" or "default" (NOT the "low"/"medium"/"high" scale the gpt-oss
// models use) -- "none" is required, otherwise it burns the whole
// completion budget on a visible <think> trace before ever writing the
// actual JSON output. Confirmed live: one real photo, one call, ~1.3s,
// ~1,400 prompt + ~130 completion tokens (~$0.0012).
export const MODELS = {
  extraction: "openai/gpt-oss-20b",
  generation: "openai/gpt-oss-120b",
  scoring: "openai/gpt-oss-20b",
  vision: "qwen/qwen3.6-27b",
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

export function classifyGroqError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  const errObj = err as Record<string, unknown>
  const status = typeof errObj?.status === "number" ? errObj.status : null

  if (message.includes("GROQ_API_KEY not set")) {
    return "GROQ_API_KEY not set in environment"
  }
  if (status === 401 || message.toLowerCase().includes("invalid api key") || message.toLowerCase().includes("unauthorized")) {
    return "Groq API key is invalid"
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
