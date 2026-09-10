import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { renderStorySlidesToPng, type StoryCompositeSlide } from "@/lib/image/story-compositor"
import { uploadMediaToStorage } from "@/lib/storage/upload-media"
import { z } from "zod"

// Not a generation call -- no checkAndIncrementUsage/credit cost here, same
// as the DOM-screenshot flow it replaces never charged credits either.
// This only re-renders slide data the user already generated/edited, as a
// clean server-side raster instead of a screenshot of the live editing
// preview (see lib/image/story-compositor.ts). Used by both "Save as PNG"
// and the real Zernio schedule/publish path (via ScheduleAction.tsx).

// Compositing every slide plus (now) uploading each rendered PNG to storage
// in parallel can run past the platform default for a longer sequence --
// matches the precedent already set elsewhere (e.g.
// app/api/v1/brands/fastlane/route.ts).
export const maxDuration = 60

// Matches lib/design/fonts.ts's CURATED_FONTS ids exactly -- kept as a
// static literal here rather than importing from lib/design, same
// convention lib/validations/ai.ts's own postFontEnum already follows.
const fontIdEnum = z.enum(["anton", "inter", "playfair", "quicksand", "caveat"])

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
  // See StorySlide.show_product_overlay/product_position_x/y's own
  // comments (app/api/v1/ai/stories/generate/route.ts) -- resolved
  // client-side (StorySequence.tsx's toExportSlide) before this ever
  // reaches the compositor.
  show_product_overlay: z.boolean().optional(),
  product_position_x: z.number().min(0).max(100).optional(),
  product_position_y: z.number().min(0).max(100).optional(),
  // See StorySlide.custom_text_color's own comment
  // (app/api/v1/ai/stories/generate/route.ts).
  custom_text_color: z.string().max(20).nullish(),
  // Which curated font renders this slide's text -- see
  // StoryCompositeSlide.font_id's own comment (lib/image/story-compositor.ts).
  font_id: fontIdEnum.nullish(),
  // Uniform font-size multiplier for this slide -- see
  // StoryCompositeSlide.text_size_scale's own comment.
  text_size_scale: z.number().min(0.7).max(1.5).nullish(),
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
    // Upload in parallel so the schedule path can send small hosted URLs
    // instead of shuttling several MB of base64 back through the browser
    // and re-uploading it — imageUrls (data: URLs) stays as-is so the
    // existing "Save as PNG" download flow (story-export.ts's
    // downloadStorySlideAsImage/downloadStorySlidesAsImages) is untouched.
    const hostedResults = await Promise.all(
      buffers.map((buf, i) => uploadMediaToStorage({ kind: "buffer", buffer: buf, mimeType: "image/png" }, `story-renders/${user.id}-${Date.now()}-${i}`))
    )
    const hostedUrls = hostedResults.every(r => "publicUrl" in r) ? hostedResults.map(r => (r as { publicUrl: string }).publicUrl) : null
    return NextResponse.json({ data: { imageUrls, hostedUrls } })
  } catch (err) {
    console.error("[ai/stories/render] compositing failed:", err instanceof Error ? err.message : err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't render the story image. Please try again."), { status: 500 })
  }
}
