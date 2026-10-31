import { z } from "zod"
import { MODELS } from "./models"
import { createTextCompletion } from "@/lib/ai/provider-fallback"

// Per-brand "lessons" memory (supabase/migrations/059_brand_lessons.sql):
// feedback notes distilled into a short list of durable, general rules.
// Everything here is fail-soft -- a lessons problem must never fail the
// rating/generation request it rides along with.

export const LESSON_SCOPES = ["all", "caption", "hook", "carousel", "story", "ad_copy", "image"] as const
export type LessonScope = (typeof LESSON_SCOPES)[number]

/** Which lessons scope each generateContent format reads (reel_script/blog_post have none). */
export const LESSON_SCOPE_FOR_FORMAT: Record<string, LessonScope | undefined> = {
  social_post: "caption",
  carousel: "carousel",
  story: "story",
  ad_copy: "ad_copy",
}
export type LessonKind = "avoid" | "do"

export type BrandLesson = {
  id: string
  scope: LessonScope
  kind: LessonKind
  rule: string
  evidence_count: number
  last_seen_at: string | null
}

const MAX_ACTIVE_LESSONS = 12

/** Active lessons for `scope` plus brand-wide ('all') ones, strongest evidence first. Fail-soft: [] on any error. */
export async function getActiveLessons(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  brandId: string,
  scope: LessonScope,
): Promise<BrandLesson[]> {
  try {
    const { data, error } = await supabase
      .from("brand_lessons")
      .select("id, scope, kind, rule, evidence_count, last_seen_at")
      .eq("brand_id", brandId)
      .eq("status", "active")
      .in("scope", scope === "all" ? ["all"] : [scope, "all"])
      .order("evidence_count", { ascending: false })
      .order("last_seen_at", { ascending: false, nullsFirst: false })
      .limit(MAX_ACTIVE_LESSONS) as { data: BrandLesson[] | null; error: { message: string } | null }
    if (error) {
      console.error(`[brand-brain] getActiveLessons failed for brand ${brandId} (non-fatal):`, error.message)
      return []
    }
    return data ?? []
  } catch (err) {
    console.error(`[brand-brain] getActiveLessons threw for brand ${brandId} (non-fatal):`, err instanceof Error ? err.message : err)
    return []
  }
}

/** Prompt block listing AVOID rules then DO rules; "" when there are none. */
export function formatLessonsBlock(lessons: BrandLesson[]): string {
  if (lessons.length === 0) return ""
  const avoid = lessons.filter((l) => l.kind === "avoid").map((l) => `- AVOID: ${l.rule}`)
  const doRules = lessons.filter((l) => l.kind === "do").map((l) => `- DO: ${l.rule}`)
  return [
    // Rules for HOW to write -- never what to write about (the topic above sets that).
    "BRAND LESSONS -- STYLE REFERENCE ONLY (never reuse their subject, products or claims). Learned from this brand's own past feedback; follow them as hard rules for how to write:",
    ...avoid,
    ...doRules,
  ].join("\n")
}

// The last "here is the JSON to return" instruction in a user prompt -- the
// lessons block goes right before it (after the brand context and the
// task, before the output schema).
const JSON_SCHEMA_ANCHOR = /\n(?:Respond with|Return this exact JSON|Return ONLY)/g

/**
 * Inserts formatLessonsBlock(lessons) just before the prompt's JSON-schema
 * instruction (appended at the end if there is none). No lessons = the
 * prompt is returned unchanged, byte for byte.
 */
export function withLessons(prompt: string, lessons: BrandLesson[] | undefined): string {
  const block = formatLessonsBlock(lessons ?? [])
  if (!block) return prompt
  let idx = -1
  for (const m of prompt.matchAll(JSON_SCHEMA_ANCHOR)) idx = m.index ?? idx
  if (idx === -1) return `${prompt}\n\n${block}`
  return `${prompt.slice(0, idx)}\n\n${block}\n${prompt.slice(idx)}`
}

/** "image"-scope lessons as plain rules for the image-prompt writer's constraints.lessons. */
export function imageLessonRules(lessons: BrandLesson[]): string[] {
  return lessons.map((l) => `${l.kind === "avoid" ? "Avoid" : "Do"}: ${l.rule}`)
}

const decisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("merge"), lesson_id: z.string() }),
  z.object({
    action: z.literal("create"),
    kind: z.enum(["avoid", "do"]),
    rule: z.string().trim().min(8).max(240),
    scope: z.enum(LESSON_SCOPES),
  }),
  z.object({ action: z.literal("skip") }),
])

export type LessonDecision = z.infer<typeof decisionSchema>

export type DistillInput = {
  brandId: string
  scope: Exclude<LessonScope, "all">
  rating: number
  note: string
  contentText: string
}

const DISTILL_SYSTEM_PROMPT = "You maintain a short list of durable writing rules for one brand, learned from the brand owner's own feedback on AI-generated social media content. Respond with valid JSON only."

function buildDistillPrompt(input: DistillInput, existing: BrandLesson[]): string {
  const label = input.scope.replace("_", " ")
  const lessonLines = existing.length
    ? existing.map((l) => `- ${l.id} | ${l.kind} | ${l.scope} | ${l.rule}`).join("\n")
    : "(none yet)"
  return `The brand owner rated this ${label} ${input.rating}/5 and wrote: "${input.note.slice(0, 1000)}"

The ${label} they rated:
"""
${input.contentText.slice(0, 2000) || "(text unavailable)"}
"""

The brand's current lessons (id | kind | scope | rule):
${lessonLines}

Decide exactly ONE action:
- "merge": the note expresses the same preference as an existing lesson above. Return {"action":"merge","lesson_id":"<an id from the list above>"}.
- "create": the note supports a NEW reusable rule not already covered. Return {"action":"create","kind":"avoid" or "do","rule":"...","scope":"${input.scope}" or "all"}.
- "skip": the note is too vague to act on, or isn't about how the content is written. ALWAYS skip a note about a factual error (a wrong price, a wrong product detail, a typo) -- facts come from the product data, not from lessons. Return {"action":"skip"}.

For "create":
- rule is ONE short, general, actionable sentence (under 25 words) that applies to future posts.
- Generalize the complaint. Never quote or paraphrase this specific ${label}, and never name its product or details.
- Only state what the note actually supports. Never invent a preference the owner didn't express.
- kind "avoid" for something to stop doing, "do" for something to start doing.
- scope "all" only when the note is clearly about the brand's writing in general (tone, language, emojis); otherwise "${input.scope}".`
}

/**
 * Asks MODELS.scoring what this feedback note means for the brand's
 * lessons, validated against the lessons actually sent. Returns null on
 * any failure (logged). Exported separately from distillLesson so the
 * backfill script's dry run can show decisions without writing them.
 */
export async function decideLesson(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  input: DistillInput,
): Promise<{ decision: LessonDecision; existing: BrandLesson[] } | null> {
  const tag = `[brand-brain] brand ${input.brandId} ${input.scope}`
  try {
    const existing = await getActiveLessons(supabase, input.brandId, input.scope)
    const { response: res } = await createTextCompletion(
      {
        model: MODELS.scoring,
        // GPT-OSS reasoning tokens count against max_tokens (lib/ai/models.ts).
        reasoning_effort: "low",
        max_tokens: 600,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: DISTILL_SYSTEM_PROMPT },
          { role: "user", content: buildDistillPrompt(input, existing) },
        ],
      },
      { stage: "brand_lessons", timeout: 10_000 },
    )
    const raw = res.choices[0]?.message?.content ?? ""
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      console.error(`${tag}: distill returned non-JSON (non-fatal):`, raw.slice(0, 200))
      return null
    }
    const parsed = decisionSchema.safeParse(json)
    if (!parsed.success) {
      console.error(`${tag}: distill returned an invalid decision (non-fatal):`, raw.slice(0, 200))
      return null
    }
    const decision = parsed.data
    if (decision.action === "merge" && !existing.some((l) => l.id === decision.lesson_id)) {
      console.error(`${tag}: distill tried to merge into unknown lesson ${decision.lesson_id} (non-fatal), skipping`)
      return null
    }
    if (decision.action === "create" && decision.scope !== "all" && decision.scope !== input.scope) {
      decision.scope = input.scope
    }
    return { decision, existing }
  } catch (err) {
    console.error(`${tag}: distill failed (non-fatal):`, err instanceof Error ? err.message : err)
    return null
  }
}

