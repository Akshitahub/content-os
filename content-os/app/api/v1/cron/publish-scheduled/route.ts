import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { publishToInstagram } from "@/lib/social/instagram-publish"
import { publishToFacebook } from "@/lib/social/facebook-publish"
import { publishCarouselToInstagram } from "@/lib/social/instagram-carousel-publish"
import { publishStorySequenceToInstagram } from "@/lib/social/instagram-story-publish"
import { publishToThreads } from "@/lib/social/threads-publish"
import { publishToPinterest } from "@/lib/social/pinterest-publish"
import { publishViaZernio } from "@/lib/social/zernio-client"
import { uploadMediaToStorage } from "@/lib/storage/upload-media"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database, CalendarEntryRow, SocialConnectionRow } from "@/types/database"

const MAX_PUBLISH_ATTEMPTS = 3
const DELAY_BETWEEN_POSTS_MS = 2000

// publishToThreads has a hardcoded 30s wait (Threads' recommended delay
// before publishing an image container). This route has no explicit
// maxDuration set today (falling back to the platform default), which
// isn't enough headroom for that wait plus normal processing. Note: the
// GitHub Actions workflow that triggers this cron (.github/workflows —
// not touched here) calls it with `curl --max-time 60`, so even with this
// bump the client-side caller can still abort at 60s; see the interim
// one-Threads-post-per-run cap below, which keeps runtime well under that.
export const maxDuration = 60

// Interim safety limit until Threads publishing is verified under real
// load — the 30s wait per Threads post could compound if several are due
// in the same run, risking the run exceeding the GitHub Actions caller's
// 60s timeout. Additional due Threads posts are simply left untouched
// (still "scheduled") and picked up on the next run, ~15 minutes later.
const MAX_THREADS_PER_RUN = 1

type AdminClient = SupabaseClient<Database>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function calendarEntriesTable(supabase: AdminClient): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).from("calendar_entries")
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function contentProjectsTable(supabase: AdminClient): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).from("content_projects")
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const authHeader = request.headers.get("authorization")
  if (authHeader === `Bearer ${secret}`) return true

  const { searchParams } = new URL(request.url)
  return searchParams.get("secret") === secret
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function recordFailure(admin: AdminClient, entry: CalendarEntryRow, reason: string): Promise<"failed"> {
  const attempts = entry.publish_attempts + 1
  const nextStatus = attempts >= MAX_PUBLISH_ATTEMPTS ? "missed" : "scheduled"

  const { error } = await calendarEntriesTable(admin)
    .update({ publish_attempts: attempts, status: nextStatus, updated_at: new Date().toISOString() })
    .eq("id", entry.id)

  if (error) {
    console.error(`[cron/publish-scheduled] entry ${entry.id}: failed to record failure state:`, error.message)
  }

  console.error(
    `[cron/publish-scheduled] entry ${entry.id}: attempt ${attempts}/${MAX_PUBLISH_ATTEMPTS} failed (${reason}) — now ${nextStatus}`
  )
  return "failed"
}

