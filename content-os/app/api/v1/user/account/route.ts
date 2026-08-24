import { NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database, Json } from "@/types/database"

type AdminClient = SupabaseClient<Database>

// Two buckets are actually used across this app's upload call sites (see
// lib/storage/upload-media.ts's default and the direct admin.storage.from()
// calls in app/api/v1/ai/{images,post-image}/generate and lib/ai/fastlane.ts)
// — verified by grepping every uploadMediaToStorage/admin.storage.from()
// call site, not assumed.
const PUBLISHED_MEDIA_BUCKET = "published-media"
const BRAND_IMAGES_BUCKET = "brand-images"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function table(admin: AdminClient, name: string): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (admin as any).from(name)
}

// Mirrors app/api/v1/cron/cleanup-abandoned-drafts/route.ts's helper of the
// same name exactly.
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

interface CollectedPaths {
  publishedMedia: Set<string>
  brandImages: Set<string>
}

// generated_images (standalone Images tab + Create -> Full Post's AI image,
// bucket brand-images) already stores the raw storage_path directly — no
// URL parsing needed, unlike the other tables here.
async function collectGeneratedImagePaths(admin: AdminClient, brandIds: string[], paths: CollectedPaths): Promise<void> {
  const { data, error } = await table(admin, "generated_images")
    .select("storage_path")
    .in("brand_id", brandIds) as { data: { storage_path: string | null }[] | null; error: { message: string } | null }

  if (error) {
    console.error("[user/account] failed to collect generated_images storage paths:", error.message)
    return
  }
  for (const row of data ?? []) {
    if (row.storage_path) paths.brandImages.add(row.storage_path)
  }
}

// reel_video_jobs.scene_assets is a JSON array of per-scene { videoUrl,
// audioUrl, ... } (lib/video/reel-scene-assets.ts's SceneAsset, re-hosted
// via uploadMediaToStorage to published-media). reel_video_jobs.video_url
// itself is deliberately NOT collected here — the final rendered video is
// hosted by JSON2Video (lib/video/render-trigger.ts), not Supabase Storage,
// so there's nothing of ours to delete for it.
async function collectReelVideoJobPaths(admin: AdminClient, brandIds: string[], paths: CollectedPaths): Promise<void> {
  const { data, error } = await table(admin, "reel_video_jobs")
    .select("scene_assets")
    .in("brand_id", brandIds) as { data: { scene_assets: Json }[] | null; error: { message: string } | null }

  if (error) {
    console.error("[user/account] failed to collect reel_video_jobs storage paths:", error.message)
    return
  }
  for (const row of data ?? []) {
    if (!Array.isArray(row.scene_assets)) continue
    for (const scene of row.scene_assets) {
      if (!scene || typeof scene !== "object" || Array.isArray(scene)) continue
      const s = scene as Record<string, unknown>
      for (const key of ["videoUrl", "audioUrl"]) {
        const url = s[key]
        if (typeof url !== "string") continue
        const path = extractStoragePath(url, PUBLISHED_MEDIA_BUCKET)
        if (path) paths.publishedMedia.add(path)
      }
    }
  }
}

// calendar_entries.platform_specific_data is a JSON blob whose shape varies
// by content type (app/api/v1/calendar/schedule-post/route.ts) — the keys
// that ever hold a Supabase-Storage-hosted URL are hosted_image_url
// (single-image posts) and hosted_image_urls (carousel/story posts). Its
// video_url key, like reel_video_jobs.video_url above, is a JSON2Video URL,
// not ours — not collected.
async function collectCalendarEntryPaths(admin: AdminClient, brandIds: string[], paths: CollectedPaths): Promise<void> {
  const { data, error } = await table(admin, "calendar_entries")
    .select("platform_specific_data")
    .in("brand_id", brandIds) as { data: { platform_specific_data: Json }[] | null; error: { message: string } | null }

  if (error) {
    console.error("[user/account] failed to collect calendar_entries storage paths:", error.message)
    return
  }
  for (const row of data ?? []) {
    const d = row.platform_specific_data
    if (!d || typeof d !== "object" || Array.isArray(d)) continue
    const obj = d as Record<string, unknown>

    if (typeof obj.hosted_image_url === "string") {
      const path = extractStoragePath(obj.hosted_image_url, PUBLISHED_MEDIA_BUCKET)
      if (path) paths.publishedMedia.add(path)
    }
    if (Array.isArray(obj.hosted_image_urls)) {
      for (const url of obj.hosted_image_urls) {
        if (typeof url !== "string") continue
        const path = extractStoragePath(url, PUBLISHED_MEDIA_BUCKET)
        if (path) paths.publishedMedia.add(path)
      }
    }
  }
}

// Carousel/story slide AI-background images (app/api/v1/ai/carousel/
// slide-image/generate and app/api/v1/ai/stories/slide-image/generate) and
// Ad Maker variation uploads (app/api/v1/brands/[brandId]/ai/ad-maker/
// upload-variation) are all uploaded straight to Storage, but their URLs
// are never persisted to any DB row at upload time — the first two only
// ever live in client-side React state (CarouselBuilder.tsx/
// StorySequence.tsx), and an ad variation only gets a DB reference if it's
// later scheduled, at which point schedule-post/route.ts re-hosts it under
// a fresh ${brandId}/scheduled-... path rather than reusing this one — so
// the original ${brandId}/ads/... upload is orphaned either way, scheduled
// or not. None of these three have a column to walk, unlike every other
// table above. Listed directly by their known per-brand storage prefix
// instead, since that's the only way to actually reach them.
async function collectPrefixedPaths(admin: AdminClient, brandIds: string[], folder: string, paths: CollectedPaths): Promise<void> {
  for (const brandId of brandIds) {
    const dir = `${brandId}/${folder}`
    const { data, error } = await admin.storage.from(PUBLISHED_MEDIA_BUCKET).list(dir)
    if (error) {
      console.error(`[user/account] failed to list storage prefix ${dir}:`, error.message)
      continue
    }
    for (const file of data ?? []) {
      if (file.name) paths.publishedMedia.add(`${dir}/${file.name}`)
    }
  }
}

