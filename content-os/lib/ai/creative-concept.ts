import { MODELS } from "./models"
import { createTextCompletion } from "./provider-fallback"
import { buildBrandContext } from "./prompts"
import { requestImagePromptStream, type ImagePromptConstraints, type ImagePromptFlow } from "./image-prompt-writer"
import type { BrandRow, ProductRow } from "@/types/database"
import { CRITIC_CRITERIA, CRITIC_PASS, type CriticCriterionId } from "@/lib/design/critic-scores"

/**
 * The creative concept stage -- everything that improves an image happens
 * HERE, on Groq text models, before the one image call:
 *
 *   1. MODELS.creative proposes 3 concepts: a MOMENT that tells a story with
 *      a hook, not a well-lit picture of nothing happening.
 *   2. A separate MODELS.scoring call scores all 3 against CRITIC_CRITERIA
 *      (lib/design/critic-scores.ts, one source of truth). Best below
 *      CRITIC_PASS: the scorer's reasons go back and 3 new concepts are
 *      made. At most 2 rounds; the best of everything is kept.
 *   3. The image-prompt writer turns the winner into the prompt (the
 *      concept is its creative core, with the criteria as a checklist).
 *   4. A review call checks the prompt against the concept and the
 *      criteria; a failing prompt is rewritten once.
 *
 * Used by Full Post (/api/v1/ai/image-prompt/write), every AI carousel slide
 * and story frame (their slide-image routes), Ad Maker (one concept per
 * variant), the Images tab, calendar regenerate and Autopilot. "Make it
 * better" passes the critic's fix in, so the next version gets a new
 * concept. Never throws: null when a step fails, and callers write the
 * prompt exactly as before.
 */

export const CONCEPT_DEVICES = [
  "relatable moment", "mid-action", "reveal", "visual metaphor", "humour/irony", "direct address",
  "tension before the moment", "aspiration", "behind the scenes", "social proof", "in-scene text", "product as hero in use",
] as const

export type ConceptFormat = "post" | "story_frame" | "carousel_cover" | "carousel_slide" | "ad" | "image"

export interface CreativeConcept {
  /** What is happening in this one frame: ONE subject, ONE action, ONE moment (<= 40 words). */
  story: string
  /** Why a thumb stops on it (<= 15 words). */
  hook: string
  emotion: string
  device: string
  /** The scorer's 1-10 per criterion (5 when it gave none). */
  scores: Record<CriticCriterionId, number>
  /** The predicted overall, weighted like the critic's. */
  score: number
  /** The scorer's reasons -- fed back when a round falls short. */
  reasons: string[]
  /** Words printed on a real prop in the scene, only for the in-scene text
   * / direct-address-with-a-sign devices on a post. */
  in_scene_text: string | null
}

/** The devices that may carry their own words in the picture. */
const TEXT_DEVICES = ["in-scene text", "direct address"]
const IN_SCENE_TEXT_MAX_WORDS = 5
const MAX_ROUNDS = 2

export interface ConceptInput {
  product?: Pick<ProductRow, "name" | "description" | "key_benefits"> | null
  /** Full Post's content angle ("auto" / omitted = let SocioPosts decide), or an ad variant's angle. */
  angle?: string | null
  hook: string
  caption?: string | null
  format: ConceptFormat
  /** Slides / frames: which one this is. */
  role?: "hook" | "cta" | "body" | null
  /** The brand's active lessons, as plain rules. */
  lessons?: string[]
  /** "Make it better": the critic's fix on the last version. */
  fix?: string | null
  /** Ad Maker: one concept per variant, in this order (no picking across variants). */
  variants?: { angle: string; headline: string }[]
}

const ANGLE_GUIDANCE = `Each content angle tells its story differently:
- Problem & solution: the lived problem moment, or the relief right after.
- Quick tip / how-to: the tip happening, hands mid-action.
- Myth / contrarian: a visual surprise that breaks the expectation.
- Launch / offer: a reveal, unboxing, gifting or first-use moment with the product as hero.
- Let SocioPosts decide: choose the angle and device that best fit the hook.`

const ANGLE_LABEL: Record<string, string> = {
  problem_solution: "Problem & solution", quick_tip: "Quick tip / how-to", myth_contrarian: "Myth / contrarian", launch_offer: "Launch / offer",
  pain_point: "Problem & solution (pain point)", benefit: "Launch / offer (benefit)", proof: "Social proof", demonstration: "Quick tip / how-to (demonstration)", objection: "Myth / contrarian (objection)",
}

