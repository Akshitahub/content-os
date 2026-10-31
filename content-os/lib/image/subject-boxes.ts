import sharp from "sharp"
import { z } from "zod"
import { MODELS, getOpenAIClient } from "@/lib/ai/models"

/**
 * Where the subject is in a photo -- faces, torsos, hips, the product --
 * so text is never set on it (lib/image/story-frame-compositor.ts places
 * text only in the free space around these boxes).
 *
 * Detected once per photo: a brand photo at classification time (stored in
 * brand_images.subject_boxes, migration 067), a generated image right after
 * generation (a small JSON sidecar next to it in storage). The detector is
 * one vision call; without one (no key / credits) a local pass finds the
 * subject against a plain studio background, or the busiest part of a scene.
 * Boxes are fractions of the source image (0-1).
 */

export const SUBJECT_LABELS = ["face", "torso", "hips", "person", "product", "subject"] as const
export type SubjectLabel = (typeof SUBJECT_LABELS)[number]
export interface SubjectBox { x: number; y: number; w: number; h: number; label: SubjectLabel }

const boxSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number(), label: z.enum(SUBJECT_LABELS).catch("subject") })
export const subjectBoxesSchema = z.array(boxSchema).max(12)

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
function normBox(b: { x: number; y: number; w: number; h: number; label?: SubjectLabel }): SubjectBox | null {
  const x = clamp01(b.x), y = clamp01(b.y)
  const w = clamp01(Math.min(b.w, 1 - x)), h = clamp01(Math.min(b.h, 1 - y))
  return w > 0.01 && h > 0.01 ? { x, y, w, h, label: b.label ?? "subject" } : null
}

/** Saved boxes (a DB column or a sidecar) -> valid boxes, or null when absent / malformed. */
export function parseSubjectBoxes(raw: unknown): SubjectBox[] | null {
  const parsed = subjectBoxesSchema.safeParse(raw)
  return parsed.success ? parsed.data.map(normBox).filter((b): b is SubjectBox => !!b) : null
}

// ─── Local detection ──────────────────────────────────────────────────────

const SAMPLE_W = 128

/**
 * The photo against its own border: a studio / catalogue shot has a nearly
 * uniform border (white, grey, any flat colour). Returns the border colour
 * when it is plain, else null.
 */
export async function plainBackgroundColor(buf: Buffer): Promise<[number, number, number] | null> {
  const { data, info } = await sharp(buf).rotate().resize(SAMPLE_W, SAMPLE_W, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const px = (x: number, y: number) => { const i = (y * info.width + x) * 3; return [data[i]!, data[i + 1]!, data[i + 2]!] as const }
  const border: (readonly [number, number, number])[] = []
  for (let x = 0; x < info.width; x++) border.push(px(x, 0), px(x, 1), px(x, info.height - 1), px(x, info.height - 2))
  for (let y = 0; y < info.height; y++) border.push(px(0, y), px(1, y), px(info.width - 1, y), px(info.width - 2, y))
  const median = [0, 1, 2].map((c) => border.map((p) => p[c]!).sort((a, b) => a - b)[border.length >> 1]!) as [number, number, number]
  const near = border.filter((p) => Math.max(...p.map((v, c) => Math.abs(v - median[c]!))) <= 22).length / border.length
  return near >= 0.82 ? median : null
}

/** Connected regions of `mask` (w x h) bigger than `minArea` cells, as cell boxes. */
function components(mask: Uint8Array, w: number, h: number, minArea: number): { x0: number; y0: number; x1: number; y1: number; area: number }[] {
  const seen = new Uint8Array(w * h)
  const out: { x0: number; y0: number; x1: number; y1: number; area: number }[] = []
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || seen[start]) continue
    const stack = [start]
    seen[start] = 1
    let x0 = w, y0 = h, x1 = 0, y1 = 0, area = 0
    while (stack.length) {
      const i = stack.pop()!
      const x = i % w, y = (i / w) | 0
      area++
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && mask[j] && !seen[j]) { seen[j] = 1; stack.push(j) }
      }
    }
    if (area >= minArea) out.push({ x0, y0, x1: x1 + 1, y1: y1 + 1, area })
  }
  return out
}

