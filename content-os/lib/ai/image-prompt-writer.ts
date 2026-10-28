import { getTextClientFor, MODELS } from "./models"
import type { BrandRow, ProductRow } from "@/types/database"
import { briefScene, type VisualBrief } from "./visual-brief"

// Shared "prompt-authoring" stage inserted in front of every image
// generation call in this app (Full Post, Story, Carousel, Ad Maker, and
// the standalone Image Generator) -- see each flow's own call site for how
// its raw input/constraints map onto WriteImagePromptInput below. This
// module's ONLY job is to turn that into one complete, well-formed
// image-generation prompt via a text model; it never talks to the image provider
// itself and never enforces a hard constraint itself -- aspect ratio, product
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
   * informational context only. The actual size sent to the image provider is a
   * separate, code-only param (see
   * lib/ai/post-image-pipeline.ts's ImageDimensions) that this text prompt
   * never touches either way, so there's nothing here for the model to
   * override even in principle. */
  aspectRatioLabel?: string
  /** Selected visual direction/vibe/scene style label, e.g. "editorial
   * graphic", "clean & minimal", "white studio background". The model should
   * write within this direction, but the actual guard strings (
   * PHOTOGRAPHY_STYLE/EDITORIAL_GRAPHIC_STYLE/VIBE_BACKGROUND_STYLES/
   * SCENE_PROMPTS) are still appended in code regardless of what it
   * writes. */
  styleLabel?: string
  /** True when a real uploaded product photo will be attached as an
   * image-to-image reference for this generation -- when true, the model is
   * told to describe the SCENE/setting around the product, not the
   * product's own appearance (re-describing it would fight the reference
   * photo) -- same rule post-image-pipeline.ts's wrapForReferenceImage
   * comment already documents. Enforcement of this stays code-side too:
   * the reference-image wrapping/guard strings are applied unconditionally
   * whenever a reference photo is actually present, not based on anything
   * the model writes. */
  hasProductReference?: boolean
  /** Carousel/Story slide role -- changes what a slide's background needs
   * to leave room for (see resolveProductSafeZoneGuard-style reasoning in
   * lib/ai/carousel-slide-background.ts). Informational only -- the actual
   * safe-zone/no-text guards for these slides are still 100% code-enforced
   * regardless of what the model writes here. */
  role?: "hook" | "cta" | "body"
  /** Only meaningful for the standalone Image Generator tool, which is the
   * one flow with a real "AI can't render legible text" warning/override
   * (see lib/ai/image-generator.ts's promptRequestsRenderedText). Every
   * other flow hard-forbids on-image text in code regardless of this
   * flag. */
  allowTextInImage?: boolean
  /** The post's own visual brief (lib/ai/visual-brief.ts, already
   * sanitized) -- the subject the image MUST show, decided by the same call
   * that wrote the caption. The user's raw input still sets style and
   * direction, but can't replace this subject. Never carries headline,
   * caption or overlay text. */
  visualBrief?: VisualBrief
  /** This brand's "image"-scope lessons as plain rules ("Avoid: ..." /
   * "Do: ..."), fetched server-side by the write route -- never sent by the
   * client. Soft direction only; every code-side guard still applies. */
  lessons?: string[]
  /** Brand Brain visual direction (brands.brand_brain.visual, 060) --
   * style direction and things never to show. Soft direction for the
   * writer only; every code-side guard still applies. */
  photographyStyle?: string
  avoidVisuals?: string[]
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
   * meaningfully different take instead of the model just re-describing the
   * same scene again given identical input. See buildUserPrompt below. */
  isRewrite?: boolean
  brand: Pick<BrandRow, "name" | "niche" | "target_audience" | "tone_of_voice" | "vibe">
  product?: Pick<ProductRow, "name" | "description" | "key_benefits"> | null
  constraints: ImagePromptConstraints
}

