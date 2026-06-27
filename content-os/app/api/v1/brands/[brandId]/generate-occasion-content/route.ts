import { NextResponse } from "next/server"
import OpenAI from "openai"
import { createClient } from "@/lib/supabase/server"
import { MODELS, NVIDIA_BASE_URL, getApiKey } from "@/lib/ai/models"
import { buildError, ErrorCodes } from "@/types/api"
import { z } from "zod"
import type { BrandRow } from "@/types/database"

type RouteParams = { params: Promise<{ brandId: string }> }

function sanitizeJsonString(raw: string): string {
  return raw
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim()
}

const occasionContentSchema = z.object({
  occasionName: z.string().min(1).max(200),
  occasionAngle: z.string().min(1).max(600),
})

export async function POST(request: Request, { params }: RouteParams) {
  const { brandId } = await params
  console.log("[generate-occasion-content] POST called")

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[generate-occasion-content] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  }

  const { data: brand } = await supabase
    .from("brands")
    .select("*")
    .eq("id", brandId)
    .eq("user_id", user.id)
    .single<BrandRow>()

  if (!brand) {
    return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = occasionContentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message),
      { status: 400 },
    )
  }

  const { occasionName, occasionAngle } = parsed.data

  const openai = new OpenAI({ apiKey: getApiKey(), baseURL: NVIDIA_BASE_URL })

  let generated: {
    hook: string
    caption: string
    hashtags: string[]
    visual_direction: string
  }

  try {
    const res = await openai.chat.completions.create({
      model: MODELS.generation,
      temperature: 0.7,
      max_tokens: 600,
      messages: [
        {
          role: "system",
          content: "You are an expert social media content creator for Indian D2C brands. Respond with valid JSON only. No markdown.",
        },
        {
          role: "user",
          content: `Generate a complete social media post for ${brand.name} for ${occasionName}.
Brand niche: ${brand.niche ?? "D2C brand"}
Brand voice: ${brand.ai_persona ?? brand.tone_of_voice ?? "friendly and authentic"}
Content angle: ${occasionAngle}

Return this exact JSON:
{"hook":"attention-grabbing opening line","caption":"full post caption 2-4 sentences in brand voice","hashtags":["hashtag1","hashtag2","hashtag3","hashtag4","hashtag5"],"visual_direction":"describe the ideal image/video for this post"}`,
        },
      ],
    })

    const raw = res.choices[0]?.message?.content ?? "{}"
    const aiParsed = JSON.parse(sanitizeJsonString(raw)) as {
      hook?: string
      caption?: string
      hashtags?: string[]
      visual_direction?: string
    }

    generated = {
      hook: aiParsed.hook ?? "",
      caption: aiParsed.caption ?? "",
      hashtags: Array.isArray(aiParsed.hashtags) ? aiParsed.hashtags : [],
      visual_direction: aiParsed.visual_direction ?? "",
    }

    if (!generated.hook && !generated.caption) {
      return NextResponse.json(
        buildError(ErrorCodes.AI_GENERATION_FAILED, "AI returned empty content."),
        { status: 500 },
      )
    }
  } catch (err) {
    console.error("[generate-occasion-content] AI failed:", err)
    return NextResponse.json(
      buildError(ErrorCodes.AI_GENERATION_FAILED, "Failed to generate content. Please try again."),
      { status: 500 },
    )
  }

  // Save hook + caption to DB (non-fatal)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: hookData } = await (supabase.from("hooks") as any)
      .insert({
        brand_id: brandId,
        hook_text: generated.hook,
        hook_type: "bold_statement",
        generation_prompt: `occasion:${occasionName}`,
        model_used: MODELS.generation,
        is_saved: true,
      })
      .select("id")
      .single() as { data: { id: string } | null }

    if (hookData?.id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from("captions") as any).insert({
        brand_id: brandId,
        hook_id: hookData.id,
        caption_text: generated.caption,
        hashtags: generated.hashtags,
        model_used: MODELS.generation,
        is_saved: true,
      })
    }
  } catch (persistErr) {
    console.error("[generate-occasion-content] persist failed (non-fatal):", persistErr)
  }

  return NextResponse.json({ data: generated }, { status: 200 })
}