/**
 * No vision call: on a plain background, everything that isn't background
 * (people and products, shadows included -- conservative); otherwise the
 * busiest connected area of the photo (edges / detail), at least a third of
 * each side. Never throws -- an unreadable image gives [].
 */
export async function detectSubjectsLocal(buf: Buffer): Promise<SubjectBox[]> {
  try {
    const bg = await plainBackgroundColor(buf)
    const { data, info } = await sharp(buf).rotate().resize({ width: SAMPLE_W }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const W = info.width, H = info.height
    if (bg) {
      const mask = new Uint8Array(W * H)
      for (let i = 0; i < W * H; i++) {
        const d = Math.max(Math.abs(data[i * 3]! - bg[0]), Math.abs(data[i * 3 + 1]! - bg[1]), Math.abs(data[i * 3 + 2]! - bg[2]))
        mask[i] = d > 26 ? 1 : 0
      }
      const parts = components(mask, W, H, Math.round(W * H * 0.004))
      return parts.map((c) => normBox({ x: c.x0 / W, y: c.y0 / H, w: (c.x1 - c.x0) / W, h: (c.y1 - c.y0) / H, label: "subject" })).filter((b): b is SubjectBox => !!b)
    }
    // A scene: gradient energy on a coarse grid, the region around its peak.
    const G = 12
    const energy = new Float64Array(G * G)
    const lum = (x: number, y: number) => { const i = (y * W + x) * 3; return 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]! }
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const g = Math.abs(lum(x + 1, y) - lum(x - 1, y)) + Math.abs(lum(x, y + 1) - lum(x, y - 1))
        energy[Math.min(G - 1, ((y / H) * G) | 0) * G + Math.min(G - 1, ((x / W) * G) | 0)] += g
      }
    }
    const max = Math.max(...energy)
    if (!(max > 0)) return []
    const mask = new Uint8Array(G * G)
    for (let i = 0; i < G * G; i++) mask[i] = energy[i]! >= max * 0.55 ? 1 : 0
    const peak = energy.indexOf(max)
    const part = components(mask, G, G, 1).find((c) => { const px = peak % G, py = (peak / G) | 0; return px >= c.x0 && px < c.x1 && py >= c.y0 && py < c.y1 })
    if (!part) return []
    // At least a third of each side, centred on what was found.
    const cx = (part.x0 + part.x1) / 2 / G, cy = (part.y0 + part.y1) / 2 / G
    const w = Math.max((part.x1 - part.x0) / G, 1 / 3), h = Math.max((part.y1 - part.y0) / G, 1 / 3)
    const box = normBox({ x: Math.max(0, cx - w / 2), y: Math.max(0, cy - h / 2), w, h, label: "subject" })
    return box ? [box] : []
  } catch {
    return []
  }
}

// ─── The vision detector ──────────────────────────────────────────────────

const visionSchema = z.object({ subjects: z.array(z.object({ label: z.string(), box: z.tuple([z.number(), z.number(), z.number(), z.number()]) })).max(12) })

