import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { MODELS, getGroqClient } from "@/lib/ai/models"
import { checkAndIncrementUsage } from "@/lib/usage/check-and-increment-usage"
import { z } from "zod"
import type { BrandRow } from "@/types/database"

const schema = z.object({
  brandId: z.string().uuid(),
  topic: z.string().min(3).max(300),
  storyCount: z.number().int().min(3).max(5).default(3),
  vibe: z.string().optional(),
})

export type StorySlide = {
  story_number: number
  type: "hook" | "reveal" | "buildup" | "cta"
  text: string
  subtext: string
  background: "gradient_violet" | "gradient_pink" | "gradient_dark" | "gradient_warm" | "white"
  text_position: "top" | "center" | "bottom"
  has_poll: boolean
  poll_options?: [string, string]
}

export type GeneratedStorySequence = {
  stories: StorySlide[]
}

function buildStoriesPrompt(brand: BrandRow, topic: string, storyCount: number, vibe?: string): string {
  const brandCtx = [
    `Brand: ${brand.name}`,
    brand.niche ? `Niche: ${brand.niche}` : null,
    brand.tone_of_voice ? `Tone: ${brand.tone_of_voice}` : null,
    brand.instagram_handle ? `Handle: @${brand.instagram_handle}` : null,
    vibe ? `Visual Vibe: ${vibe}` : null,
  ].filter(Boolean).join("\n")

  const typeSequence = storyCount === 3
    ? ["hook", "reveal", "cta"]
    : storyCount === 4
    ? ["hook", "reveal", "buildup", "cta"]
    : ["hook", "reveal", "buildup", "buildup", "cta"]

  return `${brandCtx}

STORY TOPIC: "${topic}"
NUMBER OF STORIES: ${storyCount}

Create ${storyCount} connected Instagram stories that build narrative momentum.

Story type sequence: ${typeSequence.join(" → ")}

Story types:
- hook: Stops the scroll, creates curiosity, "Wait till you see this 👀" energy
- reveal: Shows/introduces the main thing (product, concept, transformation)
- buildup: Adds details, benefits, social proof, or context
- cta: Final slide with strong call to action and @handle

Background options:
- "gradient_violet": Purple/violet gradient (great for hook)
- "gradient_pink": Pink/rose gradient (great for reveal)
- "gradient_dark": Dark dramatic (great for CTA)
- "gradient_warm": Warm orange/amber (great for buildup)
- "white": Clean white (great for text-heavy slides)

Respond with ONLY this JSON:
{
  "stories": [
    {
      "story_number": 1,
      "type": "hook",
      "text": "Main hook text (bold, large, 5-8 words max)",
      "subtext": "Secondary text (smaller, supporting)",
      "background": "gradient_violet",
      "text_position": "center",
      "has_poll": false
    },
    {
      "story_number": 2,
      "type": "reveal",
      "text": "Reveal text",
      "subtext": "Supporting detail",
      "background": "gradient_pink",
      "text_position": "bottom",
      "has_poll": false
    },
    {
      "story_number": ${storyCount},
      "type": "cta",
      "text": "CTA line",
      "subtext": "Link in bio 👆",
      "background": "gradient_dark",
      "text_position": "center",
      "has_poll": true,
      "poll_options": ["Yes, I want it!", "Tell me more"]
    }
  ]
}

Make the text punchy and emotion-led. Each story should make the viewer want to tap to the next one.`
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

  const { brandId, topic, storyCount, vibe } = parsed.data

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  const groq = getGroqClient()
  const prompt = buildStoriesPrompt(brand, topic, storyCount, vibe)

  try {
    const response = await groq.chat.completions.create({
      model: MODELS.generation,
      temperature: 0.85,
      max_tokens: 1200,
      messages: [
        {
          role: "system",
          content: "You are an expert Instagram story creator for Indian D2C brands. Always return valid JSON only.",
        },
        { role: "user", content: prompt },
      ],
    })

    const raw = response.choices[0]?.message?.content ?? "{}"
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()

    let data: unknown
    try {
      data = JSON.parse(cleaned)
    } catch {
      return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "AI returned invalid JSON. Please try again."), { status: 500 })
    }

    const d = data as Record<string, unknown>
    if (!Array.isArray(d.stories) || d.stories.length === 0) {
      return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Story generation failed. Please try again."), { status: 500 })
    }

    return NextResponse.json({ data }, { status: 200 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Generation failed"
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, msg), { status: 500 })
  }
}
