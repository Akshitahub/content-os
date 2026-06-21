import { useMutation } from "@tanstack/react-query"
import { isApiError } from "@/types/api"

export class ApiResponseError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = "ApiResponseError"
  }
}
import type {
  GeneratedHook,
  GeneratedCaption,
  GeneratedImage,
  ReelScript,
  StoryContent,
  CarouselContent,
  BlogPost,
  AdCopy,
} from "@/types/app"
import type { GenerateHooksInput, GenerateCaptionsInput, GenerateImageInput, GenerateContentInput } from "@/lib/validations/ai"

// Discriminated union so components can narrow on result.format
export type ContentResult =
  | { format: "social_post"; content: GeneratedCaption }
  | { format: "reel_script"; content: ReelScript }
  | { format: "story"; content: StoryContent }
  | { format: "carousel"; content: CarouselContent }
  | { format: "blog_post"; content: BlogPost }
  | { format: "ad_copy"; content: AdCopy }

type GeneratedHookWithId = GeneratedHook & { id: string | null }
type GeneratedCaptionWithId = GeneratedCaption & { id: string | null }
type GeneratedImageWithId = GeneratedImage & { id: string | null }

function throwApiError(json: unknown, fallback: string): never {
  if (isApiError(json)) throw new ApiResponseError(json.error.code, json.error.message)
  throw new Error(fallback)
}

async function fetchHooks(input: GenerateHooksInput): Promise<GeneratedHookWithId[]> {
  const res = await fetch("/api/v1/ai/hooks/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  const json = await res.json()
  if (!res.ok || isApiError(json)) throwApiError(json, "Hook generation failed")
  return json.data
}

async function fetchCaption(input: GenerateCaptionsInput): Promise<GeneratedCaptionWithId> {
  const res = await fetch("/api/v1/ai/captions/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  const json = await res.json()
  if (!res.ok || isApiError(json)) throwApiError(json, "Caption generation failed")
  return json.data
}

async function fetchImage(input: GenerateImageInput): Promise<GeneratedImageWithId> {
  const res = await fetch("/api/v1/ai/images/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  const json = await res.json()
  if (!res.ok || isApiError(json)) throwApiError(json, "Image generation failed")
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

export function useGenerateImage() {
  return useMutation({
    mutationFn: fetchImage,
  })
}

async function fetchContent(input: GenerateContentInput): Promise<ContentResult> {
  const res = await fetch("/api/v1/ai/content/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  const json = await res.json()
  if (!res.ok || isApiError(json)) throwApiError(json, "Content generation failed")
  return json.data as ContentResult
}

export function useGenerateContent() {
  return useMutation({
    mutationFn: fetchContent,
  })
}