/** One vision call: boxes for each face, torso, hips and product. Null when it can't be made. */
export async function detectSubjectsVision(imageUrl: string): Promise<SubjectBox[] | null> {
  if (!process.env.OPENAI_API_KEY) return null
  try {
    const res = await getOpenAIClient().chat.completions.create({
      model: MODELS.vision,
      reasoning_effort: "low",
      max_completion_tokens: 500,
      response_format: { type: "json_object" },
      messages: [{
        role: "user",
        content: [
          { type: "text", text: `Text will be set on this photo and must never cover the subject. Return a bounding box for every person's face, torso and hips (separately), and for every product. Boxes are [x, y, width, height] as fractions of the image (0-1), generous rather than tight. JSON only: {"subjects": [{"label": "face | torso | hips | product", "box": [x, y, w, h]}]}` },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      }],
    }, { timeout: 25_000, maxRetries: 1 })
    const parsed = visionSchema.safeParse(JSON.parse(res.choices[0]?.message?.content ?? "{}"))
    if (!parsed.success) return null
    return parsed.data.subjects
      .map((s) => normBox({ x: s.box[0], y: s.box[1], w: s.box[2], h: s.box[3], label: (SUBJECT_LABELS as readonly string[]).includes(s.label) ? s.label as SubjectLabel : "subject" }))
      .filter((b): b is SubjectBox => !!b)
  } catch (err) {
    console.error("[subject-boxes] vision detection failed (using the local pass):", err instanceof Error ? err.message : err)
    return null
  }
}

/** The detector: the vision call, else the local pass. Never throws. */
export async function detectSubjects(imageUrl: string, bytes: Buffer): Promise<SubjectBox[]> {
  return (await detectSubjectsVision(imageUrl)) ?? detectSubjectsLocal(bytes)
}

// ─── Stored boxes ─────────────────────────────────────────────────────────

const STORAGE_PUBLIC = /\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/
const sidecarUrl = (url: string) => (STORAGE_PUBLIC.test(url.split("?")[0]!) ? `${url.split("?")[0]}.subjects.json` : null)

/**
 * Generated images: detect once right after generation and store the boxes
 * next to the image (<path>.subjects.json in the same bucket). Never throws.
 */
export async function recordGeneratedSubjects(publicUrl: string, bytes: Buffer): Promise<void> {
  try {
    const m = publicUrl.split("?")[0]!.match(STORAGE_PUBLIC)
    if (!m) return
    const boxes = await detectSubjects(publicUrl, bytes)
    const { createAdminClient } = await import("@/lib/supabase/server")
    const admin = await createAdminClient()
    await admin.storage.from(m[1]!).upload(`${decodeURIComponent(m[2]!)}.subjects.json`, Buffer.from(JSON.stringify(boxes)), { contentType: "application/json", upsert: true })
    remember(publicUrl, boxes)
  } catch (err) {
    console.error("[subject-boxes] couldn't store a generated image's boxes (detected at render instead):", err instanceof Error ? err.message : err)
  }
}

const cache = new Map<string, SubjectBox[]>()
function remember(url: string, boxes: SubjectBox[]) {
  if (url.startsWith("data:")) return
  cache.set(url, boxes)
  if (cache.size > 300) cache.delete(cache.keys().next().value!)
}

/** Boxes saved for this URL: the brand photo's column, else the generated image's sidecar. */
async function storedBoxes(url: string): Promise<SubjectBox[] | null> {
  if (!/^https?:\/\//.test(url) || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  try {
    const { createAdminClient } = await import("@/lib/supabase/server")
    const admin = await createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin.from("brand_images") as any).select("subject_boxes").eq("url", url).limit(1).maybeSingle() as { data: { subject_boxes?: unknown } | null; error: unknown }
    const fromRow = !error ? parseSubjectBoxes(data?.subject_boxes) : null
    if (fromRow) return fromRow
  } catch {
    // Before migration 067 (no column) or no database: the sidecar / the local pass.
  }
  const side = sidecarUrl(url)
  if (!side) return null
  try {
    const res = await fetch(side, { signal: AbortSignal.timeout(5_000) })
    return res.ok ? parseSubjectBoxes(await res.json()) : null
  } catch {
    return null
  }
}

/**
 * The subject boxes for a photo about to be drawn on: given ones, else the
 * stored ones, else the local pass (no API call at render time). Cached per
 * URL. Never throws.
 */
export async function resolveSubjectBoxes(url: string | null | undefined, bytes: Buffer, given?: unknown): Promise<SubjectBox[]> {
  const explicit = given != null ? parseSubjectBoxes(given) : null
  if (explicit) return explicit
  if (url && cache.has(url)) return cache.get(url)!
  const boxes = (url ? await storedBoxes(url) : null) ?? await detectSubjectsLocal(bytes)
  if (url) remember(url, boxes)
  return boxes
}
