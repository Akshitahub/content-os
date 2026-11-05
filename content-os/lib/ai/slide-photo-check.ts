import { z } from "zod"
import type { BrandRow } from "@/types/database"
import { MODELS, getTextClientFor, visionReasoning } from "./models"
import { visionImageFromBuffer } from "./vision-image"
import { textCostUsd, toTextUsage } from "./pricing"
import { generateCarouselSlideBackground, type SlidePoint } from "./carousel-slide-background"

/**
 * A carousel slide's photo must show THAT slide's point -- the specific
 * item its headline names: "White tee" = the chinos worn with a white tee,
 * "Accessories" = visible accessories, not the catalogue shot's own outfit.
 * Every slide photo is generated with its point (with a product reference,
 * only the product is taken from it), then one focused vision call checks
 * the photo shows the named item (show_item, 1-10). Below AGREE_MIN the
 * score is logged and the photo kept -- no second image is generated. No
 * key / an error = the photo, unchecked. Brand
 * photos are matched per slide by photo-fit (lib/ai/photo-fit.ts), which
 * applies the same rule to its descriptions.
 */

export const AGREE_MIN = 6

/**
 * A middle slide whose photo doesn't show its point goes type-led instead (its words over a close detail of the product photo,
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
  if (!process.env.GROQ_API_KEY) return null
  try {
    const res = await getTextClientFor(MODELS.vision).chat.completions.create({
      model: MODELS.vision,
      max_completion_tokens: 1200,
      ...visionReasoning("low"),
      response_format: { type: "json_object" },
      messages: [{
        role: "user",
        content: [
          { type: "text", text: buildPointCheckPrompt(copy) },
          { type: "image_url", image_url: { url: await visionImageFromBuffer(image) } },
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
 * check -- logged and returned as `agree`, never a second image: a retry
 * doubled the image spend for one slide. A middle slide that still misses
 * its point is made type-led by the caller (photoMissesPoint). `copy`
 * absent = no point, no check. The billed attempts are kept on the result.
 */
export async function generateCheckedSlide(options: SlideOptions, copy: SlideCopy | null | undefined, label: string): Promise<SlideResult & { agree?: number; checkCostUsd?: number | null }> {
  const point = copy?.headline?.trim() ? options.point ?? slidePoint(copy) : options.point
  const first = await generateCarouselSlideBackground({ ...options, point })
  if (!first.success || !copy?.headline?.trim()) return first
  const check = await slidePhotoAgreement(options.brand, first.buffer, first.mimeType, copy, label)
  if (check && check.agree < AGREE_MIN) console.log(`[slide-photo-check] ${label}: photo doesn't show the slide's point (show_item ${check.agree}) -- kept, no retry`)
  return { ...first, agree: check?.agree, checkCostUsd: check?.costUsd ?? null }
}
