import { getGroqClient, MODELS } from "./models"
import type { BrandRow, ProductRow } from "@/types/database"

// Shared "prompt-authoring" stage inserted in front of every image
// generation call in this app (Full Post, Story, Carousel, Ad Maker, and
// the standalone Image Generator) -- see each flow's own call site for how
// its raw input/constraints map onto WriteImagePromptInput below. This
// module's ONLY job is to turn that into one complete, well-formed
// image-generation prompt via Groq; it never talks to Replicate/Flux and
// never enforces a hard constraint itself -- aspect ratio, product
// reference handling, "no text in image", niche photography style, and
// every other real constraint stay exactly where they already lived
// (lib/ai/post-image-pipeline.ts's guards, *-background.ts's own
// composition) and are appended in code AFTER this module's output, same
// as they were appended after a raw user prompt/vibe template before this
// stage existed. This module's output is a soft creative draft, not a
// substitute for those code-level guards.
export type ImagePromptFlow = "post" | "story" | "carousel" | "ad_maker" | "image_tool"

export interface ImagePromptConstraints {
  /** Human-readable label for whatever aspect ratio/canvas shape this
   * generation is locked to (e.g. "4:5 portrait", "9:16 vertical story") --
   * informational context only. The actual aspect_ratio sent to Flux is a
   * separate, code-only Replicate input param (see
   * lib/ai/post-image-pipeline.ts's ImageDimensions) that this text prompt
   * never touches either way, so there's nothing here for Groq to
   * override even in principle. */
  aspectRatioLabel?: string
  /** Selected visual direction/vibe/scene style label, e.g. "editorial
   * graphic", "clean & minimal", "white studio background". Groq should
   * write within this direction, but the actual guard strings (
   * PHOTOGRAPHY_STYLE/EDITORIAL_GRAPHIC_STYLE/VIBE_BACKGROUND_STYLES/
   * SCENE_PROMPTS) are still appended in code regardless of what it
   * writes. */
  styleLabel?: string
  /** True when a real uploaded product photo will be attached as a Flux
   * image-to-image reference for this generation -- when true, Groq is
   * told to describe the SCENE/setting around the product, not the
   * product's own appearance (re-describing it would fight the reference
   * photo) -- same rule post-image-pipeline.ts's wrapForReferenceImage
   * comment already documents. Enforcement of this stays code-side too:
   * the reference-image wrapping/guard strings are applied unconditionally
   * whenever a reference photo is actually present, not based on anything
   * Groq writes. */
  hasProductReference?: boolean
  /** Carousel/Story slide role -- changes what a slide's background needs
   * to leave room for (see resolveProductSafeZoneGuard-style reasoning in
   * lib/ai/carousel-slide-background.ts). Informational only -- the actual
   * safe-zone/no-text guards for these slides are still 100% code-enforced
   * regardless of what Groq writes here. */
  role?: "hook" | "cta" | "body"
  /** Only meaningful for the standalone Image Generator tool, which is the
   * one flow with a real "AI can't render legible text" warning/override
   * (see lib/ai/image-generator.ts's promptRequestsRenderedText). Every
   * other flow hard-forbids on-image text in code regardless of this
   * flag. */
  allowTextInImage?: boolean
}

export interface WriteImagePromptInput {
  flow: ImagePromptFlow
  /** The user's own typed description/instructions for this image, or
   * null/empty when they gave nothing beyond picking options (a vibe, a
   * scene preset, a style) -- see this module's system prompt for how the
   * two cases are handled differently. */
  rawInput: string | null
  /** True for an explicit "Rewrite"/"Regenerate" request, as opposed to the
   * first write for this generation. rawInput/brand/product/constraints
   * are otherwise identical between a first write and a rewrite (the
   * caller is expected to pass the same stable seed both times, not the
   * previous AI output) -- this flag is what actually asks for a
   * meaningfully different take instead of Groq just re-describing the
   * same scene again given identical input. See buildUserPrompt below. */
  isRewrite?: boolean
  brand: Pick<BrandRow, "name" | "niche" | "target_audience" | "tone_of_voice" | "vibe">
  product?: Pick<ProductRow, "name" | "description" | "key_benefits"> | null
  constraints: ImagePromptConstraints
}