async function processEntry(admin: AdminClient, entry: CalendarEntryRow): Promise<"published" | "failed" | "skipped"> {
  // A Facebook Page and its linked Instagram Business Account share one
  // connection row (platform="instagram", same Page access token), so a
  // Facebook-targeted entry still looks up the "instagram" row. Threads and
  // Pinterest each have entirely separate OAuth credentials and their own
  // row (platform="threads"/"pinterest").
  const { data: connection } = await admin
    .from("social_connections")
    .select("*")
    .eq("brand_id", entry.brand_id)
    .eq("platform", entry.platform === "threads" ? "threads" : entry.platform === "pinterest" ? "pinterest" : entry.platform === "linkedin" ? "linkedin" : entry.platform === "youtube" ? "youtube" : entry.platform === "twitter" ? "twitter" : "instagram")
    .eq("is_active", true)
    .maybeSingle<SocialConnectionRow>()

  if (!connection) {
    console.log(
      `[cron/publish-scheduled] entry ${entry.id}: no active social connection for brand ${entry.brand_id} — leaving scheduled, will retry next run`
    )
    return "skipped"
  }

  if (entry.platform === "instagram" && !connection.ig_business_account_id) {
    console.error(`[cron/publish-scheduled] entry ${entry.id}: brand ${entry.brand_id}'s connection has no linked Instagram Business Account`)
    return await recordFailure(admin, entry, "Instagram not connected for this brand.")
  }

  if (entry.platform === "threads" && !connection.threads_user_id) {
    console.error(`[cron/publish-scheduled] entry ${entry.id}: brand ${entry.brand_id}'s Threads connection is missing a threads_user_id`)
    return await recordFailure(admin, entry, "Threads not connected for this brand.")
  }

  if (entry.platform === "pinterest" && !connection.pinterest_board_id) {
    console.error(`[cron/publish-scheduled] entry ${entry.id}: brand ${entry.brand_id}'s Pinterest connection is missing a pinterest_board_id`)
    return await recordFailure(admin, entry, "Pinterest not connected for this brand.")
  }

  if (entry.platform === "linkedin" && !connection.zernio_account_id) {
    console.error(`[cron/publish-scheduled] entry ${entry.id}: brand ${entry.brand_id}'s LinkedIn connection is missing a zernio_account_id`)
    return await recordFailure(admin, entry, "LinkedIn not connected for this brand.")
  }

  if (entry.platform === "youtube" && !connection.zernio_account_id) {
    console.error(`[cron/publish-scheduled] entry ${entry.id}: brand ${entry.brand_id}'s YouTube connection is missing a zernio_account_id`)
    return await recordFailure(admin, entry, "YouTube not connected for this brand.")
  }

  if (entry.platform === "twitter" && !connection.zernio_account_id) {
    console.error(`[cron/publish-scheduled] entry ${entry.id}: brand ${entry.brand_id}'s Twitter/X connection is missing a zernio_account_id`)
    return await recordFailure(admin, entry, "Twitter/X not connected for this brand.")
  }

  // LinkedIn/YouTube/Twitter connections have no access_token/token_expires_at
  // of our own — Zernio holds and refreshes that token on its side, so
  // there's nothing to check locally (token_expires_at is NULL by design for
  // these platforms; skipping this check avoids treating that NULL as an
  // already-expired epoch timestamp).
  if (entry.platform !== "linkedin" && entry.platform !== "youtube" && entry.platform !== "twitter" && new Date(connection.token_expires_at).getTime() <= Date.now()) {
    console.error(`[cron/publish-scheduled] entry ${entry.id}: access token expired for brand ${entry.brand_id}`)
    return await recordFailure(admin, entry, "Access token has expired. Reconnect the account.")
  }

  const platformData = (entry.platform_specific_data ?? {}) as Record<string, unknown>
  const isCarousel = platformData.content_format === "carousel"
  const isStory = platformData.content_format === "story"
  const isVideo = platformData.content_format === "video"
  const isMultiImage = isCarousel || isStory

  if (isMultiImage && entry.platform !== "instagram") {
    console.error(`[cron/publish-scheduled] entry ${entry.id}: ${isStory ? "story sequence" : "carousel"} scheduled for ${entry.platform}, which isn't supported`)
    return await recordFailure(admin, entry, `${isStory ? "Story sequence" : "Carousel"} scheduling is Instagram-only.`)
  }

  if (isVideo && entry.platform !== "youtube") {
    console.error(`[cron/publish-scheduled] entry ${entry.id}: video content scheduled for ${entry.platform}, which isn't supported`)
    return await recordFailure(admin, entry, "Video scheduling is YouTube-only.")
  }

  let imageUrl: string | null = null
  let imageUrls: string[] | null = null
  let videoUrl: string | null = null

  if (isVideo) {
    videoUrl = typeof platformData.video_url === "string" ? platformData.video_url : null
    if (!videoUrl) {
      console.error(`[cron/publish-scheduled] entry ${entry.id}: no publishable video (content_type=${entry.content_type})`)
      return await recordFailure(admin, entry, "No publishable video available for this content type.")
    }
  } else if (isMultiImage) {
    const cachedUrls = Array.isArray(platformData.hosted_image_urls)
      ? platformData.hosted_image_urls.filter((u): u is string => typeof u === "string")
      : null

    if (cachedUrls && cachedUrls.length > 0) {
      imageUrls = cachedUrls
    } else {
      const sourceUrls = Array.isArray(platformData.image_urls)
        ? platformData.image_urls.filter((u): u is string => typeof u === "string")
        : []
      if (sourceUrls.length === 0) {
        console.error(`[cron/publish-scheduled] entry ${entry.id}: no publishable images (content_type=${entry.content_type})`)
        return await recordFailure(admin, entry, "No publishable images available for this content type.")
      }

      const noun = isStory ? "story slide" : "carousel image"
      const hostedUrls: string[] = []
      for (let i = 0; i < sourceUrls.length; i++) {
        const uploadResult = await uploadMediaToStorage(
          { kind: "remoteUrl", url: sourceUrls[i]! },
          `${entry.brand_id}/${entry.id}-${i}`
        )
        if ("error" in uploadResult) {
          console.error(`[cron/publish-scheduled] entry ${entry.id}: failed to host ${noun} ${i + 1}/${sourceUrls.length}:`, uploadResult.error)
          return await recordFailure(admin, entry, `Failed to prepare ${noun} ${i + 1} of ${sourceUrls.length} for publishing: ${uploadResult.error}`)
        }
        hostedUrls.push(uploadResult.publicUrl)
      }

      imageUrls = hostedUrls

      // Persist the re-hosted URLs so a retry doesn't re-fetch/re-upload them.
      const { error: persistError } = await calendarEntriesTable(admin)
        .update({ platform_specific_data: { ...platformData, hosted_image_urls: imageUrls } })
        .eq("id", entry.id)
      if (persistError) {
        console.error(`[cron/publish-scheduled] entry ${entry.id}: failed to persist hosted image urls:`, persistError.message)
      }
    }
  } else {
    imageUrl = typeof platformData.hosted_image_url === "string"
      ? platformData.hosted_image_url
      : null

    if (!imageUrl) {
      const sourceUrl = typeof platformData.image_url === "string" ? platformData.image_url : null
      if (!sourceUrl) {
        console.error(`[cron/publish-scheduled] entry ${entry.id}: no publishable image (content_type=${entry.content_type})`)
        return await recordFailure(admin, entry, "No publishable image available for this content type.")
      }

      const uploadResult = await uploadMediaToStorage(
        { kind: "remoteUrl", url: sourceUrl },
        `${entry.brand_id}/${entry.id}`
      )
      if ("error" in uploadResult) {
        console.error(`[cron/publish-scheduled] entry ${entry.id}: failed to host image:`, uploadResult.error)
        return await recordFailure(admin, entry, `Failed to prepare image for publishing: ${uploadResult.error}`)
      }

      imageUrl = uploadResult.publicUrl

      // Persist the re-hosted URL so a retry doesn't re-fetch/re-upload it.
      const { error: persistError } = await calendarEntriesTable(admin)
        .update({ platform_specific_data: { ...platformData, hosted_image_url: imageUrl } })
        .eq("id", entry.id)
      if (persistError) {
        console.error(`[cron/publish-scheduled] entry ${entry.id}: failed to persist hosted image url:`, persistError.message)
      }
    }
  }

  const caption = [entry.caption_text, (entry.hashtags ?? []).map(h => `#${h.replace(/^#+/, "")}`).join(" ")]
    .filter(Boolean)
    .join("\n\n")

  if (!caption.trim()) {
    console.error(`[cron/publish-scheduled] entry ${entry.id}: no caption text available`)
    return await recordFailure(admin, entry, "No caption text available.")
  }

  if (isStory) {
    // Stories have no parent/carousel container — each slide publishes as
    // its own independent story item, sequentially. The result shape
    // (publishedCount/failedAtSlide/instagramMediaIds) doesn't match the
    // single-media-id shape the carousel/single-post result below produces,
    // so it's handled in its own branch rather than forced into that union.
    const storyResult = await publishStorySequenceToInstagram(connection.ig_business_account_id!, connection.access_token, imageUrls!)

    if (!storyResult.success) {
      console.error(
        `[cron/publish-scheduled] entry ${entry.id}: story sequence publish failed at slide ${storyResult.failedAtSlide}/${imageUrls!.length} ` +
        `(${storyResult.publishedCount} published, retryable=${storyResult.retryable}) — ${storyResult.error}`
      )
      return await recordFailure(
        admin,
        entry,
        `Story ${storyResult.failedAtSlide} of ${imageUrls!.length} failed to publish (${storyResult.publishedCount} published successfully): ${storyResult.error}`
      )
    }

    console.log(`[cron/publish-scheduled] entry ${entry.id}: published — instagram story sequence, ${storyResult.instagramMediaIds.length} slides`)

    const publishedAt = new Date().toISOString()
    const { error: updateError } = await calendarEntriesTable(admin)
      .update({
        status: "published",
        platform_specific_data: {
          ...platformData,
          hosted_image_urls: imageUrls,
          instagram_story_media_ids: storyResult.instagramMediaIds,
        },
        updated_at: publishedAt,
      })
      .eq("id", entry.id)

    if (updateError) {
      console.error(`[cron/publish-scheduled] entry ${entry.id}: published on instagram but failed to update calendar entry:`, updateError.message)
    }

    if (entry.content_project_id) {
      const { error: projectError } = await contentProjectsTable(admin)
        .update({ status: "published", published_at: publishedAt, updated_at: publishedAt })
        .eq("id", entry.content_project_id)
      if (projectError) {
        console.error(`[cron/publish-scheduled] entry ${entry.id}: failed to update linked content_project:`, projectError.message)
      }
    }

    return "published"
  }

  // Pinterest requires a separate short title (there's no dedicated title
  // field elsewhere in the scheduling flow) — derived from the caption's
  // first line, capped at ~90 characters, whichever is shorter.
  const pinterestTitleLine = caption.split("\n")[0] ?? caption
  const pinterestTitle = pinterestTitleLine.length > 90 ? pinterestTitleLine.slice(0, 90) : pinterestTitleLine

  const publishResult = isCarousel
    // ig_business_account_id is guaranteed non-null here — checked above.
    ? await publishCarouselToInstagram(connection.ig_business_account_id!, connection.access_token, { imageUrls: imageUrls!, caption })
    : entry.platform === "instagram"
      ? await publishToInstagram(connection.ig_business_account_id!, connection.access_token, { imageUrl: imageUrl!, caption })
      : entry.platform === "threads"
        // threads_user_id is guaranteed non-null here — checked above.
        ? await publishToThreads(connection.threads_user_id!, connection.access_token, { imageUrl: imageUrl!, text: caption })
        : entry.platform === "pinterest"
          // pinterest_board_id is guaranteed non-null here — checked above.
          ? await publishToPinterest(connection.pinterest_board_id!, connection.access_token, { imageUrl: imageUrl!, title: pinterestTitle, description: caption })
          : entry.platform === "linkedin"
            // zernio_account_id is guaranteed non-null here — checked above.
            ? await publishViaZernio("linkedin", connection.zernio_account_id!, { text: caption, mediaUrls: [imageUrl!] })
            : entry.platform === "youtube"
              // zernio_account_id is guaranteed non-null here — checked above.
              ? await publishViaZernio("youtube", connection.zernio_account_id!, { text: caption, mediaUrls: [videoUrl!] })
              : entry.platform === "twitter"
                // zernio_account_id is guaranteed non-null here — checked above.
                ? await publishViaZernio("twitter", connection.zernio_account_id!, { text: caption, mediaUrls: [imageUrl!] })
                : await publishToFacebook(connection.facebook_page_id, connection.access_token, { imageUrl: imageUrl!, message: caption })

  if (!publishResult.success) {
    console.error(`[cron/publish-scheduled] entry ${entry.id}: publish failed (retryable=${publishResult.retryable}) — ${publishResult.error}`)
    return await recordFailure(admin, entry, publishResult.error)
  }

  // publishViaZernio (LinkedIn/YouTube) returns { success, postId } — a
  // different shape from the platform-specific publish functions above
  // (instagramMediaId/threadsPostId/pinId/facebookPostId), so it needs its
  // own branch here rather than falling through to facebookPostId.
  const externalId = "instagramMediaId" in publishResult
    ? publishResult.instagramMediaId
    : "threadsPostId" in publishResult
      ? publishResult.threadsPostId
      : "pinId" in publishResult
        ? publishResult.pinId
        : "postId" in publishResult
          ? publishResult.postId
          : publishResult.facebookPostId
  console.log(`[cron/publish-scheduled] entry ${entry.id}: published — ${entry.platform} id ${externalId}`)

  const publishedAt = new Date().toISOString()
  const mediaIdKey = entry.platform === "instagram"
    ? "instagram_media_id"
    : entry.platform === "threads"
      ? "threads_post_id"
      : entry.platform === "pinterest"
        ? "pinterest_pin_id"
        : entry.platform === "linkedin"
          ? "linkedin_post_id"
          : entry.platform === "youtube"
            ? "youtube_video_id"
            : entry.platform === "twitter"
              ? "twitter_post_id"
              : "facebook_post_id"

  const { error: updateError } = await calendarEntriesTable(admin)
    .update({
      status: "published",
      platform_specific_data: {
        ...platformData,
        ...(isCarousel ? { hosted_image_urls: imageUrls } : isVideo ? { video_url: videoUrl } : { hosted_image_url: imageUrl }),
        [mediaIdKey]: externalId,
      },
      updated_at: publishedAt,
    })
    .eq("id", entry.id)

  if (updateError) {
    console.error(`[cron/publish-scheduled] entry ${entry.id}: published on ${entry.platform} but failed to update calendar entry:`, updateError.message)
  }

  if (entry.content_project_id) {
    const { error: projectError } = await contentProjectsTable(admin)
      .update({ status: "published", published_at: publishedAt, updated_at: publishedAt })
      .eq("id", entry.content_project_id)
    if (projectError) {
      console.error(`[cron/publish-scheduled] entry ${entry.id}: failed to update linked content_project:`, projectError.message)
    }
  }

  return "published"
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    console.error("[cron/publish-scheduled] unauthorized request")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  console.log("[cron/publish-scheduled] GET called")

  const admin = await createAdminClient()
  const now = new Date()
  const todayStr = now.toISOString().split("T")[0]

  const { data: candidates, error: fetchError } = await admin
    .from("calendar_entries")
    .select("*")
    .eq("status", "scheduled")
    .in("platform", ["instagram", "facebook", "threads", "pinterest", "linkedin", "youtube", "twitter"])
    .lte("scheduled_date", todayStr)
    .order("scheduled_date", { ascending: true })
    .returns<CalendarEntryRow[]>()

  if (fetchError) {
    console.error("[cron/publish-scheduled] failed to fetch candidates:", fetchError.message)
    return NextResponse.json({ error: "Failed to fetch scheduled entries." }, { status: 500 })
  }

  const dueEntries = (candidates ?? []).filter(entry => {
    const dueAt = new Date(`${entry.scheduled_date}T${entry.scheduled_time ?? "00:00:00"}`)
    return dueAt.getTime() <= now.getTime()
  })

  console.log(`[cron/publish-scheduled] ${dueEntries.length} entr${dueEntries.length === 1 ? "y" : "ies"} due`)

  const summary = { processed: 0, published: 0, failed: 0, skipped: 0 }
  let threadsProcessedThisRun = 0

  for (const entry of dueEntries) {
    if (entry.platform === "threads" && threadsProcessedThisRun >= MAX_THREADS_PER_RUN) {
      console.log(
        `[cron/publish-scheduled] entry ${entry.id}: deferring — already processed ${MAX_THREADS_PER_RUN} Threads post(s) this run, leaving scheduled for the next run`
      )
      summary.skipped++
      continue
    }
    if (entry.platform === "threads") threadsProcessedThisRun++

    summary.processed++
    try {
      const result = await processEntry(admin, entry)
      if (result === "published") summary.published++
      else if (result === "skipped") summary.skipped++
      else summary.failed++
    } catch (err) {
      console.error(`[cron/publish-scheduled] entry ${entry.id} unexpected error:`, err instanceof Error ? err.message : err)
      summary.failed++
    }
    await sleep(DELAY_BETWEEN_POSTS_MS)
  }

  console.log("[cron/publish-scheduled] done:", summary)
  return NextResponse.json({ data: summary })
}
