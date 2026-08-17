import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { MODELS, getGroqClient } from "@/lib/ai/models"
import { checkAndIncrementUsage, refundGenerationUsage } from "@/lib/usage/check-and-increment-usage"
import { QUALITY_BAR, buildBrandContext } from "@/lib/ai/prompts"
import { uploadMediaToStorage } from "@/lib/storage/upload-media"
import { compositeMemeText } from "@/lib/image/meme-compositor"
import { z } from "zod"
import type { BrandRow } from "@/types/database"

const schema = z.object({
  brandId: z.string().uuid(),
  idea: z.string().min(2).max(500),
})

export type MemeResult = {
  image_url: string
  top_text: string
  bottom_text: string
  caption: string
  hashtags: string[]
}

interface MemeConcept {
  image_prompt: string
  top_text: string
  bottom_text: string
  caption: string
  hashtags: string[]
}

function buildMemeConceptSystemPrompt(): string {
  return `You create Reddit/Instagram-style reaction memes for Indian D2C brands. Given a brand's meme idea, you produce: a vivid AI image-generation prompt for the visual scene, and short punchy meme captions in the classic top-text/bottom-text format (top text sets up the joke, bottom text is the punchline -- each under 8 words, written in the implied ALL-CAPS meme convention).

The image_prompt must describe an original visual scene or reaction moment -- exaggerated expressions, funny situations, relatable scenarios. It must NOT describe any text, caption, or words appearing in the image itself (the text is added separately) and must NOT reference any specific real meme template, real photograph, or real named individual -- describe an original scene instead.

Favor scenes where the humor comes through facial expression, body language, or the situation itself rather than close-up or complex hand gestures/actions -- these are harder for image generation to render cleanly. Simple poses (sitting, standing, reacting with facial expression) work better than dynamic actions involving hands or props.

top_text and bottom_text must be plain English text only -- no emoji, no special symbols, no non-Latin characters -- since they are rendered directly onto the image using a font that only has basic Latin glyphs.

The caption must explicitly reference or riff on this specific meme's scenario/punchline -- not generic brand messaging that could sit under any image. Someone scrolling past may not fully register the visual joke from the image alone, so the caption should carry it: open by acknowledging or extending the joke in your own words, then transition naturally into the brand's angle and a soft CTA, in that order -- joke first, brand second.
${QUALITY_BAR}
Always respond with valid JSON only.`
}

function buildMemeConceptUserPrompt(brand: BrandRow, idea: string): string {
  return `${buildBrandContext(brand)}

Meme idea from the brand: "${idea}"

Respond with ONLY this JSON:
{
  "image_prompt": "vivid visual scene description for an AI image generator, no text/words in the image",
  "top_text": "short setup line, under 8 words, plain English text only (no emoji or special symbols), empty string if not needed",
  "bottom_text": "short punchline, under 8 words, plain English text only (no emoji or special symbols)",
  "caption": "witty Instagram caption for the post, include a soft CTA",
  "hashtags": ["5 to 6 relevant hashtags without the # symbol"]
}`
}

/**
 * Defensive backstop before text reaches the font renderer, in case the AI
 * doesn't perfectly follow the plain-English instruction above — the
 * embedded font (see lib/image/meme-compositor.ts) only has basic Latin
 * glyphs, so emoji or other symbols would render as tofu boxes even with
 * the font embedding fix.
 */
