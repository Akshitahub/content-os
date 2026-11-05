import type { createAdminClient } from "@/lib/supabase/server"

// The critic and its "Make it better" text fix (app/api/v1/ai/critic/**)
// charge no credit, so calls are bounded per user per day instead --
// counted from the critic_scored content events the critic records.
export const CRITIC_DAILY_LIMIT = 60

export async function criticLimitReached(admin: Awaited<ReturnType<typeof createAdminClient>>, userId: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count } = await (admin.from("content_events" as any) as any)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId).eq("event", "critic_scored")
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) as { count: number | null }
  return (count ?? 0) >= CRITIC_DAILY_LIMIT
}
