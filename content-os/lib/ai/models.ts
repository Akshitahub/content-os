import Groq from "groq-sdk"

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1"

export const MODELS = {
  extraction: "llama-3.1-8b-instant",
  generation: "llama-3.3-70b-versatile",
  scoring: "llama-3.1-8b-instant",
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

// Legacy alias for any code that still references classifyNvidiaError
export const classifyNvidiaError = classifyGroqError

// NVIDIA kept as fallback reference (unused but preserves env var)
export const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"
export const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY
