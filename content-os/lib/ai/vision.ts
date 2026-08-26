import { MODELS, getGroqClient } from "./models"
import { buildBrandContext } from "./prompts"
import type { BrandRow } from "@/types/database"
import type { GeneratedCaption, GeneratedHook } from "@/types/app"

function sanitizeJsonString(raw: string): string {
  return raw
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim()
}

export interface PhotoCaptionResult {
  hook: GeneratedHook
  caption: GeneratedCaption
  model: string
}

/**
 * The core of Create -> Full Post's "upload your own photo" path: sends
 * the user's actual uploaded photo (already re-hosted at `photoUrl` by the
 * caller) to a real vision-capable model and asks it to write a caption,
 * hashtags, and hook grounded in what's really visible in it -- not a
 * generic caption that ignores the photo's actual content. See
 * lib/ai/models.ts's MODELS.vision comment for why qwen/qwen3.6-27b
 * specifically (confirmed live against Groq's real /v1/models endpoint,
 * not documentation) and why reasoning_effort must be "none".
 */
export async function analyzePhotoForPost(
  brand: BrandRow,
  photoUrl: string,
  additionalContext?: string,
): Promise<PhotoCaptionResult> {
  const groq = getGroqClient()
  const brandContext = buildBrandContext(brand)

  const systemPrompt = `You are a social media caption writer for an Indian D2C brand. Base everything you write ONLY on what is genuinely visible in the uploaded photo -- the product, colors, setting, any visible text, mood -- combined with the brand context below. Never invent details that aren't in the photo, and never write a generic caption that could apply to any photo.

${brandContext}

Respond with valid JSON only, no markdown, in exactly this shape:
{
  "hook_text": string (a short, scroll-stopping opening line, max 8 words, grounded in the photo),
  "caption_text": string (2-4 sentences, in the brand's voice, describing/celebrating what's actually in the photo),
  "hashtags": string[] (5-8 relevant hashtags, no # symbol),
  "cta": string (a short call to action, using the brand's CTA phrase if one was given above, otherwise a natural one)
}`

  const userPromptText = additionalContext
    ? `Write a caption, hashtags, and hook for this exact photo. Additional context from the user: ${additionalContext}`
    : "Write a caption, hashtags, and hook for this exact photo."

  const res = await groq.chat.completions.create({
    model: MODELS.vision,
    temperature: 0.6,
    max_tokens: 700,
    reasoning_effort: "none",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        // OpenAI-compatible vision content array -- Groq accepts a plain
        // remote image_url directly (confirmed live), no base64 re-encoding
        // needed here since photoUrl is already a real public HTTPS URL by
        // the time this is called.
        content: [
          { type: "text", text: userPromptText },
          { type: "image_url", image_url: { url: photoUrl } },
        ],
      },
    ],
  })

  const raw = res.choices[0]?.message?.content ?? "{}"
  let cleaned = sanitizeJsonString(raw)
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (jsonMatch) cleaned = jsonMatch[0]

  const parsed = JSON.parse(cleaned) as {
    hook_text?: string
    caption_text?: string
    hashtags?: string[]
    cta?: string
  }

  const caption_text = parsed.caption_text?.trim() || "Check this out!"
  const hook_text = parsed.hook_text?.trim() || caption_text.split(/[.!?]/)[0]!.trim()

  return {
    hook: {
      hook_text,
      hook_type: "bold_statement",
      reasoning: "Grounded in the uploaded photo's actual content.",
    },
    caption: {
      caption_text,
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.slice(0, 10) : [],
      cta: parsed.cta?.trim() || "",
      character_count: caption_text.length,
    },
    model: MODELS.vision,
  }
}
