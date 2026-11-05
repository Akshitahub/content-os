import type { BrandRow } from "@/types/database"
import { critiquePost, type CriticResult } from "./critic"
import type { generatePostImage } from "./post-image-pipeline"

/**
 * Words in the picture (a concept whose device is in-scene text or a sign
 * held up to the viewer -- lib/ai/creative-concept.ts): the image model is
 * asked for them exactly, then the critic reads back what it can see
 * (image_text). A mismatch regenerates ONCE and the better image is kept
 * -- never more than one retry. The extra image is absorbed (no credit),
 * and its attempts are kept so its cost is still logged.
 */

type PostImageResult = Awaited<ReturnType<typeof generatePostImage>>

/** Case, punctuation and spacing don't count; extra words around the intended ones (packaging) are fine. */
export function inSceneTextMatches(intended: string, read: string | null | undefined): boolean {
  const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim()
  const want = norm(intended)
  return !!want && !!read && ` ${norm(read)} `.includes(` ${want} `)
}

export async function withInSceneTextCheck(params: {
  brand: BrandRow
  intendedText: string
  hook: string
  caption: string
  label: string
  run: () => Promise<PostImageResult>
}): Promise<{ result: PostImageResult; critic: CriticResult | null }> {
  const score = async (r: PostImageResult) => (r.success
    ? critiquePost(params.brand, { imageUrl: `data:${r.mimeType};base64,${r.buffer.toString("base64")}`, caption: params.caption, hook: params.hook, format: "post", intendedText: params.intendedText }, params.label)
    : null)
  const first = await params.run()
  const firstCritic = await score(first)
  // No image, or no critic to read it: nothing to check against.
  if (!first.success || !firstCritic || inSceneTextMatches(params.intendedText, firstCritic.image_text)) return { result: first, critic: firstCritic }

  console.log(`[creative-concept] in-scene text mismatch, retried (${params.label})`)
  const second = await params.run()
  const secondCritic = await score(second)
  if (!second.success) return { result: { ...first, attempts: [...first.attempts, ...second.attempts] }, critic: firstCritic }
  const secondMatches = !!secondCritic && inSceneTextMatches(params.intendedText, secondCritic.image_text)
  const keepSecond = secondMatches || (!!secondCritic && secondCritic.overall > firstCritic.overall)
  return keepSecond
    ? { result: { ...second, attempts: [...first.attempts, ...second.attempts] }, critic: secondCritic }
    : { result: { ...first, attempts: [...first.attempts, ...second.attempts] }, critic: firstCritic }
}
