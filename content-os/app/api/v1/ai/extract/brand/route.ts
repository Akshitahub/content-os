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
    if (err instanceof PageFetchError || err instanceof ExtractionError) {
      return NextResponse.json(
        { data: null, scrape_failed: true, message: "We couldn't access this website automatically — some brands block this for security reasons. Please fill in your brand details manually." },
        { status: 200 }
      )
    }
    return NextResponse.json(
      { data: null, scrape_failed: true, message: "We couldn't access this website automatically — some brands block this for security reasons. Please fill in your brand details manually." },
      { status: 200 }
    )
  }
}
