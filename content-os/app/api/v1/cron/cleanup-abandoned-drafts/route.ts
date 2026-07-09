import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

// Once-daily is fine here — unlike publish-scheduled, nothing about this
// job is time-sensitive within the day.
export const maxDuration = 60

const ABANDONED_AFTER_DAYS = 45
const STORAGE_BUCKET = "published-media"

// Tables reachable from the "My Content" library page that get
// last_accessed_at tracking (migration 018, plus blog_posts added directly
// with the column in migration 021). hooks, generated_images, and
// product_descriptions are deliberately excluded — see that migration's
// comment: there's no UI to view/open them today, so they'd always look
// abandoned regardless of whether anyone cares about them.
const TEXT_ONLY_TABLES = ["captions", "reel_scripts", "carousels", "stories", "ad_copies", "blog_posts"] as const

type AdminClient = SupabaseClient<Database>

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const authHeader = request.headers.get("authorization")
  if (authHeader === `Bearer ${secret}`) return true

  const { searchParams } = new URL(request.url)
  return searchParams.get("secret") === secret
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function table(admin: AdminClient, name: string): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (admin as any).from(name)
}

function extractStoragePath(publicUrl: string, bucket: string): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`
  const idx = publicUrl.indexOf(marker)
  if (idx === -1) return null
  try {
    return decodeURIComponent(publicUrl.slice(idx + marker.length))
  } catch {
    return publicUrl.slice(idx + marker.length)
  }
}

/**
 * Captions are the only one of these tables that can be referenced by id
 * elsewhere (calendar_entries.caption_id, set by Autopilot/Fastlane) — the
 * other 5 always get their content copied inline wherever it's used, so
 * nothing else holds a live reference. Even though the caption's own text
 * survives inside the calendar entry either way, deleting a row still
 * linked to a scheduled/published post is exactly the kind of false
 * positive this feature exists to avoid, so it's excluded outright.
 */
async function excludeLinkedCaptions(admin: AdminClient, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return ids
  const { data: linked, error } = await table(admin, "calendar_entries")
    .select("caption_id")
    .in("caption_id", ids) as { data: { caption_id: string | null }[] | null; error: { message: string } | null }

  if (error) {
    console.error("[cron/cleanup-abandoned-drafts] failed to check linked captions, skipping this batch to be safe:", error.message)
    return []
  }

  const linkedIds = new Set((linked ?? []).map((l) => l.caption_id).filter((id): id is string => !!id))
  return ids.filter((id) => !linkedIds.has(id))
}

async function cleanupTextOnlyTable(admin: AdminClient, tableName: string, cutoff: string): Promise<number> {
  const { data: candidates, error: fetchError } = await table(admin, tableName)
    .select("id")
    .lt("last_accessed_at", cutoff) as { data: { id: string }[] | null; error: { message: string } | null }

  if (fetchError) {
    console.error(`[cron/cleanup-abandoned-drafts] ${tableName} fetch error:`, fetchError.message)
    return 0
  }

  let ids = (candidates ?? []).map((c) => c.id)
  if (ids.length === 0) return 0

  if (tableName === "captions") {
    ids = await excludeLinkedCaptions(admin, ids)
    if (ids.length === 0) return 0
  }

  const { error: deleteError } = await table(admin, tableName).delete().in("id", ids)
  if (deleteError) {
    console.error(`[cron/cleanup-abandoned-drafts] ${tableName} delete error:`, deleteError.message)
    return 0
  }

  return ids.length
}

async function cleanupMemes(admin: AdminClient, cutoff: string): Promise<{ deleted: number; storageFilesRemoved: number }> {
  const { data: candidates, error: fetchError } = await table(admin, "memes")
    .select("id, image_url")
    .lt("last_accessed_at", cutoff) as { data: { id: string; image_url: string | null }[] | null; error: { message: string } | null }

  if (fetchError) {
    console.error("[cron/cleanup-abandoned-drafts] memes fetch error:", fetchError.message)
    return { deleted: 0, storageFilesRemoved: 0 }
  }

  const rows = candidates ?? []
  if (rows.length === 0) return { deleted: 0, storageFilesRemoved: 0 }

  // Delete the actual stored image before the row — otherwise storage cost
  // isn't actually reduced, just the database row.
  const paths = rows
    .map((r) => (r.image_url ? extractStoragePath(r.image_url, STORAGE_BUCKET) : null))
    .filter((p): p is string => !!p)

  let storageFilesRemoved = 0
  if (paths.length > 0) {
    const { error: removeError, data: removed } = await admin.storage.from(STORAGE_BUCKET).remove(paths)
    if (removeError) {
      console.error("[cron/cleanup-abandoned-drafts] meme storage removal error:", removeError.message)
    } else {
      storageFilesRemoved = removed?.length ?? paths.length
    }
  }

  const { error: deleteError } = await table(admin, "memes").delete().in("id", rows.map((r) => r.id))
  if (deleteError) {
    console.error("[cron/cleanup-abandoned-drafts] memes delete error:", deleteError.message)
    return { deleted: 0, storageFilesRemoved }
  }

  return { deleted: rows.length, storageFilesRemoved }
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    console.error("[cron/cleanup-abandoned-drafts] unauthorized request")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  console.log("[cron/cleanup-abandoned-drafts] GET called")

  const admin = await createAdminClient()
  const cutoff = new Date(Date.now() - ABANDONED_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const perTable: Record<string, number> = {}
  let deleted = 0
  let storageFilesRemoved = 0

  for (const tableName of TEXT_ONLY_TABLES) {
    try {
      const count = await cleanupTextOnlyTable(admin, tableName, cutoff)
      perTable[tableName] = count
      deleted += count
    } catch (err) {
      console.error(`[cron/cleanup-abandoned-drafts] ${tableName} unexpected error:`, err instanceof Error ? err.message : err)
    }
  }

  try {
    const memeResult = await cleanupMemes(admin, cutoff)
    perTable.memes = memeResult.deleted
    deleted += memeResult.deleted
    storageFilesRemoved += memeResult.storageFilesRemoved
  } catch (err) {
    console.error("[cron/cleanup-abandoned-drafts] memes unexpected error:", err instanceof Error ? err.message : err)
  }

  console.log("[cron/cleanup-abandoned-drafts] done:", { deleted, storageFilesRemoved, perTable })
  return NextResponse.json({ data: { deleted, storageFilesRemoved, perTable } })
}