const SYSTEM_PROMPT = `You are an expert prompt writer for an AI image generation model (a photorealistic diffusion model). Your ONLY job is to output ONE single, complete, well-formed image-generation prompt as plain text -- nothing else.

Rules:
- Output ONLY the prompt text itself. No preamble, no explanation, no surrounding quotes, no markdown, no labels like "Prompt:".
- Write ONE flowing descriptive passage (not a list, not multiple options): the actual subject, setting, lighting, mood, and composition, in vivid, specific, unambiguous language a diffusion model can act on.
- If the user provided their own description, treat it as the creative brief -- keep their intent and refine/complete any vague or underspecified part into something concrete. Do not discard what they asked for.
- If the user gave no real description, invent one complete, specific scene from scratch using the brand/product context you're given -- never output a generic, vague, or placeholder-sounding scene.
- Ground the scene in the brand's actual niche and product -- never a generic stock-photo scene that could belong to any company.
- Do not describe any text, words, captions, logos, watermarks, or labels appearing in the image -- that is handled separately and must never be part of the scene you describe.
- Do not mention camera brands, aspect ratio, resolution, or megapixels -- those are handled separately.
- If a real product reference photo is noted as attached, describe the SURROUNDING SCENE, setting, and lighting only -- do not redescribe the product's own appearance (color, shape, packaging), since that photo already shows it exactly.
- Keep the prompt under 70 words.`

function buildBrandLine(brand: WriteImagePromptInput["brand"]): string {
  const lines: string[] = [`Brand: ${brand.name}`]
  if (brand.niche) lines.push(`Niche/industry: ${brand.niche}`)
  if (brand.target_audience) lines.push(`Target audience: ${brand.target_audience}`)
  if (brand.tone_of_voice) lines.push(`Brand tone: ${brand.tone_of_voice}`)
  if (brand.vibe) lines.push(`Brand vibe: ${brand.vibe}`)
  return lines.join("\n")
}

function buildProductLine(product?: WriteImagePromptInput["product"] | null): string {
  if (!product) return ""
  const lines: string[] = [`\nProduct featured: ${product.name}`]
  if (product.description) lines.push(`Product description: ${product.description}`)
  if (product.key_benefits?.length) lines.push(`Key benefits: ${product.key_benefits.join(", ")}`)
  return lines.join("\n")
}

function buildConstraintsLine(constraints: ImagePromptConstraints): string {
  const lines: string[] = []
  if (constraints.styleLabel) lines.push(`Visual direction to write within: ${constraints.styleLabel}`)
  if (constraints.role === "hook") lines.push("This is the opening/cover slide -- make it an eye-catching first impression.")
  if (constraints.role === "cta") lines.push("This is the closing slide -- give it a warm, confident, closing mood.")
  if (constraints.hasProductReference) lines.push("A real product reference photo is attached separately -- describe only the scene/setting/lighting around it, not the product's own appearance.")
  if (constraints.allowTextInImage) lines.push("The user has explicitly allowed on-image text this time, but still only describe the scene -- do not write out literal words to render.")
  return lines.join("\n")
}

function buildUserPrompt(input: WriteImagePromptInput): string {
  const brandLine = buildBrandLine(input.brand)
  const productLine = buildProductLine(input.product)
  const constraintsLine = buildConstraintsLine(input.constraints)
  const rawInput = input.rawInput?.trim()

  // Every call to this route is a fresh, stateless completion -- the model
  // is never shown a previous attempt to literally "differ from." This
  // instruction instead nudges it toward a distinct creative treatment on
  // a rewrite (a different specific scene/angle/composition), which is
  // what actually varies the output given the same stable rawInput/brand/
  // product/constraints the caller passes on every rewrite -- rather than
  // relying on temperature alone to avoid a near-duplicate of the last
  // response to the same input.
  const rewriteInstruction = input.isRewrite
    ? `\n\nThis is a REWRITE request, not a first attempt -- give it a genuinely different creative treatment: a different specific scene, angle, composition, or moment than an obvious first pass would produce, not just different wording for the same idea. Still ground it in the same description/context below.`
    : ""

  return `${brandLine}${productLine}${constraintsLine ? `\n${constraintsLine}` : ""}${rewriteInstruction}

${rawInput
    ? `The user's own description for this image: "${rawInput}"\n\nRefine and complete this into one specific, well-formed image-generation prompt, grounded in the brand/product context above.`
    : `The user gave no description of their own -- compose one complete, specific image-generation prompt from scratch, grounded in the brand/product context above.`}

Respond with ONLY the prompt text, nothing else.`
}

/**
 * Kicks off the Groq streaming completion and returns the raw async
 * iterable of chunks -- deliberately NOT wrapped in the route's own
 * ReadableStream here, so a synchronous/early failure (bad API key,
 * unreachable network) surfaces as a normal rejected promise the route can
 * catch and answer with a clean error response, before it has committed to
 * a streaming Response at all. Reasoning-model output only ever lands in
 * delta.content for Groq's chat.completions streaming endpoint on this
 * account's models (hidden reasoning tokens are a separate, un-streamed
 * field, see lib/ai/models.ts) -- confirmed against this file's own
 * non-streaming sibling calls elsewhere in lib/ai, none of which have ever
 * needed to filter one out.
 */
export async function requestImagePromptStream(input: WriteImagePromptInput) {
  const groq = getGroqClient()
  return groq.chat.completions.create({
    model: MODELS.generation,
    temperature: 0.85,
    reasoning_effort: "low",
    max_tokens: 250,
    stream: true,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(input) },
    ],
  })
}