const FORMAT_LABEL: Record<ConceptFormat, string> = {
  post: "a single Instagram feed post image (4:5)",
  story_frame: "one frame of an Instagram story (9:16)",
  carousel_cover: "the cover slide of an Instagram carousel",
  carousel_slide: "one slide of an Instagram carousel",
  ad: "a Meta ad image",
  image: "a standalone brand image",
}

const ROLE_LABEL = { hook: "the opening -- it must stop the scroll", cta: "the closing one -- it makes the viewer want to act", body: "a middle one -- it shows this slide's own point" }

const criteriaList = () => CRITIC_CRITERIA.map((c) => `${c.id} (${c.label}): ${c.ask}`).join("\n")

function conceptSystemPrompt(brand: BrandRow, count: number, variants: boolean, allowText: boolean): string {
  return `You are the creative director of a top Instagram content studio for Indian D2C brands. Before any image is made you invent the IDEA. Great posts are a MOMENT that tells a story with a hook: you get the point in one second and feel something (curiosity, recognition, a laugh, desire). A well-lit picture of nothing happening is a failure.

${buildBrandContext(brand)}

${ANGLE_GUIDANCE}

Storytelling devices (a toolbox, none mandatory): ${CONCEPT_DEVICES.join(", ")}.

Rules:
- One photographable frame: ONE subject, ONE action, ONE moment -- who is in it, doing what, at what instant.
- People only when they serve the story, and then the brand's own audience (who they are comes from the brand and audience above, never a fixed default). Product-only concepts are fine when the product is the story.
- Only products, claims and facts from the brand context and the copy -- never invent an offer, number or result.
${allowText
    ? `- "in_scene_text": ONLY for the in-scene text device, or direct address with a sign or prop: the exact words printed on that real object (max ${IN_SCENE_TEXT_MAX_WORDS} plain, common words -- no brand-new spellings, names or jargon -- spelled correctly, no @handles or URLs). Otherwise null.`
    : `- "in_scene_text": always null (this format's words are added on top).`}
- Banned: a static "product on a table" or "person smiling at a laptop" stock setup with nothing happening; collages; split frames or two halves; random decorative stickers.

${variants ? `Write exactly ${count} concepts, concept N for variant N (its own angle and headline), each a different idea.` : `Write ${count} genuinely different concepts (different moments and devices, not rewordings).`}

Respond with valid JSON only, no markdown:
{"concepts": [{"story": "max 40 words", "hook": "max 15 words", "emotion": "one feeling", "device": "one of the devices", "in_scene_text": null}]}`
}

function conceptUserPrompt(input: ConceptInput, feedback: string | null): string {
  const angle = input.angle && input.angle !== "auto" ? ANGLE_LABEL[input.angle] ?? input.angle : "Let SocioPosts decide"
  const lines = [
    `Format: ${FORMAT_LABEL[input.format]}${input.role ? `, ${ROLE_LABEL[input.role]}` : ""}`,
    `Content angle: ${angle}`,
    `Hook: ${input.hook}`,
  ]
  if (input.caption?.trim()) lines.push(`Caption: ${input.caption.trim().slice(0, 1200)}`)
  if (input.product) {
    lines.push(`Product: ${input.product.name}${input.product.description ? ` -- ${input.product.description.slice(0, 300)}` : ""}`)
    if (input.product.key_benefits?.length) lines.push(`Key benefits: ${input.product.key_benefits.join(", ")}`)
  }
  if (input.variants?.length) lines.push(`Variants:\n${input.variants.map((v, i) => `${i + 1}. angle ${ANGLE_LABEL[v.angle] ?? v.angle}, headline "${v.headline}"`).join("\n")}`)
  if (input.lessons?.length) lines.push(`What this brand has learned from its own feedback: ${input.lessons.join("; ")}`)
  if (input.fix?.trim()) lines.push(`The last version's critic said: ${input.fix.trim().slice(0, 400)}\nInvent NEW concepts that fix this -- a different moment, not the same scene reworded.`)
  if (feedback) lines.push(`Your last concepts fell short. The scorer said:\n${feedback}\nWrite 3 NEW, stronger concepts that fix this.`)
  return lines.join("\n")
}

const words = (s: string, max: number) => s.replace(/\s+/g, " ").trim().split(" ").slice(0, max).join(" ")
const clamp = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.max(1, Math.min(10, Math.round(n))) : 5)

