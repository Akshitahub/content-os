import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { extractFromUrlSchema } from "@/lib/validations/ai"
import { fetchPage, PageFetchError } from "@/lib/web/fetch-page"
import { extractBrandFromPage, ExtractionError } from "@/lib/ai/url-extractor"
import { buildError, ErrorCodes } from "@/types/api"

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = extractFromUrlSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Enter a valid URL.", parsed.error.message), { status: 400 })
  }

  try {
    const page = await fetchPage(parsed.data.url)
    const extracted = await extractBrandFromPage(page)
    return NextResponse.json({ data: extracted }, { status: 200 })
  } catch (err) {
    if (err instanceof PageFetchError) {
      return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, err.message), { status: 422 })
    }
    if (err instanceof ExtractionError) {
      return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, err.message), { status: 500 })
    }
    return NextResponse.json(
      buildError(ErrorCodes.INTERNAL_ERROR, "Something went wrong reading that page.", err instanceof Error ? err.message : undefined),
      { status: 500 }
    )
  }
}