const SYSTEM_PROMPT = `You are an expert prompt writer for an AI image generation model (a photorealistic diffusion model). Your ONLY job is to output ONE single, complete, well-formed image-generation prompt as plain text -- nothing else.

Rules:
- Output ONLY the prompt text itself. No preamble, no explanation, no surrounding quotes, no markdown, no labels like "Prompt:".
- Write ONE flowing descriptive passage -- not a list, not multiple options, not bullet points or numbered lines -- of 80 to 150 words, moving through these in order:
  1. The subject/product with concrete specifics: exact materials, colors, quantity, and finish (e.g. "three amber glass jar candles with brass lids"), never a vague generality.
  2. The setting and any props relevant to the brief (e.g. diyas, marigolds, a brass thali, silk fabric for a Diwali scene) -- grounded in what the user described or the brand/product context, never generic filler unrelated to the brief.
  3. Lighting and mood (e.g. a warm golden glow, a soft flicker, shallow depth of field).
  4. Composition matched to the requested canvas shape, naming where to leave calm, uncluttered negative space for a headline to be overlaid afterward.
  5. Style and camera language matched to the requested visual direction (e.g. a photorealistic studio product shot with specific lens/lighting language, versus a flat editorial graphic composition with no camera or DSLR language at all).
  6. A short closing clause ruling out text, logos, watermarks, and distorted hands appearing anywhere in the image.
- If the user provided their own description, treat it as the creative brief -- keep their intent and refine/complete any vague or underspecified part into something concrete. Do not discard what they asked for.
- If the user gave no real description, invent one complete, specific scene from scratch using the brand/product context you're given -- never output a generic, vague, or placeholder-sounding scene.
- Ground the scene in the subject of the user's own description when they gave one (e.g. "our candle brand" -> candles), even if it differs from the brand's niche; only when they gave no real description, ground it in the brand's actual niche and product -- never a generic stock-photo scene that could belong to any company.
- Never describe or write out any text, words, lettering, captions, logos, watermarks, or labels appearing in the image, no matter how short -- a diffusion model renders text as garbled nonsense, and any real headline is composited on separately in code afterward. This is a hard rule, not a style preference.
- Do not mention camera brands, aspect ratio as a number/ratio, resolution, or megapixels -- describe composition in plain visual language instead (e.g. "wide open space across the top of the frame"); the exact technical values are handled separately in code.
- If a real product reference photo is noted as attached, describe the SURROUNDING SCENE, setting, and lighting only -- do not redescribe the product's own appearance (color, shape, packaging), since that photo already shows it exactly.
- Never mention SocioPosts, Groq, OpenAI, gpt-image, or any other AI tool/vendor name anywhere in the scene you write -- this is a plain visual description of a photograph, not a mention of the tools that made it.
- Never let internal field or workflow names (e.g. "hook slide", "cta slide", "template", "checklist", "carousel") leak into the visual description -- describe only what a viewer would actually see in the finished photo.`

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
  // Previously accepted on ImagePromptConstraints but never actually read
  // here -- the model had no way to know the canvas shape at all, despite
  // rule 4 above asking it to compose (and leave negative space) for one.
  if (constraints.aspectRatioLabel) lines.push(`Canvas shape: ${constraints.aspectRatioLabel} -- compose for this shape specifically.`)
  if (constraints.styleLabel) lines.push(`Visual direction to write within: ${constraints.styleLabel}`)
  if (constraints.role === "hook") lines.push("This is the opening/cover slide -- make it an eye-catching first impression.")
  if (constraints.role === "cta") lines.push("This is the closing slide -- give it a warm, confident, closing mood.")
  if (constraints.hasProductReference) lines.push("A real product reference photo is attached separately -- describe only the scene/setting/lighting around it, not the product's own appearance.")
  if (constraints.allowTextInImage) lines.push("The user has explicitly allowed on-image text this time, but still only describe the scene -- do not write out literal words to render.")
  if (constraints.photographyStyle) lines.push(`This brand's photography style: ${constraints.photographyStyle}`)
  if (constraints.avoidVisuals?.length) lines.push(`Never show: ${constraints.avoidVisuals.join("; ")}`)
  if (constraints.lessons?.length) {
    lines.push(`Avoid/Do for this brand's images (learned from its own feedback): ${constraints.lessons.join("; ")}`)
  }
  if (constraints.visualBrief) {
    const brief = constraints.visualBrief
    lines.push(`The image MUST show: ${briefScene(brief, "an abstract atmospheric background image")}.${brief.composition ? ` Composition: ${brief.composition}.` : ""} The user's own input sets style and direction but must not replace this subject.`)
  }
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
 * Prompt-authoring moved from Groq to OpenAI (MODELS.creative) as part of
 * the Phase 1 creative-stages migration. Kicks off the streaming
 * completion and returns the raw async iterable of chunks -- deliberately
 * NOT wrapped in the route's own ReadableStream here, so a synchronous/
 * early failure (bad API key, unreachable network) surfaces as a normal
 * rejected promise the route can catch and answer with a clean error
 * response, before it has committed to a streaming Response at all.
 * Reasoning-model output lands in delta.content for this streaming
 * endpoint, same shape as Groq's OpenAI-compatible API (hidden reasoning
 * tokens are a separate, un-streamed field, see lib/ai/models.ts) --
 * confirmed against this file's own non-streaming sibling calls elsewhere
 * in lib/ai, none of which have ever needed to filter one out.
 */
export async function requestImagePromptStream(input: WriteImagePromptInput) {
  const openai = getTextClientFor(MODELS.creative)
  return openai.chat.completions.create(
    {
      model: MODELS.creative,
      // Speed matters here (this fires automatically on entering every
      // image-generation flow) -- "low" per the migration spec.
      reasoning_effort: "low",
      // max_completion_tokens (not the deprecated max_tokens) since
      // gpt-5.5-class models are reasoning models, same convention as
      // lib/ai/captions-generator.ts. Was 400 on Groq for an 80-150 word
      // (~110-200 token) completion plus hidden reasoning tokens; kept the
      // same headroom here since the target output length is unchanged.
      // `temperature` deliberately omitted, same reasoning as that file.
      max_completion_tokens: 400,
      stream: true,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(input) },
      ],
    },
    // ESTIMATE, not measured live (no working OPENAI_API_KEY in the
    // environment this was written in) -- see scripts/test-creative-stages.ts.
    // Streaming, so this bounds time-to-first-chunk/overall stream
    // completion, not time-to-first-byte of a single blocking response.
    { timeout: 25_000, maxRetries: 1 }
  )
}
