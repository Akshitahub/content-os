import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { MODELS, getGroqClient } from "@/lib/ai/models"
import { checkAndIncrementUsage } from "@/lib/usage/check-and-increment-usage"
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
${QUALITY_BAR}
Always respond with valid JSON only.`
}

function buildMemeConceptUserPrompt(brand: BrandRow, idea: string): string {
  return `${buildBrandContext(brand)}

Meme idea from the brand: "${idea}"

Respond with ONLY this JSON:
{
  "image_prompt": "vivid visual scene description for an AI image generator, no text/words in the image",
  "top_text": "short setup line, under 8 words, empty string if not needed",
  "bottom_text": "short punchline, under 8 words",
  "caption": "witty Instagram caption for the post, include a soft CTA",
  "hashtags": ["5 to 6 relevant hashtags without the # symbol"]
}`
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
      max_tokens: 500,
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
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Couldn't come up with a meme concept. Please try again."), { status: 500 })
  }

  if (!concept.image_prompt) {
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Meme generation failed. Please try again."), { status: 500 })
  }

  const seed = Math.floor(Math.random() * 1_000_000)
  const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(`${concept.image_prompt}, meme photo style, vibrant colors, high contrast, funny expression`)}?width=1080&height=1080&seed=${seed}&nologo=true&model=flux`

  let imageBuffer: Buffer
  try {
    const res = await fetch(pollinationsUrl)
    if (!res.ok) throw new Error(`Image generation returned ${res.status}`)
    imageBuffer = Buffer.from(await res.arrayBuffer())
  } catch (err) {
    console.error("[meme/generate] base image fetch failed:", err instanceof Error ? err.message : err)
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Couldn't generate the meme image. Please try again."), { status: 500 })
  }

  let finalBuffer: Buffer
  try {
    finalBuffer = await compositeMemeText(imageBuffer, concept.top_text ?? "", concept.bottom_text ?? "")
  } catch (err) {
    console.error("[meme/generate] text compositing failed:", err instanceof Error ? err.message : err)
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Couldn't add text to the meme image. Please try again."), { status: 500 })
  }

  const uploadResult = await uploadMediaToStorage(
    { kind: "buffer", buffer: finalBuffer, mimeType: "image/png" },
    `${brandId}/memes`
  )
  if ("error" in uploadResult) {
    console.error("[meme/generate] upload failed:", uploadResult.error)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't save the meme image. Please try again."), { status: 500 })
  }

  const result: MemeResult = {
    image_url: uploadResult.publicUrl,
    top_text: concept.top_text ?? "",
    bottom_text: concept.bottom_text ?? "",
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
