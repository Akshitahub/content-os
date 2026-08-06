import { createClient } from "@/lib/supabase/server"

/**
 * "Regenerate image" should be free on its first press and charged (via
 * checkAndIncrementUsage) from the second press onward — but that can't be
 * decided from a client-supplied "is this a regenerate" flag, since a
 * client could just always claim the free case. Instead, a session row is
 * created once per "Generate full post" click, and this counts actual
 * calls to the post-image route against it: call #1 (the true initial
 * generation) charges, call #2 (first regenerate) is free, call #3+
 * charges again. The server — not the client — is the source of truth for
 * which call number this is.
 */

export async function createPostImageSession(userId: string): Promise<{ sessionId: string } | { error: string }> {
  const supabase = await createClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from("post_image_generation_sessions") as any)
    .insert({ user_id: userId })
    .select("id")
    .single() as { data: { id: string } | null; error: { message: string; details?: string; hint?: string; code?: string } | null }

  if (error || !data) {
    // Log the full Postgres/PostgREST error shape, not just .message — the
    // code (e.g. 42P01 "relation does not exist") and hint are what
    // actually distinguish "migration never ran" from an RLS/permission
    // issue or a transient connection failure.
    console.error(
      `[post-image-regenerate-session] createPostImageSession failed for user ${userId}:`,
      JSON.stringify({ message: error?.message, details: error?.details, hint: error?.hint, code: error?.code })
    )
    return { error: error?.message ?? "Failed to start image generation session." }
  }

  return { sessionId: data.id }
}

export type SessionChargeResult =
  | { ok: true; shouldCharge: boolean }
  | { ok: false }

/**
 * Reads and increments the session's call count in one round trip, and
 * reports whether THIS call (the one that just incremented it) should be
 * charged. If the session can't be found (stale/invalid id, or it belongs
 * to a different user), fails closed — treats the call as chargeable
 * rather than risking a free generation.
 */
export async function checkAndIncrementPostImageSession(userId: string, sessionId: string): Promise<SessionChargeResult> {
  const supabase = await createClient()

  const { data: session, error } = await supabase
    .from("post_image_generation_sessions")
    .select("image_generation_count")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single<{ image_generation_count: number }>()

  if (error || !session) {
    console.error(
      `[post-image-regenerate-session] session ${sessionId} not found for user ${userId} — failing closed (charging):`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      JSON.stringify({ message: (error as any)?.message, details: (error as any)?.details, hint: (error as any)?.hint, code: (error as any)?.code })
    )
    return { ok: false }
  }

  const count = session.image_generation_count ?? 0
  // Only the second call (count === 1 going in, i.e. one prior call already
  // happened) is free — the first call and every call after the second charge.
  const shouldCharge = count !== 1

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from("post_image_generation_sessions") as any)
    .update({ image_generation_count: count + 1 })
    .eq("id", sessionId)

  return { ok: true, shouldCharge }
}
