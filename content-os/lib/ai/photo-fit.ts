import { z } from "zod"
import type { BrandRow } from "@/types/database"
import { MODELS } from "./models"
import { createTextCompletion } from "./provider-fallback"
import type { VisualBrief } from "./visual-brief"
import { loadBrandPhotos, markBrandPhotosUsed, rankPhotoCandidates, type BrandPhoto, type PhotoKind } from "@/lib/brand-photos"

/**
 * A brand photo is used for a post or story frame only when it fits that
 * item: the top FIT_CANDIDATES photos (rankPhotoCandidates -- never another
 * product's photo) are scored 1-5 against the item's visual brief and copy
 * in ONE MODELS.scoring call, from each photo's description (migration 066).
 * The best one is used if it scores MIN_PHOTO_FIT or more; otherwise the
 * image is generated from the brief, as before. A photo with no description
 * yet can't be judged, so it is never used. Fail-soft: any error = no photo.
 */

export const FIT_CANDIDATES = 6
export const MIN_PHOTO_FIT = 4

/** What one post / frame needs its photo to show. */
export interface PhotoFitItem {
  /** The visual brief (what the image must show), or the image prompt without one. */
  brief: string
  /** The copy on / with the image. */
  copy: string
}

export function photoFitItem(visual: VisualBrief | null | undefined, fallbackScene: string | null | undefined, copy: (string | null | undefined)[]): PhotoFitItem {
  const brief = visual
    ? [visual.must_show, visual.left && `left: ${visual.left}`, visual.right && `right: ${visual.right}`].filter(Boolean).join(" / ")
    : (fallbackScene ?? "").trim()
  return { brief: brief.slice(0, 600), copy: copy.filter((c): c is string => !!c?.trim()).join(" | ").slice(0, 400) }
}

export interface FitScore {
  id: string
  fit: number
  reason: string
}

/** The scoring prompt -- exported for scripts/test-photo-fit.ts. */
export function buildPhotoFitPrompt(item: PhotoFitItem, candidates: Pick<BrandPhoto, "description">[], productName?: string | null): string {
  return `Score how well each of the brand's own photos would work as the image for this social media post, 1-5.

POST
${productName ? `Product: ${productName}\n` : ""}The image must show: ${item.brief || "(no brief -- judge from the copy)"}
Copy: ${item.copy || "(none)"}

PHOTOS (what each one shows)
${candidates.map((c, i) => `${i}: ${c.description}`).join("\n")}

SCALE
5 = shows exactly what the post describes: the same product, subject and kind of moment.
4 = a good fit: the right product (or, with no product, the right subject) in a scene that supports the copy.
3 = related but off: the right category, a different scene, action or mood.
2 = weak: only loosely connected.
1 = wrong: a different product than the post is about, or unrelated to the post.
A photo of a different product, or of something the post never mentions, is never above 2.

Respond with JSON only: {"scores": [{"photo": <number>, "fit": <1-5>, "reason": "a few words"}]} -- one entry per photo.`
}

const responseSchema = z.object({
  scores: z.array(z.object({ photo: z.number().int(), fit: z.number(), reason: z.string().optional() })),
})

/** Fit 1-5 for every candidate in one call (an undescribed photo scores 1). [] on failure. */
export async function scorePhotoFit(item: PhotoFitItem, candidates: Pick<BrandPhoto, "id" | "description">[], productName?: string | null): Promise<FitScore[]> {
  const described = candidates.filter((c) => !!c.description?.trim())
  if (described.length === 0) return candidates.map((c) => ({ id: c.id, fit: 1, reason: "no description yet" }))
  try {
    const { response } = await createTextCompletion({
      model: MODELS.scoring,
      reasoning_effort: "low",
      max_tokens: 900,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: buildPhotoFitPrompt(item, described, productName) }],
    }, { stage: "photo_fit", timeout: 15_000 })
    const parsed = responseSchema.safeParse(JSON.parse(response.choices[0]?.message?.content ?? "{}"))
    if (!parsed.success) return []
    const byIndex = new Map(parsed.data.scores.map((s) => [s.photo, s]))
    return candidates.map((c) => {
      const i = described.indexOf(c as (typeof described)[number])
      const s = i >= 0 ? byIndex.get(i) : undefined
      return { id: c.id, fit: s ? Math.max(1, Math.min(5, Math.round(s.fit))) : 1, reason: s?.reason ?? (i >= 0 ? "not scored" : "no description yet") }
    })
  } catch (err) {
    console.error("[photo-fit] scoring failed (generating instead):", err instanceof Error ? err.message : err)
    return []
  }
}

