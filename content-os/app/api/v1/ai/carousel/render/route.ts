import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { renderRichCarouselSlidesToPng, type CarouselCompositeSlide } from "@/lib/image/carousel-compositor"
import { z } from "zod"

// Real, high-resolution carousel export -- mirrors
// app/api/v1/ai/stories/render/route.ts exactly, for the identical reason:
// CarouselBuilder.tsx's real download/schedule path used to be
// html-to-image's toPng() screenshotting the live SlidePreview DOM
// element, which only exists while that exact editor page is open --
// scheduling from My Content (Library) instead sent the bare
// slide.image_url (an AI background photo, never composited with text,
// and only present on some slides), confirmed live to be the exact cause
// of a real published carousel missing its text and missing slides beyond
// the first. Renders server-side via lib/image/carousel-compositor.ts
// instead, at the real 1080x1350 resolution CarouselBuilder's own AI
// backgrounds already use. Used by "Save as PNG"/"Download all slides"
// and the real Zernio schedule/publish path alike (both live, right after
// generating, and later from Library) -- there is no second path left
// that can drift out of sync with this one.

// Not a generation call -- no checkAndIncrementUsage/credit cost here,
// same as the DOM-screenshot flow it replaces never charged credits
// either. This only re-renders slide data the user already
// generated/edited.

const slideSchema = z.object({
  type: z.enum(["cover", "content", "cta"]),
  headline: z.string().min(1).max(300),
  subtext: z.string().max(300).nullish(),
  points: z.array(z.string().max(300)).max(10).nullish(),
  ctaText: z.string().max(300).nullish(),
  ctaHandle: z.string().max(100).nullish(),
  background_style: z.string().nullish(),
  // Either an http(s) URL (AI-generated background, already hosted) or a
  // data: URL (a photo the user just picked locally and never uploaded
  // anywhere) -- lib/image/carousel-compositor.ts handles both the same way.
  image_url: z.string().max(6_000_000).nullish(),
  custom_background_colors: z.array(z.string()).max(2).nullish(),
  text_position_x: z.number().min(0).max(100).nullish(),
  text_position_y: z.number().min(0).max(100).nullish(),
  productImageSource: z.string().max(6_000_000).nullish(),
})
// Matches CarouselBuilder.tsx's slideCount cap.
const schema = z.object({
  brandName: z.string().max(200).default(""),
  slides: z.array(slideSchema).min(1).max(10),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.issues[0]?.message), { status: 400 })
  }

  try {
    const buffers = await renderRichCarouselSlidesToPng(parsed.data.brandName, parsed.data.slides as CarouselCompositeSlide[])
    const imageUrls = buffers.map((buf) => `data:image/png;base64,${buf.toString("base64")}`)
    return NextResponse.json({ data: { imageUrls } })
  } catch (err) {
    console.error("[ai/carousel/render] compositing failed:", err instanceof Error ? err.message : err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't render the carousel image. Please try again."), { status: 500 })
  }
}