interface StorageCleanupResult {
  attempted: number
  failed: string[]
}

/**
 * Collects every Supabase Storage object belonging to this user's brands
 * (across generated_images, reel_video_jobs, calendar_entries, plus
 * carousel/story AI-background slides and Ad Maker variation uploads, none
 * of which have a DB column of their own — see collectPrefixedPaths) and
 * deletes them. Never throws — a failed removal is reported back in
 * `failed` for the caller to log, not raised, since a storage cleanup
 * problem must never block the account deletion itself.
 *
 * Deliberately NOT covered (confirmed while building this, not assumed):
 * brands.logo_url, brand_images.image_urls, and products.image_urls are
 * always external URLs scraped from the brand's own website/product page
 * (lib/ai/url-extractor.ts) — never uploaded to our Storage, so there's
 * nothing of ours to delete for them.
 */
async function deleteUserStorageObjects(admin: AdminClient, userId: string): Promise<StorageCleanupResult> {
  const { data: brands, error: brandsError } = await table(admin, "brands")
    .select("id")
    .eq("user_id", userId) as { data: { id: string }[] | null; error: { message: string } | null }

  if (brandsError) {
    console.error(`[user/account] failed to fetch brands for storage cleanup, user ${userId}:`, brandsError.message)
    return { attempted: 0, failed: [] }
  }

  const brandIds = (brands ?? []).map((b) => b.id)
  if (brandIds.length === 0) return { attempted: 0, failed: [] }

  const paths: CollectedPaths = { publishedMedia: new Set(), brandImages: new Set() }

  await Promise.all([
    collectGeneratedImagePaths(admin, brandIds, paths),
    collectReelVideoJobPaths(admin, brandIds, paths),
    collectCalendarEntryPaths(admin, brandIds, paths),
    collectPrefixedPaths(admin, brandIds, "carousel-slides", paths),
    collectPrefixedPaths(admin, brandIds, "story-slides", paths),
    collectPrefixedPaths(admin, brandIds, "ads", paths),
  ])

  const failed: string[] = []
  let attempted = 0

  if (paths.publishedMedia.size > 0) {
    const list = [...paths.publishedMedia]
    attempted += list.length
    const { error } = await admin.storage.from(PUBLISHED_MEDIA_BUCKET).remove(list)
    if (error) {
      console.error(`[user/account] storage cleanup: ${PUBLISHED_MEDIA_BUCKET} removal failed for user ${userId}:`, error.message)
      failed.push(...list)
    }
  }

  if (paths.brandImages.size > 0) {
    const list = [...paths.brandImages]
    attempted += list.length
    const { error } = await admin.storage.from(BRAND_IMAGES_BUCKET).remove(list)
    if (error) {
      console.error(`[user/account] storage cleanup: ${BRAND_IMAGES_BUCKET} removal failed for user ${userId}:`, error.message)
      failed.push(...list)
    }
  }

  return { attempted, failed }
}

export async function DELETE() {
  console.log("[user/account] DELETE called")
  let supabase
  try {
    supabase = await createClient()
  } catch (err) {
    console.error("[user/account] createClient failed:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error initializing request."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  }

  try {
    const admin = await createAdminClient()

    // Storage cleanup runs BEFORE admin.deleteUser() — deliberately. If it
    // ran after, a failure partway through admin.deleteUser's cascade
    // (public.users -> brands -> every content table) would have already
    // erased the very rows this walk depends on to know what to delete from
    // Storage, with no way to recover the list. Running it first means the
    // DB rows are still there to retry/audit from if storage cleanup itself
    // fails or is interrupted — see the failure handling below, which never
    // blocks the account deletion that follows.
    const storageResult = await deleteUserStorageObjects(admin, user.id)
    if (storageResult.failed.length > 0) {
      console.error(
        `[user/account] storage cleanup incomplete for user ${user.id}: ${storageResult.failed.length}/${storageResult.attempted} object(s) failed to delete (not blocking account deletion) — paths for manual sweep:`,
        storageResult.failed
      )
    } else if (storageResult.attempted > 0) {
      console.log(`[user/account] storage cleanup: removed ${storageResult.attempted} object(s) for user ${user.id}`)
    }

    // Deleting the auth.users row cascades through public.users -> brands
    // -> every content table (captions, reel_scripts, carousels, ad_copies,
    // stories, blog_posts, generated_images, reel_video_jobs,
    // calendar_entries, etc.) via the ON DELETE CASCADE foreign keys
    // already defined across supabase/migrations/*.sql. This is real,
    // irreversible deletion — not a soft-delete flag — so there is no
    // recovery path once admin.deleteUser succeeds.
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)

    if (deleteError) {
      console.error("[user/account] DELETE admin.deleteUser error:", deleteError)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to delete account."), { status: 500 })
    }

    // Best-effort cookie cleanup — the account is already gone server-side
    // at this point regardless of whether this succeeds.
    await supabase.auth.signOut().catch(() => {})

    return NextResponse.json({ data: { deleted: true } })
  } catch (err) {
    console.error("[user/account] DELETE unexpected error:", err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to delete account."), { status: 500 })
  }
}
