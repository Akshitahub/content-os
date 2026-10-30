import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { fetchPage, PageFetchError } from "@/lib/web/fetch-page"
import { extractBrandFromPage, extractImagesFromPage, ExtractionError } from "@/lib/ai/url-extractor"
import type { BrandRow } from "@/types/database"
import { z } from "zod"
import { isMissingBrandBrainColumn, parseBrandBrain } from "@/lib/brand-brain-profile"
import { scheduleArtDirection } from "@/lib/ai/art-direction"
import { scheduleBrandPhotoSync } from "@/lib/brand-photos"

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
        { data: null, scrape_failed: true, message: "We couldn't extract enough information from that website. Please fill in your brand details manually." },
        { status: 200 }
      )
    }

    // The Brand Brain parts the page itself states (060), normalized.
    const brandBrain = parseBrandBrain({
      facts: {
        differentiators: extracted.differentiators,
        customer_problems: extracted.customer_problems,
        verified_claims: extracted.verified_claims.map((claim) => ({ claim, source_url: parsed.data.url })),
      },
      voice: { phrases_to_use: extracted.phrases_to_use },
      visual: { photography_style: extracted.photography_style },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insertBrand = (row: Record<string, unknown>) => (supabase.from("brands") as any).insert(row).select().single() as Promise<{ data: BrandRow | null; error: { code?: string; message: string } | null }>
    const brandRow = {
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
        positioning: extracted.positioning || null,
        content_pillars: extracted.content_pillars ?? [],
        target_emotion: extracted.target_emotion || null,
        vibe: extracted.vibe || "fun_playful",
      }
    let { data: brand, error: insertError } = await insertBrand({ ...brandRow, brand_brain: brandBrain })
    // Migration 060 not run yet -- save the brand without its Brand Brain
    // rather than failing the whole import.
    if (isMissingBrandBrainColumn(insertError)) {
      console.error("[brands/import] brand_brain column missing (run migration 060) -- saving without it")
      ;({ data: brand, error: insertError } = await insertBrand(brandRow))
    }

    if (insertError) {
      console.error("[brands/import] insert error:", insertError)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to save brand.", insertError.message), { status: 500 })
    }

    // Its art direction (lib/ai/art-direction.ts), derived after the response.
    if (brand?.id) scheduleArtDirection(brand.id)
    // Its real photos (the site's images saved below + Instagram), copied and classified after the response.
    if (brand?.id) scheduleBrandPhotoSync(brand.id)

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
      return NextResponse.json(
        { data: null, scrape_failed: true, message: `Couldn't fetch that page: ${err.message}` },
        { status: 200 }
      )
    }
    if (err instanceof ExtractionError) {
      return NextResponse.json(
        { data: null, scrape_failed: true, message: `AI extraction failed: ${err.message}` },
        { status: 200 }
      )
    }
    return NextResponse.json(
      { data: null, scrape_failed: true, message: `Unexpected error during import: ${err instanceof Error ? err.message : String(err)}` },
      { status: 200 }
    )
  }
}