/** Weighted like the critic's overall (CRITIC_CRITERIA weights). Exported for tests. */
export function weightedScore(scores: Record<CriticCriterionId, number>): number {
  let sum = 0
  let total = 0
  for (const c of CRITIC_CRITERIA) {
    sum += scores[c.id] * c.weight
    total += c.weight
  }
  return Math.round((sum / total) * 10) / 10
}

/**
 * The words a concept may carry: only for a text device, <= 5 plain words
 * (letters, digits and simple punctuation), no handles / URLs -- the image
 * model spells short common words reliably, not long or unusual ones.
 */
function sanitizeInSceneText(raw: unknown, device: string): string | null {
  if (typeof raw !== "string" || !TEXT_DEVICES.some((d) => device.includes(d))) return null
  const text = raw.replace(/["“”]/g, "").replace(/\s+/g, " ").trim()
  if (!text || /@|https?:|www\.|\.com\b/i.test(text) || text.split(" ").length > IN_SCENE_TEXT_MAX_WORDS) return null
  if (!/^[\p{L}\p{N}\s.,!?'&-]+$/u.test(text) || text.split(" ").some((w) => w.length > 12)) return null
  return text
}

const unscored = () => Object.fromEntries(CRITIC_CRITERIA.map((c) => [c.id, 5])) as Record<CriticCriterionId, number>

/** The model's JSON -> concepts (malformed ones dropped), unscored. Exported for tests. */
export function parseConcepts(raw: string, allowText = true): CreativeConcept[] {
  try {
    const data = JSON.parse(raw.replace(/```json\n?|```\n?/g, "").trim()) as { concepts?: unknown }
    if (!Array.isArray(data.concepts)) return []
    return data.concepts.flatMap((c): CreativeConcept[] => {
      const v = c as Record<string, unknown>
      if (typeof v.story !== "string" || !v.story.trim()) return []
      const device = typeof v.device === "string" ? v.device.trim().toLowerCase().slice(0, 40) : ""
      const scores = unscored()
      return [{
        story: words(v.story, 40),
        hook: typeof v.hook === "string" ? words(v.hook, 15) : "",
        emotion: typeof v.emotion === "string" ? words(v.emotion, 4) : "",
        device,
        scores,
        score: weightedScore(scores),
        reasons: [],
        in_scene_text: allowText ? sanitizeInSceneText(v.in_scene_text, device) : null,
      }]
    })
  } catch {
    return []
  }
}

/** The scorer's JSON applied to the concepts, by index. Exported for tests. */
export function applyConceptScores(concepts: CreativeConcept[], raw: string): CreativeConcept[] {
  let rows: { index?: unknown; scores?: Record<string, unknown>; reasons?: unknown }[] = []
  try {
    const data = JSON.parse(raw.replace(/```json\n?|```\n?/g, "").trim()) as { concepts?: unknown }
    if (Array.isArray(data.concepts)) rows = data.concepts as typeof rows
  } catch {}
  return concepts.map((c, i) => {
    const row = rows.find((r) => r.index === i + 1) ?? rows[i]
    if (!row?.scores) return c
    const scores = Object.fromEntries(CRITIC_CRITERIA.map((k) => [k.id, clamp(row.scores?.[k.id])])) as Record<CriticCriterionId, number>
    const reasons = Array.isArray(row.reasons) ? row.reasons.filter((r): r is string => typeof r === "string").map((r) => r.slice(0, 200)).slice(0, 4) : []
    return { ...c, scores, score: weightedScore(scores), reasons }
  })
}

/** The highest predicted score (the first on a tie). */
export function pickConcept(concepts: CreativeConcept[]): CreativeConcept | null {
  return concepts.reduce<CreativeConcept | null>((best, c) => (!best || c.score > best.score ? c : best), null)
}

async function generateRound(brand: BrandRow, input: ConceptInput, feedback: string | null, label: string): Promise<CreativeConcept[]> {
  const count = input.variants?.length || 3
  // Words in the picture only on a post (Full Post / Autopilot / Images):
  // every other format has its own words composited on top.
  const allowText = input.format === "post"
  const { response: res } = await createTextCompletion(
    {
      model: MODELS.creative,
      // Real ideation, but on the path to every image -- "low" keeps it quick.
      reasoning_effort: "low",
      max_completion_tokens: 2500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: conceptSystemPrompt(brand, count, !!input.variants?.length, allowText) },
        { role: "user", content: conceptUserPrompt(input, feedback) },
      ],
    },
    { stage: "creative_concept", timeout: 25_000 },
  )
  const concepts = parseConcepts(res.choices[0]?.message?.content ?? "", allowText)
  if (concepts.length === 0) console.error(`[creative-concept] ${label}: no usable concepts this round`)
  return concepts
}

/** One MODELS.scoring call: every concept scored 1-10 on each criterion, with reasons. Unscored on failure. */
async function scoreConcepts(brand: BrandRow, input: ConceptInput, concepts: CreativeConcept[], label: string): Promise<CreativeConcept[]> {
  try {
    const { response: res } = await createTextCompletion(
      {
        model: MODELS.scoring,
        reasoning_effort: "low",
        max_completion_tokens: 2000,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are a demanding Instagram creative director scoring IDEAS for a ${FORMAT_LABEL[input.format]} before the image is made. Imagine the finished post with this hook. An ordinary idea is a 5 or 6, an 8 is genuinely good, a 10 is rare.

${buildBrandContext(brand)}

Score each concept 1-10 on each criterion:
${criteriaList()}

Give up to 3 short reasons per concept (what holds it back).

Respond with valid JSON only, no markdown:
{"concepts": [{"index": 1, "scores": {${CRITIC_CRITERIA.map((c) => `"${c.id}": 1-10`).join(", ")}}, "reasons": ["..."]}]}`,
          },
          {
            role: "user",
            content: `Hook: ${input.hook}\n${input.caption?.trim() ? `Caption: ${input.caption.trim().slice(0, 800)}\n` : ""}Concepts:\n${concepts.map((c, i) => `${i + 1}. [${c.device}] ${c.story} (hook: ${c.hook}; feeling: ${c.emotion})`).join("\n")}`,
          },
        ],
      },
      { stage: "creative_concept_score", timeout: 20_000 },
    )
    return applyConceptScores(concepts, res.choices[0]?.message?.content ?? "")
  } catch (err) {
    console.error(`[creative-concept] ${label}: scoring failed (concepts unscored):`, err instanceof Error ? err.message : err)
    return concepts
  }
}

function feedbackFor(concepts: CreativeConcept[]): string {
  return concepts.map((c, i) => `${i + 1}. scored ${c.score}: ${c.reasons.join("; ") || "too ordinary"}`).join("\n")
}

/**
 * Scored concepts after up to 2 rounds. One image: every concept, best kept
 * across rounds. Variants: one per variant, each index keeping its better
 * round. Null when no round produced any.
 */
export async function generateCreativeConcepts(brand: BrandRow, input: ConceptInput, label: string): Promise<CreativeConcept[] | null> {
  try {
    let all: CreativeConcept[] = []
    let perVariant: CreativeConcept[] = []
    let feedback: string | null = null
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const fresh = await generateRound(brand, input, feedback, label)
      if (fresh.length === 0) break
      const scored = await scoreConcepts(brand, input, fresh, label)
      if (input.variants?.length) {
        perVariant = scored.map((c, i) => (perVariant[i] && perVariant[i]!.score >= c.score ? perVariant[i]! : c))
        if (Math.min(...perVariant.map((c) => c.score)) >= CRITIC_PASS) break
        feedback = feedbackFor(scored)
      } else {
        all = [...all, ...scored]
        if ((pickConcept(all)?.score ?? 0) >= CRITIC_PASS) break
        feedback = feedbackFor(scored)
      }
      if (round < MAX_ROUNDS) console.log(`[creative-concept] ${label}: best below ${CRITIC_PASS}, one more round with the scorer's reasons`)
    }
    const result = input.variants?.length ? perVariant : all
    return result.length ? result : null
  } catch (err) {
    console.error(`[creative-concept] ${label}: failed (writing the prompt without one):`, err instanceof Error ? err.message : err)
    return null
  }
}

/** The chosen concept in the logs: device, story and predicted score, so we can see what was picked. */
export function logConcept(label: string, concept: CreativeConcept): void {
  console.log(`[creative-concept] ${label}: chose device="${concept.device}" predicted=${concept.score} story="${concept.story}"${concept.in_scene_text ? ` in_scene_text="${concept.in_scene_text}"` : ""}`)
}

/** Generate, score, pick and log -- the one-image path. */
export async function chooseCreativeConcept(brand: BrandRow, input: ConceptInput, label: string): Promise<CreativeConcept | null> {
  const concept = pickConcept((await generateCreativeConcepts(brand, input, label)) ?? [])
  if (concept) logConcept(label, concept)
  return concept
}

/**
 * Concept + its reviewed prompt in one go, for a server-side image. Null
 * when a step fails -- the caller keeps its own prompt / brief.
 */
export async function conceptImagePrompt(params: {
  brand: BrandRow
  input: ConceptInput
  flow: ImagePromptFlow
  rawInput?: string | null
  constraints?: ImagePromptConstraints
  label: string
}): Promise<{ prompt: string; concept: CreativeConcept } | null> {
  const concept = await chooseCreativeConcept(params.brand, params.input, params.label)
  if (!concept) return null
  const prompt = await writeReviewedPrompt({ flow: params.flow, brand: params.brand, product: params.input.product, concept, rawInput: params.rawInput, constraints: { ...params.constraints, lessons: params.input.lessons }, label: params.label })
  return prompt ? { prompt, concept } : null
}

type WriteParams = {
  flow: ImagePromptFlow
  brand: BrandRow
  product?: Pick<ProductRow, "name" | "description" | "key_benefits"> | null
  concept: CreativeConcept
  rawInput?: string | null
  constraints?: ImagePromptConstraints
  label: string
}

/** The writer's prompt for a concept, non-streaming. Null on failure or an empty prompt. */
export async function writePromptFromConcept(params: WriteParams & { reviewNotes?: string[] }): Promise<string | null> {
  try {
    const stream = await requestImagePromptStream({
      flow: params.flow,
      rawInput: params.rawInput ?? null,
      isRewrite: !!params.reviewNotes?.length,
      brand: params.brand,
      product: params.product ?? null,
      constraints: { ...params.constraints, concept: params.concept, reviewNotes: params.reviewNotes },
    })
    let text = ""
    for await (const chunk of stream) text += chunk.choices[0]?.delta?.content ?? ""
    return text.trim() || null
  } catch (err) {
    console.error(`[creative-concept] ${params.label}: writing the concept's prompt failed (keeping the old prompt):`, err instanceof Error ? err.message : err)
    return null
  }
}

/** The review's JSON -> pass + problems. Unreadable = pass (never blocks the image). Exported for tests. */
export function parsePromptReview(raw: string): { pass: boolean; problems: string[] } {
  try {
    const data = JSON.parse(raw.replace(/```json\n?|```\n?/g, "").trim()) as { pass?: unknown; problems?: unknown }
    const problems = Array.isArray(data.problems) ? data.problems.filter((p): p is string => typeof p === "string" && !!p.trim()).map((p) => p.slice(0, 200)).slice(0, 5) : []
    return { pass: data.pass !== false, problems }
  } catch {
    return { pass: true, problems: [] }
  }
}

/** One Groq call: does the written prompt deliver the concept, and would its image score high? */
async function reviewImagePrompt(prompt: string, concept: CreativeConcept, label: string): Promise<{ pass: boolean; problems: string[] }> {
  try {
    const { response: res } = await createTextCompletion(
      {
        model: MODELS.scoring,
        reasoning_effort: "low",
        max_completion_tokens: 1200,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You review an image-generation prompt before the (single, paid) image is made. It must deliver the concept: ONE subject, ONE action, ONE moment; a clear focal point; the concept's moment and feeling kept; nothing generic, static or stock-like; no collage or split frame. Would the image score 9+ on each of:
${criteriaList()}

Respond with valid JSON only, no markdown: {"pass": true, "problems": ["what to fix, if anything"]}`,
          },
          { role: "user", content: `Concept: [${concept.device}] ${concept.story} (hook: ${concept.hook}; feeling: ${concept.emotion})\n\nPrompt:\n${prompt}` },
        ],
      },
      { stage: "image_prompt_review", timeout: 15_000 },
    )
    return parsePromptReview(res.choices[0]?.message?.content ?? "")
  } catch (err) {
    console.error(`[creative-concept] ${label}: prompt review failed (keeping the prompt):`, err instanceof Error ? err.message : err)
    return { pass: true, problems: [] }
  }
}

/** Write -> review -> (failing) rewrite once with the review's problems. */
export async function writeReviewedPrompt(params: WriteParams): Promise<string | null> {
  const first = await writePromptFromConcept(params)
  if (!first) return null
  const review = await reviewImagePrompt(first, params.concept, params.label)
  if (review.pass) return first
  console.log(`[creative-concept] ${params.label}: prompt review failed, rewriting once (${review.problems.join("; ") || "no detail"})`)
  return (await writePromptFromConcept({ ...params, reviewNotes: review.problems.length ? review.problems : ["make it one subject, one action, one moment with a clear focal point"] })) ?? first
}
