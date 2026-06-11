import { useMutation } from "@tanstack/react-query"
import { isApiError } from "@/types/api"
import type { GeneratedHook, GeneratedCaption } from "@/types/app"
import type { GenerateHooksInput, GenerateCaptionsInput } from "@/lib/validations/ai"

type GeneratedHookWithId = GeneratedHook & { id: string | null }
type GeneratedCaptionWithId = GeneratedCaption & { id: string | null }

async function fetchHooks(input: GenerateHooksInput): Promise<GeneratedHookWithId[]> {
  const res = await fetch("/api/v1/ai/hooks/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  const json = await res.json()
  if (!res.ok || isApiError(json)) throw new Error(isApiError(json) ? json.error.message : "Hook generation failed")
  return json.data
}

async function fetchCaption(input: GenerateCaptionsInput): Promise<GeneratedCaptionWithId> {
  const res = await fetch("/api/v1/ai/captions/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  const json = await res.json()
  if (!res.ok || isApiError(json)) throw new Error(isApiError(json) ? json.error.message : "Caption generation failed")
  return json.data
}

export function useGenerateHooks() {
  return useMutation({
    mutationFn: fetchHooks,
  })
}

export function useGenerateCaption() {
  return useMutation({
    mutationFn: fetchCaption,
  })
}
