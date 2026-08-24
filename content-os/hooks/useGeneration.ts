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
  ContentFormat,
  Platform,
} from "@/types/app"
import type { GenerateHooksInput, GenerateCaptionsInput, GenerateImageInput, GenerateContentInput, GenerateFullPostInput, GeneratePostImageInput } from "@/lib/validations/ai"

// Discriminated union so components can narrow on result.format
export type ContentResult =
  | { format: "social_post"; content: GeneratedCaption }
  | { format: "reel_script"; content: ReelScript; id: string | null }
  | { format: "story"; content: StoryContent }
  | { format: "carousel"; content: CarouselContent }
  | { format: "blog_post"; content: BlogPost }
  | { format: "ad_copy"; content: AdCopy }

export type FullPostResult = {
  hook: GeneratedHook
  content: ContentResult
  postCardHtml: string | null
  platform: Platform
  format: ContentFormat
  /** Only present for format "social_post" — ties subsequent post-image
   * generate/regenerate calls to this post so charging can be decided
   * server-side. See lib/usage/post-image-regenerate-session.ts. */
  postSessionId: string | null
  /** Only present for format "social_post" — links this caption to its
   * generated_images row (passed through to post-image/generate, which
   * sets the same id on its own insert) so the Library can find the image
   * that belongs to this caption. See content_projects in the schema. */
  contentProjectId: string | null
}

type GeneratedHookWithId = GeneratedHook & { id: string | null }
type GeneratedCaptionWithId = GeneratedCaption & { id: string | null }
type GeneratedImageWithId = GeneratedImage & { id: string | null }

export type GeneratedPostImage = {
  id: string | null
  public_url: string
  storage_path: string
  image_prompt: string
}

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

async function fetchPostImage(input: GeneratePostImageInput): Promise<GeneratedPostImage> {
  const res = await fetch("/api/v1/ai/post-image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  const json = await res.json()
  if (!res.ok || isApiError(json)) throwApiError(json, "Image generation failed")
  return json.data
}

/** Powers both the initial Create → Full Post AI image and the
 * "Regenerate image" button — see app/api/v1/ai/post-image/generate/route.ts. */
export function useGeneratePostImage() {
  return useMutation({
    mutationFn: fetchPostImage,
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

async function fetchFullPost(input: GenerateFullPostInput): Promise<FullPostResult> {
  const res = await fetch("/api/v1/ai/fullpost/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  const json = await res.json()
  if (!res.ok || isApiError(json)) throwApiError(json, "Full post generation failed")
  return json.data as FullPostResult
}

export function useGenerateFullPost() {
  return useMutation({
    mutationFn: fetchFullPost,
  })
}
