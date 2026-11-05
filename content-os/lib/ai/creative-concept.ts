import { MODELS } from "./models"
import { createTextCompletion } from "./provider-fallback"
import { buildBrandContext } from "./prompts"
import { requestImagePromptStream, type ImagePromptConstraints, type ImagePromptFlow } from "./image-prompt-writer"
import type { BrandRow, ProductRow } from "@/types/database"
import { CRITIC_CRITERIA, type CriticCriterionId } from "@/lib/design/critic-scores"

/**
 * The creative concept stage: one text call after the hook / caption exist
 * and before the image-prompt writer (lib/ai/image-prompt-writer.ts). It
 * proposes 3 concepts -- a MOMENT that tells a story with a hook, not a
 * well-lit picture of nothing happening -- each self-scored against the
 * critic's own criteria (CRITIC_CRITERIA, one source of truth). The best
 * one (picked in code) becomes the writer's creative core.
 *
 * Used by Full Post (/api/v1/ai/image-prompt/write), the carousel cover and
 * story hook frame (their slide-image routes), Ad Maker (one concept per
 * variant) and Autopilot post slots. "Make it better" passes the critic's
 * fix in, so the next version gets a new concept. Never throws: null when
 * the call fails, and callers write the prompt exactly as before.
 */

export const CONCEPT_DEVICES = [
  "relatable moment", "mid-action", "reveal", "visual metaphor", "humour/irony", "direct address",
  "tension before the moment", "aspiration", "behind the scenes", "social proof", "in-scene text", "product as hero in use",
] as const

export type ConceptFormat = "post" | "story_frame" | "carousel_cover" | "ad"

export interface CreativeConcept {
  /** What is happening in this one frame: who, doing what, at what moment (<= 40 words). */
  story: string
  /** Why a thumb stops on it (<= 15 words). */
  hook: string
  emotion: string
  device: string
  self_scores: Record<CriticCriterionId, number>
  /** Weighted like the critic's overall (CRITIC_CRITERIA weights). */
  score: number
}

export interface ConceptInput {
  product?: Pick<ProductRow, "name" | "description" | "key_benefits"> | null
  /** Full Post's content angle ("auto" / omitted = let SocioPosts decide), or an ad variant's angle. */
  angle?: string | null
  hook: string
  caption?: string | null
  format: ConceptFormat
  /** The brand's active lessons, as plain rules. */
  lessons?: string[]
  /** "Make it better": the critic's fix on the last version. */
  fix?: string | null
  /** Ad Maker: one concept per variant, in this order (no picking). */
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
  story_frame: "the opening frame of an Instagram story (9:16)",
  carousel_cover: "the cover slide of an Instagram carousel",
  ad: "a Meta ad image",
}

function systemPrompt(brand: BrandRow, count: number, variants: boolean): string {
  const scores = CRITIC_CRITERIA.map((c) => `"${c.id}": 1-10`).join(", ")
  return `You are the creative director of a top Instagram content studio for Indian D2C brands. Before any image is made you invent the IDEA. Great posts are a MOMENT that tells a story with a hook: you get the point in one second and feel something (curiosity, recognition, a laugh, desire). A well-lit picture of nothing happening is a failure.

${buildBrandContext(brand)}

${ANGLE_GUIDANCE}

Storytelling devices (a toolbox, use whichever fits): ${CONCEPT_DEVICES.join(", ")}.

Rules:
- One photographable frame: what is happening, who is in it, doing what, at what moment.
- People only when they serve the story, and then the brand's own audience (who they are comes from the brand and audience above, never a fixed default). Product-only concepts are fine when the product is the story.
- Only products, claims and facts from the brand context and the copy -- never invent an offer, number or result.
- Banned: a static "product on a table" or "person smiling at a laptop" stock setup with nothing happening; collages; split frames or two halves; random decorative stickers.
- Score each concept honestly 1-10 against: ${CRITIC_CRITERIA.map((c) => `${c.id} (${c.ask})`).join(" ")}

${variants ? `Write exactly ${count} concepts, concept N for variant N (its own angle and headline), each a different idea.` : `Write ${count} genuinely different concepts (different moments and devices, not rewordings).`}

Respond with valid JSON only, no markdown:
{"concepts": [{"story": "max 40 words", "hook": "max 15 words", "emotion": "one feeling", "device": "one of the devices", "self_scores": {${scores}}}]}`
}

