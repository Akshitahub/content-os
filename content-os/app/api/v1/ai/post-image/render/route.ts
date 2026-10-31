import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import type { BrandRow } from "@/types/database"
import { renderPostDesign } from "@/lib/image/post-design"
import { postDesignSchema } from "@/lib/design/post-design-fields"

// Renders a designed feed post (lib/image/post-design.ts) from its clean
// base photo and its design -- the Full Post editor's live preview / the
// image that's downloaded and scheduled, and the calendar's "Edit text on
// image". Nothing is generated and nothing is charged: it only draws.
export const maxDuration = 60

const schema = z.object({
  brandId: z.string().uuid(),
  // The post's own clean base photo (our storage) -- never a data URL here.
  baseImageUrl: z.string().url().max(2000).regex(/^https?:\/\//),
  design: postDesignSchema,
  aspectRatio: z.enum(["4:5", "1:1", "9:16"]).optional(),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.issues[0]?.message), { status: 400 })

  const { brandId, baseImageUrl, design, aspectRatio } = parsed.data
  // The brand's palette, fonts, logo and name come from its own row.
  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  try {
    const jpg = await renderPostDesign(brand, baseImageUrl, design, aspectRatio ?? design.aspect)
    return NextResponse.json({ data: { image_url: `data:image/jpeg;base64,${jpg.toString("base64")}` } })
  } catch (err) {
    console.error("[ai/post-image/render] couldn't render the post (non-fatal):", err instanceof Error ? err.message : err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't render the post. Please try again."), { status: 500 })
  }
}
