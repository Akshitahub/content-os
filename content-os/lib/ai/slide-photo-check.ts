import { z } from "zod"
import type { BrandRow } from "@/types/database"
import { MODELS, getOpenAIClient } from "./models"
import { textCostUsd, toTextUsage } from "./pricing"
import { generateCarouselSlideBackground, type SlidePoint } from "./carousel-slide-background"

/**
 * A carousel slide's photo must show THAT slide's point -- the specific
 * item its headline names: "White tee" = the chinos worn with a white tee,
 * "Accessories" = visible accessories, not the catalogue shot's own outfit.
 * Every slide photo is generated with its point (with a product reference,
 * only the product is taken from it), then one focused vision call checks
 * the photo shows the named item (show_item, 1-10). Below AGREE_MIN the
 * photo is generated once more with the miss spelled out, and the better of
 * the two is kept. No key / an error = the first photo, as before. Brand
 * photos are matched per slide by photo-fit (lib/ai/photo-fit.ts), which
 * applies the same rule to its descriptions.
 */

export const AGREE_MIN = 6

/**
 * A middle slide whose photo still doesn't show its point after the retry
 * goes type-led instead (its words over a close detail of the product photo,
 * else the brand-colour band) -- a designed type slide beats a photo that
 * contradicts it. The cover and CTA keep theirs.
 */
export function photoMissesPoint(agree: number | undefined, index: number, count: number): boolean {
  return agree !== undefined && agree < AGREE_MIN && index > 0 && index < count - 1
}

export interface SlideCopy { headline: string; body?: string | null; productName?: string | null }

/** What the slide's photo must show, from its words. */
export function slidePoint(copy: SlideCopy): SlidePoint {
  return { show: `${copy.headline}${copy.body ? ` -- ${copy.body}` : ""}`, productName: copy.productName ?? null }
}

/** The check prompt -- exported for scripts/test-slide-point.ts. */
export function buildPointCheckPrompt(copy: SlideCopy): string {
  return `This photo is a carousel slide. The slide says:
HEADLINE: "${copy.headline}"${copy.body ? `\nLINE: "${copy.body}"` : ""}${copy.productName ? `\nPRODUCT: ${copy.productName}` : ""}

Does the photo clearly show the specific item or action the HEADLINE names? Judge only what is visible.
- "White tee" needs a white tee in view; "Navy blazer" a navy blazer; "Add accessories" visible accessories (a belt, a watch, sunglasses...); "Hang it to dry" a garment hanging to dry.
- A different item in its place (a striped shirt instead of a white tee), or the item cut out of frame, is a miss.
${copy.productName ? `- The ${copy.productName} must be visible too.\n` : ""}
Score show_item 1-10: 10 = the named item is obvious at a glance; 6 = clearly there; 3 = only implied; 1 = absent or something else.
Respond with JSON only: {"show_item": <1-10>, "seen": "what the photo actually shows, a few words", "missing": "what's missing or wrong, a few words, empty if nothing"}`
}

const checkSchema = z.object({ show_item: z.number(), seen: z.string().optional(), missing: z.string().optional() })

/** How clearly the photo shows the slide's named item (1-10); null when it can't check. */
export async function slidePhotoAgreement(_brand: BrandRow, image: Buffer, mimeType: string, copy: SlideCopy, label: string): Promise<{ agree: number; fix: string; costUsd: number | null } | null> {
  if (!process.env.OPENAI_API_KEY) return null
  try {
    const res = await getOpenAIClient().chat.completions.create({
      model: MODELS.vision,
      max_completion_tokens: 400,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
      messages: [{
        role: "user",
        content: [
          { type: "text", text: buildPointCheckPrompt(copy) },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${image.toString("base64")}` } },
        ],
      }],
    }, { timeout: 30_000, maxRetries: 1 })
    const parsed = checkSchema.safeParse(JSON.parse(res.choices[0]?.message?.content ?? "{}"))
    if (!parsed.success) return null
    const agree = Math.max(1, Math.min(10, Math.round(parsed.data.show_item)))
    const fix = parsed.data.missing?.trim() ? `show ${copy.headline} clearly: ${parsed.data.missing.trim()} (the photo shows ${parsed.data.seen ?? "something else"})` : ""
    console.log(`[slide-photo-check] ${label}: show_item=${agree}${parsed.data.missing ? ` missing="${parsed.data.missing}"` : ""}`)
    return { agree, fix, costUsd: textCostUsd(MODELS.vision, toTextUsage(res.usage)) }
  } catch (err) {
    console.error(`[slide-photo-check] ${label}: couldn't check (keeping the photo):`, err instanceof Error ? err.message : err)
    return null
  }
}

type SlideOptions = Parameters<typeof generateCarouselSlideBackground>[0]
type SlideResult = Awaited<ReturnType<typeof generateCarouselSlideBackground>>

/**
 * generateCarouselSlideBackground with the slide's point, then the item
 * check and at most one regeneration: from the slide's own brief and point,
 * with the product photo (`reference`) as the reference image. `copy`
 * absent = no point, no check. Every billed attempt is kept on the result.
 */
export async function generateCheckedSlide(options: SlideOptions, copy: SlideCopy | null | undefined, label: string, canRetry: () => boolean = () => true, reference?: string | null): Promise<SlideResult & { agree?: number; checkCostUsd?: number | null }> {
  const point = copy?.headline?.trim() ? options.point ?? slidePoint(copy) : options.point
  const first = await generateCarouselSlideBackground({ ...options, point })
  if (!first.success || !copy?.headline?.trim()) return first
  const check = await slidePhotoAgreement(options.brand, first.buffer, first.mimeType, copy, label)
  if (!check || check.agree >= AGREE_MIN || !canRetry()) return { ...first, agree: check?.agree, checkCostUsd: check?.costUsd ?? null }
  console.log(`[slide-photo-check] ${label}: photo doesn't show the slide's point (show_item ${check.agree}) -- one more try`)
  const direction = [options.userDirection, `the photo must show exactly this: ${copy.headline}${copy.body ? ` -- ${copy.body}` : ""}${check.fix ? `. Fix: ${check.fix}` : ""}`].filter(Boolean).join(". ")
  // The retry describes the slide's point as the scene itself, with what its
  // own brief must show -- an abstract or mismatched brief is what made the
  // first photo miss it -- and the real product photo as its reference.
  const ref = options.productImageUrl ?? reference ?? null
  const scene = [`a real photograph that clearly shows: ${copy.headline}${copy.body ? ` -- ${copy.body}` : ""}`, options.visualBrief?.must_show && `it must show ${options.visualBrief.must_show}`].filter(Boolean).join(". ")
  const second = await generateCarouselSlideBackground({ ...options, point, visualBrief: undefined, productImageUrl: ref, customPrompt: ref ? `${options.customPrompt ?? ""} ${scene}`.trim() : scene, userDirection: direction })
  if (!second.success) return { ...first, attempts: [...first.attempts, ...second.attempts], agree: check.agree, checkCostUsd: check.costUsd }
  const recheck = await slidePhotoAgreement(options.brand, second.buffer, second.mimeType, copy, `${label} retry`)
  const cost = (check.costUsd ?? 0) + (recheck?.costUsd ?? 0)
  const better = !recheck || recheck.agree >= check.agree ? second : first
  return { ...better, attempts: [...first.attempts, ...second.attempts], agree: better === second ? recheck?.agree : check.agree, checkCostUsd: cost }
}