/** A post may reuse a brand photo at most this many times per brand per 7 days. */
export const POST_WEEKLY_CAP = 2

/** Photos posts have already used POST_WEEKLY_CAP times in the last 7 days ("photo_used" content events). Never throws. */
export async function photosAtWeeklyCap(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  brandId: string,
): Promise<string[]> {
  try {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const { data, error } = await db.from("content_events").select("meta").eq("brand_id", brandId).eq("event", "photo_used").gte("created_at", since).limit(2000)
    if (error) return []
    const counts = new Map<string, number>()
    for (const row of (data ?? []) as { meta: { photo_id?: string; format?: string } | null }[]) {
      if (row.meta?.format !== "post" || !row.meta.photo_id) continue
      counts.set(row.meta.photo_id, (counts.get(row.meta.photo_id) ?? 0) + 1)
    }
    return [...counts].filter(([, n]) => n >= POST_WEEKLY_CAP).map(([id]) => id)
  } catch {
    return []
  }
}

/**
 * One photo (or null = generate) per item, in order: each item scores its
 * own top candidates and takes the best that fits, never a photo an earlier
 * item (or `exclude`) already has -- so a story sequence never repeats one.
 * Chosen photos are marked used. Never throws.
 */
export async function chooseFittingPhotos(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  brand: Pick<BrandRow, "id">,
  opts: {
    productId?: string | null; productName?: string | null; kinds: PhotoKind[]; items: PhotoFitItem[]; exclude?: string[]; label: string
    /** "post": the same photo at most POST_WEEKLY_CAP times per brand per 7 days across posts. */
    format?: "post" | "carousel" | "story"
  },
): Promise<((BrandPhoto & { fit: number }) | null)[]> {
  try {
    const rows = await loadBrandPhotos(db, brand, opts.kinds)
    // Within one carousel / story a photo is used once (excluded as it's
    // picked); across posts, at most twice a week.
    const used = new Set([...(opts.exclude ?? []), ...(opts.format === "post" ? await photosAtWeeklyCap(db, brand.id) : [])])
    const chosen: ((BrandPhoto & { fit: number }) | null)[] = []
    for (const [i, item] of opts.items.entries()) {
      const candidates = rankPhotoCandidates(rows, { productId: opts.productId, kinds: opts.kinds, exclude: [...used] }).slice(0, FIT_CANDIDATES)
      if (candidates.length === 0) {
        chosen.push(null)
        continue
      }
      const scores = await scorePhotoFit(item, candidates, opts.productName)
      const best = scores.reduce<FitScore | null>((top, s) => (!top || s.fit > top.fit ? s : top), null)
      const photo = best && best.fit >= MIN_PHOTO_FIT ? candidates.find((c) => c.id === best.id) ?? null : null
      if (photo && best) {
        used.add(photo.id)
        chosen.push({ ...photo, fit: best.fit })
        console.log(`[photo-fit] ${opts.label} item ${i + 1}: brand photo ${photo.id} fit=${best.fit} (${best.reason}; ${candidates.length} candidates)`)
      } else {
        chosen.push(null)
        console.log(`[photo-fit] ${opts.label} item ${i + 1}: no photo fits (best fit=${best?.fit ?? "none"}; ${candidates.length} candidates) -- generating`)
      }
    }
    const picked = chosen.filter((p): p is BrandPhoto & { fit: number } => !!p)
    if (picked.length > 0) await markBrandPhotosUsed(db, picked, opts.format ?? "post")
    return chosen
  } catch (err) {
    console.error(`[photo-fit] ${opts.label}: photo choice failed (generating instead):`, err instanceof Error ? err.message : err)
    return opts.items.map(() => null)
  }
}
