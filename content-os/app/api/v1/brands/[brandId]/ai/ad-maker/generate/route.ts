import { NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { checkAndIncrementUsage, refundGenerationUsage } from "@/lib/usage/check-and-increment-usage"
import { AD_MAKER } from "@/lib/usage/credit-costs"
import { generateAdMakerBackgroundSchema } from "@/lib/validations/ai"
import { generateAdMakerBackground } from "@/lib/ai/ad-maker-background"
import { isInternalUnlimited } from "@/lib/usage/is-internal-unlimited"
import type { BrandRow } from "@/types/database"
import type { UserPlan } from "@/types/app"

const BUCKET = "brand-images"

type RouteParams = { params: Promise<{ brandId: string }> }

// Chains up to 2 sequential Pollinations/Flux calls (primary attempt + a
// fallback-prompt retry) inside fetchBackgroundImage, same headroom as
// other slow-external-call routes (e.g. app/api/v1/ai/post-image/generate/route.ts).
export const maxDuration = 60

const VARIATION_COUNT = 3

/**
 * Charges credits and generates Ad Maker's 3 background-image variations
 * server-side via the shared fetchBackgroundImage pipeline (plan-based
 * Pollinations/Flux resolution, retry-with-fallback-prompt, quality checks)
 * -- previously this route was a credit-charge no-op and each of the 3
 * backgrounds was fetched entirely client-side, straight from Pollinations
 * (no Flux path for paid plans), sequentially, each with its own bespoke
 * retry loop -- the actual source of the "slow/unreliable" complaint. The 3
 * generateAdMakerBackground calls below run concurrently (each internally
 * picks its own random seed, so they naturally come out distinct) and only
 * one credit charge covers all 3, same as before. Canvas compositing
 * (product photo + text + logo) still happens client-side in AdMaker.tsx,
 * using the storage URLs this route returns as the background layer for
 * each of the 3 variations.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { brandId } = await params
  console.log(`[ai/ad-maker/generate] POST called for brand ${brandId}`)

  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[ai/ad-maker/generate] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })

  const { data: brand } = await supabase.from("brands").select("*").eq("id", brandId).eq("user_id", user.id).single<BrandRow>()
  if (!brand) return NextResponse.json(buildError(ErrorCodes.BRAND_NOT_FOUND, "Brand not found."), { status: 404 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = generateAdMakerBackgroundSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Validation failed.", parsed.error.message), { status: 400 })
  const { scene, customScene, format } = parsed.data

  const usageCheck = await checkAndIncrementUsage(user.id, AD_MAKER)
  if (!usageCheck.ok) {
    const code = usageCheck.status === 429 ? ErrorCodes.USAGE_LIMIT_EXCEEDED : ErrorCodes.INTERNAL_ERROR
    return NextResponse.json(buildError(code, usageCheck.message), { status: usageCheck.status })
  }

  // Determines the image provider (Free -> Pollinations, paid -> Flux) --
  // same lookup every other generation route uses.
  const { data: userData } = await supabase.from("users").select("plan").eq("id", user.id).single<{ plan: UserPlan }>()
  const plan: UserPlan = userData?.plan ?? "free"

  const startTime = Date.now()
  const backgroundOptions = {
    scene,
    customScene,
    brandNiche: brand.niche,
    format,
    plan,
    isInternalUnlimitedUser: isInternalUnlimited(user.id),
  }
  const results = await Promise.all(
    Array.from({ length: VARIATION_COUNT }, () => generateAdMakerBackground(backgroundOptions))
  )

  const failed = results.find((r) => !r.success)
  if (failed && !failed.success) {
    console.error(`[ai/ad-maker/generate] background generation failed after ${Date.now() - startTime}ms:`, failed.error)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("ai_generation_logs") as any).insert({
      user_id: user.id, brand_id: brandId, feature: "ad_maker", model: "unknown",
      latency_ms: Date.now() - startTime, success: false, error_message: failed.error,
    })
    await refundGenerationUsage(supabase, user.id, AD_MAKER)
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Couldn't generate a background. Please try again."), { status: 500 })
  }

  // Upload via the admin client -- storage RLS expects the path to start
  // with the user's auth uid, admin bypasses RLS safely here since brand
  // ownership is already verified above (same pattern as images/generate).
  const admin = await createAdminClient()
  const uploads = await Promise.all(
    results.map(async (result, i) => {
      if (!result.success) return null
      const ext = result.mimeType.includes("jpeg") ? "jpg" : "png"
      const storagePath = `${user.id}/${brandId}/ad-maker-${Date.now()}-${i}-${crypto.randomUUID()}.${ext}`
      const { error: uploadError } = await admin.storage
        .from(BUCKET)
        .upload(storagePath, result.buffer, { contentType: result.mimeType, upsert: false })
      return uploadError ? null : storagePath
    })
  )

  if (uploads.some((path) => !path)) {
    // At least one variation was generated but never actually delivered to
    // the user -- no usable full set of output, same as a generation failure.
    await refundGenerationUsage(supabase, user.id, AD_MAKER)
    return NextResponse.json(
      buildError(ErrorCodes.INTERNAL_ERROR, "Backgrounds generated but upload to storage failed."),
      { status: 500 }
    )
  }

  const backgroundUrls = uploads.map((path) => admin.storage.from(BUCKET).getPublicUrl(path as string).data.publicUrl)
  const firstSuccess = results.find((r) => r.success)
  const provider = firstSuccess && firstSuccess.success ? firstSuccess.provider : "unknown"

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from("ai_generation_logs") as any).insert({
    user_id: user.id, brand_id: brandId, feature: "ad_maker", model: provider,
    latency_ms: Date.now() - startTime, success: true,
  })

  return NextResponse.json({ data: { background_urls: backgroundUrls } }, { status: 200 })
}
