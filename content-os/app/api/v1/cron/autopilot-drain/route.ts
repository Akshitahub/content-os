import { NextResponse, after } from "next/server"
import { drainAutopilotQueue } from "@/lib/ai/autopilot-worker"

// Background Autopilot drain (see lib/ai/autopilot-worker.ts and
// supabase/migrations/057_autopilot_slot_jobs.sql). Answers 202 at once
// and runs one drain pass after the response: claim up to 3 waiting slots
// (max 6 running across all users), generate, commit + charge, save.
//
// Called by:
//   - a Supabase Cron job every 20s, only while slots are waiting or a
//     lease has expired (so it costs nothing when idle) -- create it ONCE
//     in the Supabase SQL Editor, after migration 057 and after deploying
//     this route:
//
//       SELECT vault.create_secret('<your CRON_SECRET>', 'cron_secret');
//       SELECT cron.schedule('autopilot-drain', '20 seconds', $$
//         SELECT net.http_post(
//           url := 'https://www.socioposts.com/api/v1/cron/autopilot-drain',
//           headers := jsonb_build_object('Authorization',
//             'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')))
//         WHERE EXISTS (SELECT 1 FROM public.autopilot_slot_jobs
//                        WHERE status = 'pending' OR (status = 'running' AND lease_expires_at < NOW()));
//       $$);
//
//   - app/api/v1/brands/fastlane/route.ts, once, right after enqueueing a
//     run, so the first slots start immediately.
//
// 300s = Hobby maximum with fluid compute (vercel.com/docs/functions/
// configuring-functions/duration, checked 2026-10-26). Each slot's lease is
// 285s and its generation must finish 25s before that, so a pass always
// ends inside this limit; anything slower loses its lease and is retried.
export const maxDuration = 300

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return request.headers.get("authorization") === `Bearer ${secret}`
}

function handle(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  after(async () => {
    const startedAt = Date.now()
    const { claimed } = await drainAutopilotQueue()
    if (claimed > 0) console.log(`[cron/autopilot-drain] pass done: ${claimed} slot(s) in ${Date.now() - startedAt}ms`)
  })
  return NextResponse.json({ data: { accepted: true } }, { status: 202 })
}

// POST from Supabase Cron (pg_net) and the fastlane route; GET for a manual trigger.
export async function POST(request: Request) {
  return handle(request)
}

export async function GET(request: Request) {
  return handle(request)
}
