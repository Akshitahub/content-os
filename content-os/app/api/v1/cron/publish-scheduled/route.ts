import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { publishToInstagram } from "@/lib/social/instagram-publish"
import { publishToFacebook } from "@/lib/social/facebook-publish"
import { publishCarouselToInstagram } from "@/lib/social/instagram-carousel-publish"
import { publishStorySequenceToInstagram } from "@/lib/social/instagram-story-publish"
import { uploadMediaToStorage } from "@/lib/storage/upload-media"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database, CalendarEntryRow, SocialConnectionRow } from "@/types/database"

const MAX_PUBLISH_ATTEMPTS = 3
const DELAY_BETWEEN_POSTS_MS = 2000

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
  // Scoped by brand_id only — a Facebook Page and its linked Instagram
  // Business Account share one connection row (same Page access token), so
  // there is no per-platform connection to filter by.
  const { data: connection } = await admin
    .from("social_connections")
    .select("*")
    .eq("brand_id", entry.brand_id)
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

  if (new Date(connection.token_expires_at).getTime() <= Date.now()) {
    console.error(`[cron/publish-scheduled] entry ${entry.id}: access token expired for brand ${entry.brand_id}`)
    return await recordFailure(admin, entry, "Access token has expired. Reconnect the account.")
  }

  const platformData = (entry.platform_specific_data ?? {}) as Record<string, unknown>
  const isCarousel = platformData.content_format === "carousel"
  const isStory = platformData.content_format === "story"
  const isMultiImage = isCarousel || isStory

  if (isMultiImage && entry.platform !== "instagram") {
    console.error(`[cron/publish-scheduled] entry ${entry.id}: ${isStory ? "story sequence" : "carousel"} scheduled for ${entry.platform}, which isn't supported`)
    return await recordFailure(admin, entry, `${isStory ? "Story sequence" : "Carousel"} scheduling is Instagram-only.`)
  }

  let imageUrl: string | null = null
  let imageUrls: string[] | null = null

  if (isMultiImage) {
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

  const publishResult = isCarousel
    // ig_business_account_id is guaranteed non-null here — checked above.
    ? await publishCarouselToInstagram(connection.ig_business_account_id!, connection.access_token, { imageUrls: imageUrls!, caption })
    : entry.platform === "instagram"
      ? await publishToInstagram(connection.ig_business_account_id!, connection.access_token, { imageUrl: imageUrl!, caption })
      : await publishToFacebook(connection.facebook_page_id, connection.access_token, { imageUrl: imageUrl!, message: caption })

  if (!publishResult.success) {
    console.error(`[cron/publish-scheduled] entry ${entry.id}: publish failed (retryable=${publishResult.retryable}) — ${publishResult.error}`)
    return await recordFailure(admin, entry, publishResult.error)
  }

  const externalId = "instagramMediaId" in publishResult ? publishResult.instagramMediaId : publishResult.facebookPostId
  console.log(`[cron/publish-scheduled] entry ${entry.id}: published — ${entry.platform} id ${externalId}`)

  const publishedAt = new Date().toISOString()
  const mediaIdKey = entry.platform === "instagram" ? "instagram_media_id" : "facebook_post_id"

  const { error: updateError } = await calendarEntriesTable(admin)
    .update({
      status: "published",
      platform_specific_data: {
        ...platformData,
        ...(isCarousel ? { hosted_image_urls: imageUrls } : { hosted_image_url: imageUrl }),
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
    .in("platform", ["instagram", "facebook"])
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
