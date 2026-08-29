import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { renderStorySlidesToPng, type StoryCompositeSlide } from "@/lib/image/story-compositor"
import { z } from "zod"

// Not a generation call -- no checkAndIncrementUsage/credit cost here, same
// as the DOM-screenshot flow it replaces never charged credits either.
// This only re-renders slide data the user already generated/edited, as a
// clean server-side raster instead of a screenshot of the live editing
// preview (see lib/image/story-compositor.ts). Used by both "Save as PNG"
// and the real Zernio schedule/publish path (via ScheduleAction.tsx).

const slideSchema = z.object({
  type: z.enum(["hook", "reveal", "buildup", "cta"]),
  text: z.string().min(1).max(300),
  subtext: z.string().max(300),
  background: z.string(),
  text_position: z.enum(["top", "center", "bottom"]),
  has_poll: z.boolean(),
  poll_options: z.array(z.string()).max(2).optional(),
  // Either an http(s) URL (AI-generated background, already hosted) or a
  // data: URL (a photo the user just picked locally and never uploaded
  // anywhere) -- lib/image/story-compositor.ts handles both the same way.
  background_image_url: z.string().max(6_000_000).nullish(),
  custom_background_colors: z.array(z.string()).max(2).nullish(),
  productImageSource: z.string().max(6_000_000).nullish(),
  // Free-drag override -- see StorySlide.text_position_x/y's own comment
  // (app/api/v1/ai/stories/generate/route.ts). Optional/absent falls back
  // to text_position above, same as the live editor preview.
  text_position_x: z.number().min(0).max(100).optional(),
  text_position_y: z.number().min(0).max(100).optional(),
})
// Matches the generate route's own storyCount cap (1-10).
const schema = z.object({ slides: z.array(slideSchema).min(1).max(10) })

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
    const buffers = await renderStorySlidesToPng(parsed.data.slides as StoryCompositeSlide[])
    const imageUrls = buffers.map((buf) => `data:image/png;base64,${buf.toString("base64")}`)
    return NextResponse.json({ data: { imageUrls } })
  } catch (err) {
    console.error("[ai/stories/render] compositing failed:", err instanceof Error ? err.message : err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't render the story image. Please try again."), { status: 500 })
  }
}