function userPrompt(input: ConceptInput): string {
  const angle = input.angle && input.angle !== "auto" ? ANGLE_LABEL[input.angle] ?? input.angle : "Let SocioPosts decide"
  const lines = [
    `Format: ${FORMAT_LABEL[input.format]}`,
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
  return lines.join("\n")
}

const words = (s: string, max: number) => s.replace(/\s+/g, " ").trim().split(" ").slice(0, max).join(" ")

function weighted(scores: Record<CriticCriterionId, number>): number {
  let sum = 0
  let total = 0
  for (const c of CRITIC_CRITERIA) {
    sum += scores[c.id] * c.weight
    total += c.weight
  }
  return Math.round((sum / total) * 10) / 10
}

/** The model's JSON -> concepts (malformed ones dropped). Exported for tests. */
export function parseConcepts(raw: string): CreativeConcept[] {
  try {
    const data = JSON.parse(raw.replace(/```json\n?|```\n?/g, "").trim()) as { concepts?: unknown }
    if (!Array.isArray(data.concepts)) return []
    return data.concepts.flatMap((c): CreativeConcept[] => {
      const v = c as Record<string, unknown>
      if (typeof v.story !== "string" || !v.story.trim()) return []
      const rawScores = (v.self_scores ?? {}) as Record<string, unknown>
      const self_scores = Object.fromEntries(CRITIC_CRITERIA.map((k) => {
        const n = rawScores[k.id]
        return [k.id, typeof n === "number" && Number.isFinite(n) ? Math.max(1, Math.min(10, Math.round(n))) : 5]
      })) as Record<CriticCriterionId, number>
      return [{
        story: words(v.story, 40),
        hook: typeof v.hook === "string" ? words(v.hook, 15) : "",
        emotion: typeof v.emotion === "string" ? words(v.emotion, 4) : "",
        device: typeof v.device === "string" ? v.device.trim().toLowerCase().slice(0, 40) : "",
        self_scores,
        score: weighted(self_scores),
      }]
    })
  } catch {
    return []
  }
}

/** The highest-scoring concept (the first on a tie). */
export function pickConcept(concepts: CreativeConcept[]): CreativeConcept | null {
  return concepts.reduce<CreativeConcept | null>((best, c) => (!best || c.score > best.score ? c : best), null)
}

/** Concepts for one image (or, with `variants`, one per variant in order). Null on any failure. */
export async function generateCreativeConcepts(brand: BrandRow, input: ConceptInput, label: string): Promise<CreativeConcept[] | null> {
  const count = input.variants?.length || 3
  try {
    const { response: res } = await createTextCompletion(
      {
        model: MODELS.creative,
        // Real ideation, but on the path to every image -- "low" keeps it quick.
        reasoning_effort: "low",
        max_completion_tokens: 2500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt(brand, count, !!input.variants?.length) },
          { role: "user", content: userPrompt(input) },
        ],
      },
      { stage: "creative_concept", timeout: 25_000 },
    )
    const concepts = parseConcepts(res.choices[0]?.message?.content ?? "")
    if (concepts.length === 0) {
      console.error(`[creative-concept] ${label}: no usable concepts (writing the prompt without one)`)
      return null
    }
    return concepts
  } catch (err) {
    console.error(`[creative-concept] ${label}: failed (writing the prompt without one):`, err instanceof Error ? err.message : err)
    return null
  }
}

/** The chosen concept in the logs: device + story, so we can see what was picked. */
export function logConcept(label: string, concept: CreativeConcept): void {
  console.log(`[creative-concept] ${label}: chose device="${concept.device}" score=${concept.score} story="${concept.story}"`)
}

/** Generate, pick and log -- the one-image path. */
export async function chooseCreativeConcept(brand: BrandRow, input: ConceptInput, label: string): Promise<CreativeConcept | null> {
  const concept = pickConcept((await generateCreativeConcepts(brand, input, label)) ?? [])
  if (concept) logConcept(label, concept)
  return concept
}

/**
 * Concept + the writer's prompt in one go, for a server-side image (the
 * carousel cover, the story hook frame, an Autopilot post). Null when
 * either step fails -- the caller keeps its own prompt / brief.
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
  const prompt = await writePromptFromConcept({ flow: params.flow, brand: params.brand, product: params.input.product, concept, rawInput: params.rawInput, constraints: { ...params.constraints, lessons: params.input.lessons }, label: params.label })
  return prompt ? { prompt, concept } : null
}

/**
 * The writer's prompt for a concept, non-streaming (server-side flows:
 * slide covers, Ad Maker variants, Autopilot). Null on failure or an empty
 * prompt -- the caller keeps its own prompt.
 */
export async function writePromptFromConcept(params: {
  flow: ImagePromptFlow
  brand: BrandRow
  product?: Pick<ProductRow, "name" | "description" | "key_benefits"> | null
  concept: CreativeConcept
  rawInput?: string | null
  constraints?: ImagePromptConstraints
  label: string
}): Promise<string | null> {
  try {
    const stream = await requestImagePromptStream({
      flow: params.flow,
      rawInput: params.rawInput ?? null,
      brand: params.brand,
      product: params.product ?? null,
      constraints: { ...params.constraints, concept: params.concept },
    })
    let text = ""
    for await (const chunk of stream) text += chunk.choices[0]?.delta?.content ?? ""
    return text.trim() || null
  } catch (err) {
    console.error(`[creative-concept] ${params.label}: writing the concept's prompt failed (keeping the old prompt):`, err instanceof Error ? err.message : err)
    return null
  }
}
