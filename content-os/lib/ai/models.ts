export const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"

export const MODELS = {
  extraction: "meta/llama-3.1-8b-instruct",
  generation: "meta/llama-3.1-70b-instruct",
  scoring: "meta/llama-3.1-70b-instruct",
} as const

export type ModelKey = keyof typeof MODELS

export function getApiKey(): string {
  const key = process.env.NVIDIA_API_KEY
  if (!key) throw new Error("NVIDIA_API_KEY not set in environment")
  return key
}

export function classifyNvidiaError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  const errObj = err as Record<string, unknown>
  const status = typeof errObj?.status === "number" ? errObj.status : null

  if (message.includes("NVIDIA_API_KEY not set") || message.includes("not configured")) {
    return "NVIDIA_API_KEY not set in environment"
  }
  if (status === 401 || message.includes("401") || message.toLowerCase().includes("invalid api key") || message.toLowerCase().includes("unauthorized")) {
    return "NVIDIA API key is invalid"
  }
  if (status === 429 || message.includes("429") || message.toLowerCase().includes("rate limit")) {
    return "Generation limit reached, please try again in a moment"
  }
  if (message.toLowerCase().includes("model") && (message.toLowerCase().includes("not available") || message.toLowerCase().includes("not found"))) {
    return "Selected AI model is not available on your NVIDIA plan"
  }
  return "AI generation failed, please try again"
}
