import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { syncEngagementForBrand } from "@/lib/social/engagement-sync"
import { runPerformanceLearning } from "@/lib/ai/performance-learning"

// Weekly (vercel.json): for every brand with an active Instagram connection,
// refresh its posts' real engagement (likes, comments, saves, shares, reach),
// then learn from it (lib/ai/performance-learning.ts) once it has enough
// posted items. Brands run one after another; each is fail-soft.
export const maxDuration = 300

const TIME_BUDGET_MS = 270_000

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  if (request.headers.get("authorization") === `Bearer ${secret}`) return true
  return new URL(request.url).searchParams.get("secret") === secret
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    console.error("[cron/learn-from-results] unauthorized request")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const startedAt = Date.now()
  const admin = await createAdminClient()
  const { data: connections, error } = await admin.from("social_connections")
    .select("brand_id, zernio_account_id").eq("platform", "instagram").eq("is_active", true)
    .returns<{ brand_id: string; zernio_account_id: string | null }[]>()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const summary = { brands: 0, learned: 0, notEnough: 0, lessons: 0, skippedForTime: 0 }
  for (const c of connections ?? []) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      summary.skippedForTime++
      continue
    }
    summary.brands++
    try {
      if (c.zernio_account_id) {
        const sync = await syncEngagementForBrand(admin, c.brand_id, c.zernio_account_id)
        if (sync.errors.length) console.error(`[cron/learn-from-results] brand ${c.brand_id} engagement sync:`, sync.errors.slice(0, 3).join("; "))
      }
      const report = await runPerformanceLearning(admin, c.brand_id)
      if (report.status === "not_enough") summary.notEnough++
      else {
        summary.learned++
        summary.lessons += report.written
        if (report.errors.length) console.error(`[cron/learn-from-results] brand ${c.brand_id} lessons:`, report.errors.slice(0, 3).join("; "))
      }
    } catch (err) {
      console.error(`[cron/learn-from-results] brand ${c.brand_id} failed (non-fatal):`, err instanceof Error ? err.message : err)
    }
  }
  console.log("[cron/learn-from-results] done:", summary)
  return NextResponse.json({ data: summary })
}
