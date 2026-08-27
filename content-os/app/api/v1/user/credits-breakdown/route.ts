import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"

// Maps a raw ai_generation_logs.feature value to the label shown in the
// credits breakdown -- several distinct DB feature names represent the
// same thing from the user's point of view (e.g. a carousel generated via
// the dedicated Carousel builder, the standalone Content tab, or the Full
// Post flow are all just "a carousel" to them), so those merge into one
// bucket rather than showing as three near-duplicate rows.
const FEATURE_LABELS: Record<string, string> = {
  hooks: "Hooks",
  captions: "Captions",
  images: "Images",
  ad_maker: "Ad Maker",
  post_image: "Posts",
  remove_background: "Background Removal",
  repurpose: "Repurpose",
  calendar_regenerate: "Calendar Regenerate",
  autopilot_slot: "Autopilot",
  fullpost_photo_upload: "Posts (photo upload)",
  blog_post: "Blog Posts",
  carousel: "Carousels",
  story: "Stories",
}

// content_${format} and fullpost_${format} (see lib/usage/credit-costs.ts's
// CONTENT_FORMAT_CREDIT_COSTS) share this same format-name suffix --
// mapped to the same label as their standalone-route equivalent above so
// e.g. "carousel", "content_carousel", and "fullpost_carousel" all land in
// one "Carousels" bucket.
const FORMAT_LABELS: Record<string, string> = {
  social_post: "Posts",
  reel_script: "Reel Scripts",
  story: "Stories",
  carousel: "Carousels",
  blog_post: "Blog Posts",
  ad_copy: "Ad Copy",
}

function displayLabel(feature: string): string {
  if (feature in FEATURE_LABELS) return FEATURE_LABELS[feature]!
  const match = feature.match(/^(?:content|fullpost)_(.+)$/)
  const format = match?.[1]
  if (format && format in FORMAT_LABELS) return FORMAT_LABELS[format]!
  // Fallback for any future feature name that isn't mapped yet -- title-
  // cased so it still shows up somewhere instead of silently vanishing
  // from the breakdown.
  return feature.split("_").map((w) => (w[0] ?? "").toUpperCase() + w.slice(1)).join(" ")
}

export async function GET() {
  let supabase
  try {
    supabase = await createClient()
  } catch {
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "Not logged in."), { status: 401 })
  }

  const { data: userData } = await supabase
    .from("users")
    .select("generation_count_reset_at")
    .eq("id", user.id)
    .single<{ generation_count_reset_at: string | null }>()

  // Same "has the stored reset timestamp actually passed" check
  // /api/v1/user/profile uses for the main credit counter -- the current
  // billing period started one month before that timestamp (it's always
  // set to "now + 1 month" at charge time, see charge_generation_usage in
  // supabase/migrations/036_atomic_generation_usage.sql), UNLESS the
  // period boundary has already passed and no charge has landed in the
  // new one yet, in which case there's nothing to show and "now" is as
  // good an approximation of the period start as any.
  const resetAt = userData?.generation_count_reset_at ? new Date(userData.generation_count_reset_at) : null
  const shouldReset = !resetAt || resetAt <= new Date()
  let periodStart: Date
  if (shouldReset) {
    periodStart = new Date()
  } else {
    periodStart = new Date(resetAt)
    periodStart.setMonth(periodStart.getMonth() - 1)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows, error } = await (supabase.from("ai_generation_logs") as any)
    .select("feature, credits_charged")
    .eq("user_id", user.id)
    .gte("created_at", periodStart.toISOString()) as { data: { feature: string; credits_charged: number | null }[] | null; error: { message: string } | null }

  if (error) {
    console.error("[user/credits-breakdown] query failed:", error.message)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Could not load credits breakdown."), { status: 500 })
  }

  const byLabel = new Map<string, { credits: number; count: number }>()
  for (const row of rows ?? []) {
    const credits = row.credits_charged ?? 0
    // A refunded/failed charge is zeroed out by refundGenerationUsage --
    // excluded entirely (not just $0) so a failed generation doesn't
    // inflate the generation count for a bucket that made no real money
    // move at all.
    if (credits <= 0) continue
    const label = displayLabel(row.feature)
    const existing = byLabel.get(label) ?? { credits: 0, count: 0 }
    existing.credits += credits
    existing.count += 1
    byLabel.set(label, existing)
  }

  const breakdown = Array.from(byLabel.entries())
    .map(([label, { credits, count }]) => ({ label, credits, count }))
    .sort((a, b) => b.credits - a.credits)

  return NextResponse.json({ data: { breakdown, periodStart: periodStart.toISOString() } })
}
