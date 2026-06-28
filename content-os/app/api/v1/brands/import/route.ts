import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { fetchPage, PageFetchError } from "@/lib/web/fetch-page"
import { extractBrandFromPage, extractImagesFromPage, ExtractionError } from "@/lib/ai/url-extractor"
import type { BrandRow } from "@/types/database"
import { z } from "zod"

const importSchema = z.object({
  url: z.string().url("Enter a valid URL (include https://)"),
})

export async function POST(request: Request) {
  console.log("[brands/import] POST called")

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[brands/import] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = importSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Enter a valid URL.", parsed.error.message), { status: 400 })
  }

  try {
    const page = await fetchPage(parsed.data.url)
    const extracted = await extractBrandFromPage(page)

    if (!extracted.name) {
      return NextResponse.json(
        buildError(ErrorCodes.VALIDATION_ERROR, "Couldn't extract brand info from that URL. Try your homepage or about page."),
        { status: 422 }
      )
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: brand, error: insertError } = await (supabase.from("brands") as any)
      .insert({
        user_id: user.id,
        name: extracted.name,
        description: extracted.description || null,
        niche: extracted.niche || null,
        target_audience: extracted.target_audience || null,
        tone_of_voice: extracted.tone_of_voice || null,
        brand_values: extracted.brand_values ?? [],
        website_url: parsed.data.url,
        instagram_handle: extracted.instagram_handle || null,
        logo_url: extracted.logo_url || null,
        primary_color: extracted.primary_color || null,
        cta_phrase: extracted.cta_phrase || "Shop now",
        brand_personality: extracted.brand_personality || null,
        content_pillars: extracted.content_pillars ?? [],
        target_emotion: extracted.target_emotion || null,
        vibe: extracted.vibe || "fun_playful",
      })
      .select()
      .single() as { data: BrandRow | null; error: { message: string } | null }

    if (insertError) {
      console.error("[brands/import] insert error:", insertError)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to save brand.", insertError.message), { status: 500 })
    }

    // Extract and save brand images (non-blocking, non-fatal)
    if (brand?.id) {
      try {
        const images = extractImagesFromPage(parsed.data.url, page.html)
        if (images.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase.from("brand_images") as any).insert(
            images.map(img => ({
              brand_id: brand.id,
              url: img.url,
              alt: img.alt || null,
              type: img.type,
            }))
          )
        }
      } catch (imgErr) {
        console.error("[brands/import] image extraction failed (non-fatal):", imgErr)
      }
    }

    return NextResponse.json({ data: brand }, { status: 201 })
  } catch (err) {
    console.error("[brands/import] error:", err)
    if (err instanceof PageFetchError) {
      return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, err.message), { status: 422 })
    }
    if (err instanceof ExtractionError) {
      return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, err.message), { status: 500 })
    }
    const msg = err instanceof Error ? err.message : "Something went wrong importing that URL."
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, msg), { status: 500 })
  }
}
