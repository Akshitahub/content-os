import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { publishViaZernio } from "@/lib/social/zernio-client"
import { uploadMediaToStorage } from "@/lib/storage/upload-media"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database, CalendarEntryRow, SocialConnectionRow } from "@/types/database"

const MAX_PUBLISH_ATTEMPTS = 3
const DELAY_BETWEEN_POSTS_MS = 2000

// Every schedulable platform now publishes through Zernio's single POST
// /posts call — no more per-platform Graph API dances with their own wait
// quirks (e.g. Threads' old hardcoded 30s container wait), so there's no
// longer a reason to cap how many of one platform run per invocation.
export const maxDuration = 60

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
    .update({ publish_attempts: attempts, status: nextStatus, error_message: reason, updated_at: new Date().toISOString() })
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
  // Facebook has no Zernio connection of its own — it used to piggyback on
  // Instagram's direct-OAuth Facebook Page token, but Instagram now connects
  // via Zernio's simplified Instagram-only OAuth (chosen specifically to
  // avoid Meta's Page/App Review requirements), which doesn't grant Facebook
  // Page access. There's nothing to publish through until Facebook gets its
  // own Zernio connect flow.
  if (entry.platform === "facebook") {
    console.error(`[cron/publish-scheduled] entry ${entry.id}: Facebook publishing is unavailable (no Zernio connection for Facebook)`)
    return await recordFailure(admin, entry, "Facebook isn't connected. Reconnect via Settings once Facebook publishing is available again.")
  }

  const { data: connection } = await admin
    .from("social_connections")
    .select("*")
    .eq("brand_id", entry.brand_id)
    .eq("platform", entry.platform ?? "")
    .eq("is_active", true)
    .maybeSingle<SocialConnectionRow>()

  if (!connection) {
    console.log(
      `[cron/publish-scheduled] entry ${entry.id}: no active social connection for brand ${entry.brand_id} — leaving scheduled, will retry next run`
    )
    return "skipped"
  }

  // Every remaining platform (instagram/threads/pinterest/linkedin/youtube/
  // twitter) is connected via Zernio, which holds and refreshes the
  // underlying platform token on its side — so the only thing to check
  // locally is that a Zernio account was actually linked.
  if (!connection.zernio_account_id) {
    console.error(`[cron/publish-scheduled] entry ${entry.id}: brand ${entry.brand_id}'s ${entry.platform} connection is missing a zernio_account_id`)
    return await recordFailure(admin, entry, `${entry.platform} not connected for this brand.`)
  }

  if (entry.platform === "pinterest" && !connection.pinterest_board_id) {
    console.error(`[cron/publish-scheduled] entry ${entry.id}: brand ${entry.brand_id}'s Pinterest connection is missing a pinterest_board_id`)
    return await recordFailure(admin, entry, "Pinterest not connected for this brand.")
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

  if (isVideo && entry.platform !== "youtube" && entry.platform !== "instagram") {
    console.error(`[cron/publish-scheduled] entry ${entry.id}: video content scheduled for ${entry.platform}, which isn't supported`)
    return await recordFailure(admin, entry, "Video scheduling is only supported on YouTube and Instagram.")
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
    // Stories have no parent/carousel container in Zernio either — each
    // slide is its own independent story post (platformSpecificData:
    // { contentType: "story" }, per docs.zernio.com/platforms/instagram),
    // published sequentially just like the old direct Graph API loop was.
    let publishedCount = 0
    const mediaIds: string[] = []
    let failure: { failedAtSlide: number; error: string; retryable: boolean } | null = null

    for (let i = 0; i < imageUrls!.length; i++) {
      const slideResult = await publishViaZernio("instagram", connection.zernio_account_id!, {
        text: caption,
        mediaItems: [{ type: "image", url: imageUrls![i]! }],
        platformSpecificData: { contentType: "story" },
      })

      if (!slideResult.success) {
        failure = { failedAtSlide: i + 1, error: slideResult.error, retryable: slideResult.retryable }
        break
      }

      mediaIds.push(slideResult.postId)
      publishedCount++
      if (i < imageUrls!.length - 1) await sleep(DELAY_BETWEEN_POSTS_MS)
    }

    if (failure) {
      console.error(
        `[cron/publish-scheduled] entry ${entry.id}: story sequence publish failed at slide ${failure.failedAtSlide}/${imageUrls!.length} ` +
        `(${publishedCount} published, retryable=${failure.retryable}) — ${failure.error}`
      )
      return await recordFailure(
        admin,
        entry,
        `Story ${failure.failedAtSlide} of ${imageUrls!.length} failed to publish (${publishedCount} published successfully): ${failure.error}`
      )
    }

    console.log(`[cron/publish-scheduled] entry ${entry.id}: published — instagram story sequence, ${mediaIds.length} slides`)

    const publishedAt = new Date().toISOString()
    const { error: updateError } = await calendarEntriesTable(admin)
      .update({
        status: "published",
        platform_specific_data: {
          ...platformData,
          hosted_image_urls: imageUrls,
          instagram_story_media_ids: mediaIds,
        },
        error_message: null,
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
    // zernio_account_id is guaranteed non-null here — checked above.
    ? await publishViaZernio("instagram", connection.zernio_account_id!, {
        text: caption,
        mediaItems: imageUrls!.map(url => ({ type: "image" as const, url })),
      })
    : entry.platform === "instagram" && isVideo
      ? await publishViaZernio("instagram", connection.zernio_account_id!, {
          text: caption,
          mediaItems: [{ type: "video", url: videoUrl! }],
        })
      : entry.platform === "instagram"
        ? await publishViaZernio("instagram", connection.zernio_account_id!, {
            text: caption,
            mediaItems: [{ type: "image", url: imageUrl! }],
          })
        : entry.platform === "threads"
          ? await publishViaZernio("threads", connection.zernio_account_id!, { text: caption, mediaUrls: [imageUrl!] })
          : entry.platform === "pinterest"
            // pinterest_board_id is guaranteed non-null here — checked above.
            ? await publishViaZernio("pinterest", connection.zernio_account_id!, {
                text: caption,
                mediaUrls: [imageUrl!],
                platformSpecificData: { title: pinterestTitle, boardId: connection.pinterest_board_id! },
              })
            : entry.platform === "linkedin"
              ? await publishViaZernio("linkedin", connection.zernio_account_id!, { text: caption, mediaUrls: [imageUrl!] })
              : entry.platform === "youtube"
                ? await publishViaZernio("youtube", connection.zernio_account_id!, { text: caption, mediaUrls: [videoUrl!] })
                : await publishViaZernio("twitter", connection.zernio_account_id!, { text: caption, mediaUrls: [imageUrl!] })

  if (!publishResult.success) {
    console.error(`[cron/publish-scheduled] entry ${entry.id}: publish failed (retryable=${publishResult.retryable}) — ${publishResult.error}`)
    return await recordFailure(admin, entry, publishResult.error)
  }

  console.log(`[cron/publish-scheduled] entry ${entry.id}: published — ${entry.platform} id ${publishResult.postId}`)

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
            : "twitter_post_id"

  const { error: updateError } = await calendarEntriesTable(admin)
    .update({
      status: "published",
      platform_specific_data: {
        ...platformData,
        ...(isCarousel ? { hosted_image_urls: imageUrls } : isVideo ? { video_url: videoUrl } : { hosted_image_url: imageUrl }),
        [mediaIdKey]: publishResult.postId,
      },
      error_message: null,
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

  // scheduled_date/scheduled_time are written straight from <input type="date">
  // /<input type="time"> in the scheduling UI — plain IST wall-clock values,
  // no timezone attached (this app is IST-only; see the same "Asia/Kolkata"
  // assumption in zernio-client.ts's publishViaZernio). Vercel's serverless
  // functions run in UTC, so bucketing "today" by UTC's own current date can
  // undercount: IST's calendar date is up to 5.5h ahead of UTC's (e.g. 01:00
  // IST on the 28th is still 19:30 UTC on the 27th), so an entry dated
  // "tomorrow" in UTC terms can already be due in IST. Widen the coarse
  // pre-filter to include UTC-tomorrow too — the precise per-entry due-time
  // check below (which does account for the IST offset) is what actually
  // decides what's due, this just has to not exclude real candidates first.
  const tomorrowStr = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().split("T")[0]

  const { data: candidates, error: fetchError } = await admin
    .from("calendar_entries")
    .select("*")
    .eq("status", "scheduled")
    .in("platform", ["instagram", "facebook", "threads", "pinterest", "linkedin", "youtube", "twitter"])
    .lte("scheduled_date", tomorrowStr)
    .order("scheduled_date", { ascending: true })
    .returns<CalendarEntryRow[]>()

  if (fetchError) {
    console.error("[cron/publish-scheduled] failed to fetch candidates:", fetchError.message)
    return NextResponse.json({ error: "Failed to fetch scheduled entries." }, { status: 500 })
  }

  const dueEntries = (candidates ?? []).filter(entry => {
    // +05:30 makes the stored IST wall-clock value parse as the correct UTC
    // instant, regardless of the runtime's own timezone — without it, Node
    // reads a timezone-less string as UTC, so a post meant for 17:20 IST
    // wouldn't be considered due until 17:20 UTC (22:50 IST), 5.5h late.
    const dueAt = new Date(`${entry.scheduled_date}T${entry.scheduled_time ?? "00:00:00"}+05:30`)
    return dueAt.getTime() <= now.getTime()
  })

  console.log(`[cron/publish-scheduled] ${dueEntries.length} entr${dueEntries.length === 1 ? "y" : "ies"} due`)

  const summary = { processed: 0, published: 0, failed: 0, skipped: 0 }

  for (const entry of dueEntries) {
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