/** Writes a decideLesson decision: merge bumps evidence_count/last_seen_at, create inserts a 'feedback_note' lesson. */
export async function applyLessonDecision(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  brandId: string,
  decision: LessonDecision,
  existing: BrandLesson[],
): Promise<void> {
  if (decision.action === "skip") return
  if (decision.action === "merge") {
    const lesson = existing.find((l) => l.id === decision.lesson_id)
    if (!lesson) return
    // Read-modify-write on the count we just read -- fine at human
    // rating frequency (one owner rating one item at a time).
    const { error } = await supabase
      .from("brand_lessons")
      .update({ evidence_count: lesson.evidence_count + 1, last_seen_at: new Date().toISOString() })
      .eq("id", lesson.id)
      .eq("brand_id", brandId)
    if (error) console.error(`[brand-brain] merge into lesson ${lesson.id} failed (non-fatal):`, error.message)
    return
  }
  const { error } = await supabase.from("brand_lessons").insert({
    brand_id: brandId,
    scope: decision.scope,
    kind: decision.kind,
    rule: decision.rule,
    source: "feedback_note",
  })
  if (error) console.error(`[brand-brain] lesson insert failed for brand ${brandId} (non-fatal):`, error.message)
}

/** Turns one feedback note into a merged or new lesson (or nothing). Never throws. */
export async function distillLesson(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  input: DistillInput,
): Promise<void> {
  try {
    const result = await decideLesson(supabase, input)
    if (!result) return
    await applyLessonDecision(supabase, input.brandId, result.decision, result.existing)
  } catch (err) {
    console.error(`[brand-brain] distillLesson failed for brand ${input.brandId} (non-fatal):`, err instanceof Error ? err.message : err)
  }
}

// ─── Brand art direction (brands.brand_brain.art_direction) ──────────────────
// One brand-level visual identity every image and visual brief follows --
// derived once by lib/ai/art-direction.ts and cached inside the existing
// brand_brain JSONB (no migration). Absent = today's behaviour.

const HEX = /^#[0-9a-fA-F]{6}$/

export const artDirectionSchema = z.object({
  /** deep = darkest (text, strips); base = background / light; accent = the
   * brand's signature colour; pop = a contrasting highlight. */
  palette: z.object({ deep: z.string().regex(HEX), base: z.string().regex(HEX), accent: z.string().regex(HEX), pop: z.string().regex(HEX) }),
  /** 3-5 words. */
  mood: z.string().min(1).max(80),
  /** 3-6 concrete props / textures from this brand's world. */
  motifs: z.array(z.string().min(1).max(80)).min(1).max(6),
  /** One line: the Indian setting and audience it lives in. */
  cultural_context: z.string().min(1).max(300),
  /** One line: lighting, saturation, framing. */
  photo_style: z.string().min(1).max(300),
  /** Visual clichés never to use (always includes the generic beige desk / lamp / chai-mug scene). */
  avoid: z.array(z.string().min(1).max(160)).min(1).max(10),
  /** Hash of the brand fields it was derived from -- a change means re-derive. */
  source_hash: z.string().optional(),
  /** "brand_colors" = palette built from the brand's own colours; "invented" = it had none. */
  palette_source: z.enum(["brand_colors", "invented"]).optional(),
  derived_at: z.string().optional(),
  /** Edited on the brand page ("Brand look"): never re-derived automatically,
   * whatever changes -- only the explicit "Refresh from brand" replaces it. */
  edited_by_user: z.boolean().optional(),
  edited_at: z.string().optional(),
})

export type ArtDirection = z.infer<typeof artDirectionSchema>

/** The brand's cached art direction, or null (none yet, or invalid). Never throws. */
export function artDirectionFrom(brand: { brand_brain?: unknown } | null | undefined): ArtDirection | null {
  const raw = brand?.brand_brain && typeof brand.brand_brain === "object" ? (brand.brand_brain as { art_direction?: unknown }).art_direction : undefined
  if (!raw) return null
  const parsed = artDirectionSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}
