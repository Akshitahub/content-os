import { NextResponse, after } from "next/server"

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
//             'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')),
//           timeout_milliseconds := 30000)
//         WHERE EXISTS (SELECT 1 FROM public.autopilot_slot_jobs
//                        WHERE status = 'pending' OR (status = 'running' AND lease_expires_at < NOW()));
//       $$);
//
//     (Re-running cron.schedule with the same name replaces the job.)
//     timeout_milliseconds: pg_net's default is 5s, which a cold start of
//     this route could exceed -- pg_net then drops the request.
//
//     cron.job_run_details only shows that pg_net QUEUED the request --
//     "succeeded" even if the route answered 401 or never answered. Whether
//     the route was reached and accepted it is in net._http_response:
//
//       SELECT created, status_code, timed_out, error_msg, left(content, 200)
//         FROM net._http_response ORDER BY created DESC LIMIT 10;
//
//     202 = accepted (the pass runs after it; see "[cron/autopilot-drain]"
//     in the Vercel logs). 401 = the vault secret and Vercel's CRON_SECRET
//     differ. timed_out = cold start over the timeout.
//
//   - app/api/v1/brands/fastlane/route.ts, once, right after enqueueing a
//     run, so the first slots start immediately.
//
// 300s = Hobby maximum with fluid compute (vercel.com/docs/functions/
// configuring-functions/duration, checked 2026-10-26). Each slot's lease is
// 285s and its generation must finish 25s before that, so a pass always
// ends inside this limit; anything slower loses its lease and is retried.
export const maxDuration = 300

// Returns why a call was rejected, or null if authorized. Whitespace is
// trimmed on both sides: a secret pasted into Vault or Vercel with a
// trailing newline otherwise never matches. Neither value is ever logged.
function authFailure(request: Request): string | null {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return "CRON_SECRET is not set on this deployment"
  const header = request.headers.get("authorization")?.trim()
  if (!header) return "no Authorization header"
  if (!header.startsWith("Bearer ")) return "Authorization header is not a Bearer token"
  if (header.slice("Bearer ".length).trim() !== secret) return "Bearer token does not match CRON_SECRET"
  return null
}

function handle(request: Request) {
  const failure = authFailure(request)
  if (failure) {
    console.error(`[cron/autopilot-drain] rejected (401): ${failure}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  // Every accepted call and its outcome is logged (the cron only calls
  // while work is waiting, so this isn't noisy when idle) -- "claimed 0"
  // with slots pending points at the claim RPC or the running cap.
  console.log(`[cron/autopilot-drain] accepted ${request.method}`)
  after(async () => {
    const startedAt = Date.now()
    try {
      // Imported here, not at the top: the worker pulls in the whole
      // generation stack, and loading it before answering slows the 202
      // on a cold start, past pg_net's default 5s timeout.
      const { drainAutopilotQueue } = await import("@/lib/ai/autopilot-worker")
      const { claimed } = await drainAutopilotQueue()
      console.log(`[cron/autopilot-drain] pass done: claimed ${claimed} slot(s) in ${Date.now() - startedAt}ms`)
    } catch (err) {
      console.error(`[cron/autopilot-drain] pass crashed after ${Date.now() - startedAt}ms:`, err instanceof Error ? err.message : err)
    }
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
