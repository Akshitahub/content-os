import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"

/**
 * Per-user request limits, counted in Supabase (migration 073's
 * consume_rate_limit -- fixed windows, one atomic upsert per check). No
 * Redis. Fails OPEN: if the limiter can't be reached (or the migration
 * hasn't run), the request is allowed and the error logged, so a limiter
 * outage never blocks paying users.
 */

/** True when this request is within `limit` per `windowSeconds` for `key` (and counts it). */
export async function checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const admin = await createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin as any).rpc("consume_rate_limit", { p_key: key, p_limit: limit, p_window_seconds: windowSeconds }) as { data: boolean | null; error: { message: string } | null }
    if (error) {
      console.error(`[rate-limit] check failed for ${key.split(":")[0]}, allowing:`, error.message)
      return true
    }
    return data !== false
  } catch (err) {
    console.error("[rate-limit] check failed, allowing:", err instanceof Error ? err.message : err)
    return true
  }
}

export type RateLimitBucket = "generate" | "image" | "extract" | "slide"

type Limit = { counter: string; limit: number; windowSeconds: number }

// "image" routes also count against "generate" -- an image generation is a generation.
const GENERATE: Limit[] = [
  { counter: "generate", limit: 15, windowSeconds: 60 },
  { counter: "generate", limit: 150, windowSeconds: 3600 },
]
const BUCKETS: Record<RateLimitBucket, Limit[]> = {
  generate: GENERATE,
  image: [...GENERATE, { counter: "image", limit: 6, windowSeconds: 60 }, { counter: "image", limit: 60, windowSeconds: 3600 }],
  extract: [
    { counter: "extract", limit: 10, windowSeconds: 60 },
    { counter: "extract", limit: 60, windowSeconds: 3600 },
  ],
  // Per-slide images: CarouselBuilder / StorySequence call these once per
  // slide (up to 10 back to back), and the parent carousel / stories call
  // already counted against "generate" -- so their own counter only, not
  // generate or image. Credits still cap the cost.
  slide: [
    { counter: "slide", limit: 40, windowSeconds: 60 },
    { counter: "slide", limit: 300, windowSeconds: 3600 },
  ],
}

/**
 * Every limit for `bucket` must pass. Returns the 429 response to send, or
 * null when the request may go ahead. Call right after auth, before any
 * credit is charged.
 */
export async function enforceRateLimits(userId: string, bucket: RateLimitBucket): Promise<NextResponse | null> {
  const limits = BUCKETS[bucket]
  const results = await Promise.all(limits.map((l) => checkRateLimit(`${l.counter}:${userId}:${l.windowSeconds}`, l.limit, l.windowSeconds)))
  const failed = limits.filter((_, i) => !results[i])
  if (failed.length === 0) return null

  // Seconds until the longest window that refused this request resets.
  const nowSeconds = Math.floor(Date.now() / 1000)
  const retryAfter = Math.max(...failed.map((l) => l.windowSeconds - (nowSeconds % l.windowSeconds)), 1)
  console.log(`[rate-limit] user ${userId} limited on ${bucket} (${failed.map((l) => `${l.counter}/${l.windowSeconds}s`).join(", ")})`)
  return NextResponse.json(
    buildError(ErrorCodes.RATE_LIMITED, "You're generating too fast — try again in a minute."),
    { status: 429, headers: { "Retry-After": String(retryAfter) } }
  )
}
