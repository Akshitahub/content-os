/**
 * Words in the picture (a concept whose device is in-scene text or a sign
 * held up to the viewer -- lib/ai/creative-concept.ts): the image model is
 * asked for them exactly, then the critic reads back what it can see
 * (image_text, lib/ai/critic.ts). A mismatch never regenerates -- each item
 * makes its image once -- it becomes the critic's top fix, so the user can
 * choose "Make it better".
 */

/** Case, punctuation and spacing don't count; extra words around the intended ones (packaging) are fine. */
export function inSceneTextMatches(intended: string, read: string | null | undefined): boolean {
  const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim()
  const want = norm(intended)
  return !!want && !!read && ` ${norm(read)} `.includes(` ${want} `)
}
