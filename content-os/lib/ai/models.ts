import Groq from "groq-sdk"
import OpenAI from "openai"

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1"

// `generation` was "llama-3.3-70b-versatile" until Groq removed the entire
// Llama 3.x family from their catalog (~2026-08-17 11:37 UTC — confirmed via
// ai_generation_logs and a live /v1/models check). Every call site using
// this model is a reasoning model now (same class as `extraction`/
// `scoring`'s gpt-oss-20b) and MUST set reasoning_effort explicitly and
// size max_tokens with real headroom for hidden reasoning tokens — see the
// per-call-site fixes shipped alongside this change. Never leave
// reasoning_effort unset on a call using this model. STILL GROQ after the
// Phase 1/1b OpenAI migrations below, and now Groq-ONLY: every remaining
// reader is a deliberately-kept Groq call site (lib/ai/account-analytics.ts,
// lib/ai/reel-prompt-optimizer.ts, lib/ai/blog-prompt-optimizer.ts) --
// every creative stage that used to read it now reads `creative` instead,
// so it's no longer shared between a Groq and an OpenAI call site.
//
// `caption` was the first stage migrated to OpenAI (see
// lib/ai/captions-generator.ts). `creative` covers the rest. Phase 1:
// hooks (lib/ai/hooks-generator.ts), blog (lib/ai/blog-generator.ts and
// the "blog_post"/"reel_script"/"ad_copy" cases inside
// lib/ai/content-generator.ts), and prompt-authoring
// (lib/ai/image-prompt-writer.ts). Phase 1b (via
// lib/ai/creative-completion.ts): story (lib/ai/story-sequence-generator.ts
// and content-generator.ts's "story" case), carousel
// (lib/ai/carousel-generator.ts and the "carousel" case), repurpose
// (lib/ai/repurpose-generator.ts), occasion content
// (lib/ai/occasion-content-generator.ts), and all three Autopilot text
// calls in lib/ai/fastlane.ts. "gpt-5.5" per the migration spec; falls
// back to "gpt-5.4" only if gpt-5.5 turns out not to be available on this
// account's API key -- verify both IDs are live on the real key before
// shipping this to production (not independently verifiable from here).
// Confirmed live against OpenAI's own model page
// (developers.openai.com/api/docs/models/gpt-5.5, checked 2026-10-25) that
// gpt-5.5 is real and supports reasoning_effort
// none/low/medium(default)/high/xhigh. NOT yet in the installed `openai`
// SDK's own hardcoded ChatModel literal union (which only goes up to
// gpt-5.4 as of this package version) -- still compiles fine since that
// type also accepts any plain string, just no autocomplete/typo-checking
// for this specific literal.
//
// `vision` migrated from Groq's qwen/qwen3.6-27b to the same gpt-5.5 --
// confirmed on the same model page that gpt-5.5 accepts image input (text
// + image in, text out). Kept as its own named key rather than merged into
// `creative` (even though the value is identical today), matching this
// file's existing convention of separate named keys per logical stage --
// `extraction`/`scoring` already share one value under two names for the
// same reason.
export const MODELS = {
  extraction: "openai/gpt-oss-20b",
  generation: "openai/gpt-oss-120b",
  scoring: "openai/gpt-oss-20b",
  vision: "gpt-5.5",
  caption: "gpt-5.5",
  creative: "gpt-5.5",
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

// Classifies a raw OpenAI SDK error into a short, user-facing message --
// same provider-name-free convention as classifyGroqError below, for any
// OpenAI-backed call site (captions, images) that forwards an error
// message toward the user rather than handling it with its own generic
// fallback.
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
