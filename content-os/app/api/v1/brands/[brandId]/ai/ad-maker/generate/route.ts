import { NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { checkAndIncrementUsage, refundGenerationUsage, logGenerationOutcome } from "@/lib/usage/check-and-increment-usage"
import { AD_MAKER } from "@/lib/usage/credit-costs"

const FEATURE = "ad_maker"
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

// Confirmed live (2026-08-25), not assumed: firing all 3 variations via a
// plain Promise.all collided directly with Pollinations' own per-IP
// concurrency ceiling -- its rejection response literally says "Queue
// full for IP ...: 1 requests already queued (max: 1)". Across repeated
// real runs this failed 2 or all 3 of the 3 variations in the same batch
// almost every time (2/3, 3/3, 3/3 across three consecutive rounds), which
// is why a feature requiring all three to succeed was failing near-100%
// of the time. A single Pollinations call itself takes several seconds
// end to end, so this stagger reduces how many kickoffs land in the exact
// same instant -- it does NOT eliminate collisions on its own (a later
// variation can still land while an earlier one is mid-flight), which is
// exactly why it's paired with the partial-success handling below rather
// than relied on alone.
const STAGGER_MS = 400

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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
  const { scene, customScene, format, productImageBase64 } = parsed.data

  const usageCheck = await checkAndIncrementUsage(user.id, AD_MAKER, FEATURE)
  if (!usageCheck.ok) {
    const code = usageCheck.status === 429 ? ErrorCodes.USAGE_LIMIT_EXCEEDED : ErrorCodes.INTERNAL_ERROR
    return NextResponse.json(buildError(code, usageCheck.message), { status: usageCheck.status })
  }
  const logId = usageCheck.logId

  // Determines the image provider (Free -> Pollinations, paid -> Flux) --
  // same lookup every other generation route uses.
  const { data: userData } = await supabase.from("users").select("plan").eq("id", user.id).single<{ plan: UserPlan }>()
  const plan: UserPlan = userData?.plan ?? "starter"

  const startTime = Date.now()

  // Upload via the admin client -- storage RLS expects the path to start
  // with the user's auth uid, admin bypasses RLS safely here since brand
  // ownership is already verified above (same pattern as images/generate).
  // Created here (not just below, where background uploads happen) so the
  // product reference photo can be uploaded before generation kicks off.
  const admin = await createAdminClient()

  // A real uploaded product photo, used as a Flux image-to-image reference
  // (see generateAdMakerBackground/fetchAndCheckFluxImage) -- optional, so
  // an upload failure here degrades to the old background-only behavior
  // rather than failing the whole request.
  let productImageUrl: string | undefined
  if (productImageBase64) {
    try {
      const productImageBuffer = Buffer.from(productImageBase64, "base64")
      const productImagePath = `${user.id}/${brandId}/ad-maker-product-${Date.now()}-${crypto.randomUUID()}.png`
      const { error: productUploadError } = await admin.storage
        .from(BUCKET)
        .upload(productImagePath, productImageBuffer, { contentType: "image/png", upsert: false })
      if (productUploadError) {
        console.error(`[ai/ad-maker/generate] product image upload failed, continuing without a reference image:`, productUploadError)
      } else {
        productImageUrl = admin.storage.from(BUCKET).getPublicUrl(productImagePath).data.publicUrl
      }
    } catch (err) {
      console.error(`[ai/ad-maker/generate] product image decode/upload threw, continuing without a reference image:`, err)
    }
  }

  const backgroundOptions = {
    scene,
    customScene,
    brandNiche: brand.niche,
    format,
    plan,
    isInternalUnlimitedUser: isInternalUnlimited(user.id),
    productImageUrl,
  }
  const results = await Promise.all(
    Array.from({ length: VARIATION_COUNT }, async (_, i) => {
      if (i > 0) await sleep(i * STAGGER_MS)
      return generateAdMakerBackground(backgroundOptions)
    })
  )

  // Partial success is the normal case now, not a failure -- zero usable
  // output is the only thing that actually justifies failing the whole
  // request (and refunding). Previously a single failed variation out of
  // 3 failed everything, even when the other two succeeded fine.
  const successes = results.filter((r): r is Extract<(typeof results)[number], { success: true }> => r.success)

  if (successes.length === 0) {
    const firstFailure = results.find((r): r is Extract<(typeof results)[number], { success: false }> => !r.success)
    console.error(`[ai/ad-maker/generate] all ${VARIATION_COUNT} background variations failed after ${Date.now() - startTime}ms:`, firstFailure?.error)
    await logGenerationOutcome(supabase, logId, {
      user_id: user.id, brand_id: brandId, feature: FEATURE, model: "unknown",
      latency_ms: Date.now() - startTime, success: false, error_message: firstFailure?.error ?? "All variations failed",
    })
    await refundGenerationUsage(supabase, user.id, AD_MAKER, logId)
    return NextResponse.json(buildError(ErrorCodes.AI_GENERATION_FAILED, "Couldn't generate a background. Please try again."), { status: 500 })
  }

  const uploadedPaths = (
    await Promise.all(
      successes.map(async (result, i) => {
        const ext = result.mimeType.includes("jpeg") ? "jpg" : "png"
        const storagePath = `${user.id}/${brandId}/ad-maker-${Date.now()}-${i}-${crypto.randomUUID()}.${ext}`
        const { error: uploadError } = await admin.storage
          .from(BUCKET)
          .upload(storagePath, result.buffer, { contentType: result.mimeType, upsert: false })
        return uploadError ? null : storagePath
      })
    )
  ).filter((path): path is string => !!path)

  if (uploadedPaths.length === 0) {
    // Same partial-success reasoning as generation above -- a variation
    // that generated but never actually made it to storage isn't usable
    // output either. Only fatal if NONE of the successfully-generated
    // variations could be uploaded.
    await refundGenerationUsage(supabase, user.id, AD_MAKER, logId)
    return NextResponse.json(
      buildError(ErrorCodes.INTERNAL_ERROR, "Backgrounds generated but upload to storage failed."),
      { status: 500 }
    )
  }

  const backgroundUrls = uploadedPaths.map((path) => admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl)
  const provider = successes[0]!.provider

  await logGenerationOutcome(supabase, logId, {
    user_id: user.id, brand_id: brandId, feature: FEATURE, model: provider,
    latency_ms: Date.now() - startTime, success: true,
  })

  const variations = successes.map((r, i) => ({ url: backgroundUrls[i], provider: r.provider }))

  return NextResponse.json({ data: { variations } }, { status: 200 })
}