function sanitizeCaptionText(text: string): string {
  return text.replace(/[^\x00-\x7F]/g, "").replace(/\s+/g, " ").trim()
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  }

  const usageCheck = await checkAndIncrementUsage(user.id)
  if (!usageCheck.ok) {
    const code = usageCheck.status === 429 ? ErrorCodes.USAGE_LIMIT_EXCEEDED : ErrorCodes.INTERNAL_ERROR
    return NextResponse.json(buildError(code, usageCheck.message), { status: usageCheck.status })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.issues[0]?.message), { status: 400 })
  }

  const { brandId, idea } = parsed.data

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  const groq = getGroqClient()

  let concept: MemeConcept
  try {
    const response = await groq.chat.completions.create({
      model: MODELS.generation,
      temperature: 0.9,
      // GPT-OSS reasoning tokens count against max_tokens. Short structured
      // output (image_prompt + top/bottom text + caption + hashtags),
      // similar scale to the tested hooks/captions call sites -- "low" is
      // right here. Budget raised well past the old Llama-era 500, which
      // would 400 outright ("json_validate_failed") once reasoning tokens
      // are involved at all.
      reasoning_effort: "low",
      max_tokens: 1200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildMemeConceptSystemPrompt() },
        { role: "user", content: buildMemeConceptUserPrompt(brand, idea) },
      ],
    })
    const raw = response.choices[0]?.message?.content ?? "{}"
    let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    if (jsonMatch) cleaned = jsonMatch[0]
    concept = JSON.parse(cleaned) as MemeConcept
  } catch (err) {
    console.error("[meme/generate] concept generation failed:", err instanceof Error ? err.message : err)
    await refundGenerationUsage(supabase, user.id)
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Couldn't come up with a meme concept. Please try again."), { status: 500 })
  }

  if (!concept.image_prompt) {
    await refundGenerationUsage(supabase, user.id)
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Meme generation failed. Please try again."), { status: 500 })
  }

  const seed = Math.floor(Math.random() * 1_000_000)
  // model=flux -- checked https://image.pollinations.ai/models and tried
  // switching to nanobanana/seedream, but both 500 with "only available on
  // enter.pollinations.ai" (a separate paid tier this app isn't set up to
  // use), and the one model actually listed there ("sana") produced
  // byte-identical output to flux at the same seed in testing -- i.e. not
  // a real distinct option on this public endpoint. flux stays.
  const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(`${concept.image_prompt}, meme photo style, vibrant colors, high contrast, funny expression, no text, no illegible symbols, anatomically correct features, correct number of fingers and limbs, natural hand positioning`)}?width=1080&height=1080&seed=${seed}&nologo=true&model=flux&enhance=true`

  let imageBuffer: Buffer
  try {
    const res = await fetch(pollinationsUrl)
    if (!res.ok) throw new Error(`Image generation returned ${res.status}`)
    imageBuffer = Buffer.from(await res.arrayBuffer())
  } catch (err) {
    console.error("[meme/generate] base image fetch failed:", err instanceof Error ? err.message : err)
    await refundGenerationUsage(supabase, user.id)
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Couldn't generate the meme image. Please try again."), { status: 500 })
  }

  const sanitizedTopText = sanitizeCaptionText(concept.top_text ?? "")
  const sanitizedBottomText = sanitizeCaptionText(concept.bottom_text ?? "")

  let finalBuffer: Buffer
  try {
    finalBuffer = await compositeMemeText(imageBuffer, sanitizedTopText, sanitizedBottomText)
  } catch (err) {
    console.error("[meme/generate] text compositing failed:", err instanceof Error ? err.message : err)
    await refundGenerationUsage(supabase, user.id)
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Couldn't add text to the meme image. Please try again."), { status: 500 })
  }

  const uploadResult = await uploadMediaToStorage(
    { kind: "buffer", buffer: finalBuffer, mimeType: "image/png" },
    `${brandId}/memes`
  )
  if ("error" in uploadResult) {
    console.error("[meme/generate] upload failed:", uploadResult.error)
    await refundGenerationUsage(supabase, user.id)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't save the meme image. Please try again."), { status: 500 })
  }

  const result: MemeResult = {
    image_url: uploadResult.publicUrl,
    top_text: sanitizedTopText,
    bottom_text: sanitizedBottomText,
    caption: concept.caption ?? "",
    hashtags: Array.isArray(concept.hashtags) ? concept.hashtags : [],
  }

  // Persist (non-fatal) — matches the pattern used by every other
  // generate route: the generate call itself saves, the client never
  // needs a separate save request.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("memes") as any).insert({
      brand_id: brandId,
      idea,
      image_url: result.image_url,
      top_text: result.top_text,
      bottom_text: result.bottom_text,
      caption: result.caption,
      hashtags: result.hashtags,
      is_saved: true,
    })
  } catch (persistErr) {
    console.error("[ai/meme/generate] persist failed (non-fatal):", persistErr)
  }

  return NextResponse.json({ data: result }, { status: 200 })
}
