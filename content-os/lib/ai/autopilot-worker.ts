import { after } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/server"
import { MODELS } from "./models"
import {
  generateSlotContent, normalizeReelScenes, submitAutopilotReel, trackUsage,
  IMAGE_BUCKET, MIN_CAROUSEL_SLIDES, type AutopilotUsageTracker,
} from "./fastlane"
import { attemptsCostUsd, generatePostImage } from "./post-image-pipeline"
import { generateCarouselHtml } from "@/lib/design/post-card-generator"
import { DEFAULT_POST_TEMPLATE_ID } from "@/lib/design/post-templates"
import { resolveColorThemes, type ColorTheme } from "@/lib/design/color-themes"
import { mergeCaptionWithHookAndCta } from "@/lib/utils/caption-merge"
import { MUSIC_OPTIONS, resolveMusicTrackId } from "@/lib/video/music-options"
import { renderCarouselSlidesToPng } from "@/lib/image/carousel-compositor"
import { uploadMediaToStorage } from "@/lib/storage/upload-media"
import { refundGenerationUsage } from "@/lib/usage/check-and-increment-usage"
import { resolveGenerationLimit } from "@/lib/usage/trial-status"
import { withDeadline } from "@/lib/utils/with-deadline"
import { PLAN_LIMITS } from "@/types/app"
import type { BrandRow, ProductRow, CalendarEntryRow, Json, Database } from "@/types/database"
import type { ContentSlot, FastlaneResult, Platform, ReelScene, UserPlan } from "@/types/app"
import { prepareGeneratedImage } from "@/lib/storage/generated-image"

// Background Autopilot worker (supabase/migrations/057_autopilot_slot_jobs.sql).
// A Supabase Cron job calls app/api/v1/cron/autopilot-drain every 20s while
// slots are waiting; each call runs drainAutopilotQueue once. Per slot:
//   1. generate everything (text, image / carousel PNGs, reel plan) --
//      files may be uploaded to storage, but NO database rows are written;
//   2. complete_autopilot_slot: lease check + charge in one transaction;
//   3. only if that returned 'charged': write hook/caption/carousel/reel
//      rows and the calendar entry.
// So a slot that failed, timed out or lost its lease can never be charged
// or save content, and a finished slot is never charged twice. A failed
// slot is retried once (fail_autopilot_slot), then failed -- uncharged.

/** Slots claimed per drain call; MAX_RUNNING caps concurrent slots across all users (OpenAI rate limits). */
const CLAIM_BATCH = 3
const MAX_RUNNING = 6
/** Lease per claim -- just under the drain route's 300s maxDuration. */
const LEASE_SECONDS = 285
/** Generation must finish this long before the lease expires, leaving time to commit and save. */
const SLOT_WORK_MARGIN_MS = 25_000

/** Stored in autopilot_run_status.params by app/api/v1/brands/fastlane/route.ts. */
export type AutopilotRunParams = {
  frequency?: string
  platforms?: string[]
  vibe?: string
  focusAreas?: string[]
  totalSlots: number
  plan: UserPlan
  isInternalUnlimitedUser: boolean
  strategySummary: string
  /** IST calendar date (YYYY-MM-DD) slot day 1 lands on -- fixed at run start, so slots generated minutes later still land on the planned days. */
  baseDate: string
}

type SlotJobRow = {
  id: string
  run_id: string
  user_id: string
  brand_id: string
  slot_index: number
  slot: ContentSlot
  credit_cost: number
  attempts: number
  lease_token: string
  lease_expires_at: string
}

type RunContext = {
  runId: string
  logId: string | null
  params: AutopilotRunParams
  brand: BrandRow
  productByName: Map<string, ProductRow>
  /** Credit limit for complete_autopilot_slot; null = internal-unlimited, never charged. */
  pLimit: number | null
  imageColorTheme: ColorTheme
}

type PreparedSlot = {
  generated: Awaited<ReturnType<typeof generateSlotContent>>
  mergedCaption: string
  product: ProductRow | null
  scheduledDate: string
  isCarousel: boolean
  isReel: boolean
  imageUrl: string | null
  carouselHtml: string | null
  carouselSlides: { slide_number: number; headline: string; body: string }[]
  carouselImageUrls: string[]
  reelScenes: ReelScene[]
  reelMusicUrl: string | null
}

type Admin = SupabaseClient<Database>

/** Enqueues one pending job per planned slot (service role -- users can only read these rows). */
export async function enqueueAutopilotSlots(admin: Admin, input: {
  runId: string
  userId: string
  brandId: string
  slots: ContentSlot[]
  creditCost: (contentType: string) => number
}): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin.from("autopilot_slot_jobs" as any) as any).insert(
    input.slots.map((slot, i) => ({
      run_id: input.runId,
      user_id: input.userId,
      brand_id: input.brandId,
      slot_index: i,
      slot: slot as unknown as Json,
      credit_cost: input.creditCost(slot.content_type),
    }))
  )
  if (error) throw new Error(`Couldn't queue Autopilot slots: ${error.message}`)
}

/** One drain pass: claims up to CLAIM_BATCH slots and processes them in parallel. */
export async function drainAutopilotQueue(): Promise<{ claimed: number }> {
  const admin = await createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin.rpc as any)("claim_autopilot_slots", {
    p_limit: CLAIM_BATCH, p_max_running: MAX_RUNNING, p_lease_seconds: LEASE_SECONDS,
  }) as { data: SlotJobRow[] | null; error: { message: string; code?: string; details?: string | null; hint?: string | null } | null }
  if (error) {
    // code PGRST202 = the function isn't there (migration 057 not run, or
    // PostgREST's schema cache not reloaded); 42501 = permission denied.
    console.error(`[autopilot-worker] claim failed: code=${error.code ?? "none"} message=${error.message} details=${error.details ?? "none"} hint=${error.hint ?? "none"}`)
    return { claimed: 0 }
  }
  const jobs = data ?? []
  if (jobs.length === 0) return { claimed: 0 }

  const contexts = new Map<string, Promise<RunContext | null>>()
  await Promise.allSettled(jobs.map((job) => processSlotJob(admin, job, contexts)))
  return { claimed: jobs.length }
}

async function processSlotJob(admin: Admin, job: SlotJobRow, contexts: Map<string, Promise<RunContext | null>>): Promise<void> {
  const startedAt = Date.now()
  const tracker: AutopilotUsageTracker = { usage: undefined, costUsd: null, captionMs: 0, imageMs: 0 }
  let outcome = "failed"
  try {
    if (!contexts.has(job.run_id)) contexts.set(job.run_id, loadRunContext(admin, job))
    const ctx = await contexts.get(job.run_id)!
    if (!ctx) {
      outcome = await failSlot(admin, job, "Run data unavailable")
      return
    }

    // 1. Generate -- bounded inside the lease. A deadline hit abandons the
    // work: if it finishes later in the background its result is simply
    // discarded (nothing below runs for it), and the slot is retried.
    const workDeadline = new Date(job.lease_expires_at).getTime() - SLOT_WORK_MARGIN_MS
    let prepared: PreparedSlot
    try {
      prepared = await withDeadline(prepareSlot(admin, job, ctx, tracker, workDeadline), workDeadline - Date.now(), "autopilot slot")
    } catch (err) {
      outcome = await failSlot(admin, job, err instanceof Error ? err.message : "Generation failed")
      return
    }

    // 2. Commit + charge, atomically, only with a still-valid lease.
    const commit = await commitSlot(admin, job, ctx)
    if (commit !== "charged") {
      outcome = commit
      return
    }

    // 3. Save. A failure here is compensated: refund + delete what was written.
    try {
      await persistSlot(admin, job, ctx, prepared)
      outcome = "charged"
    } catch (err) {
      await revertCommittedSlot(admin, job, ctx, err)
      outcome = "save_failed_refunded"
    }
    await recordSlotUsage(admin, ctx, tracker)
  } catch (err) {
    console.error(`[autopilot-worker] slot ${job.id} unexpected error:`, err instanceof Error ? err.message : err)
    outcome = await failSlot(admin, job, "Unexpected error")
  } finally {
    console.log(`[gen-timing] route=autopilot-slot event=end status=${outcome} totalMs=${Date.now() - startedAt} captionMs=${tracker.captionMs} imageMs=${tracker.imageMs} run=${job.run_id} slot=${job.slot_index} attempt=${job.attempts}`)
  }
}

async function failSlot(admin: Admin, job: SlotJobRow, reason: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin.rpc as any)("fail_autopilot_slot", {
    p_slot_id: job.id, p_lease_token: job.lease_token, p_reason: reason.slice(0, 300),
  }) as { data: string | null; error: { message: string } | null }
  if (error) console.error(`[autopilot-worker] fail_autopilot_slot failed for ${job.id}:`, error.message)
  return data ?? "fail_error"
}

async function commitSlot(admin: Admin, job: SlotJobRow, ctx: RunContext): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin.rpc as any)("complete_autopilot_slot", {
    p_slot_id: job.id, p_lease_token: job.lease_token, p_limit: ctx.pLimit,
  }) as { data: string | null; error: { message: string } | null }
  if (!error) return data ?? "commit_error"

  // The call may have committed even though its response was lost -- the
  // slot row is the source of truth. 'done' means it WAS charged, so save.
  console.error(`[autopilot-worker] complete_autopilot_slot errored for ${job.id}, re-checking:`, error.message)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await (admin.from("autopilot_slot_jobs" as any) as any)
    .select("status").eq("id", job.id).single() as { data: { status: string } | null }
  return row?.status === "done" ? "charged" : "commit_error"
}

async function loadRunContext(admin: Admin, job: SlotJobRow): Promise<RunContext | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: run } = await (admin.from("autopilot_run_status") as any)
    .select("id, params, log_id").eq("id", job.run_id).single() as { data: { id: string; params: AutopilotRunParams | null; log_id: string | null } | null }
  if (!run?.params) return null

  const { data: brand } = await admin.from("brands").select("*").eq("id", job.brand_id).eq("user_id", job.user_id).single<BrandRow>()
  if (!brand) return null

  const { data: products } = await admin.from("products").select("*").eq("brand_id", job.brand_id).eq("is_active", true).returns<ProductRow[]>()

  // Same limit checkAndIncrementUsage would use, from the user's CURRENT
  // plan/trial (they may have upgraded mid-run).
  let pLimit: number | null = null
  if (!run.params.isInternalUnlimitedUser) {
    const { data: user } = await admin.from("users").select("plan, trial_ends_at, subscribed_at").eq("id", job.user_id)
      .single<{ plan: string; trial_ends_at: string | null; subscribed_at: string | null }>()
    const plan: UserPlan = user?.plan && user.plan in PLAN_LIMITS ? (user.plan as UserPlan) : "starter"
    pLimit = resolveGenerationLimit(plan, { trial_ends_at: user?.trial_ends_at ?? null, subscribed_at: user?.subscribed_at ?? null })
  }

  return {
    runId: run.id,
    logId: run.log_id,
    params: run.params,
    brand,
    productByName: new Map((products ?? []).map((p) => [p.name.toLowerCase(), p])),
    pLimit,
    imageColorTheme: resolveColorThemes(brand)[0]!,
  }
}

// IST calendar date for a slot: run's day-1 date + (day - 1).
function slotScheduledDate(baseDate: string, day: number): string {
  const d = new Date(`${baseDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + Math.max(0, day - 1))
  return d.toISOString().slice(0, 10)
}

// Phase 1: everything that costs model time or uploads files. No rows.
async function prepareSlot(admin: Admin, job: SlotJobRow, ctx: RunContext, tracker: AutopilotUsageTracker, workDeadline: number): Promise<PreparedSlot> {
  const { brand, params } = ctx
  const slot = job.slot
  const product = slot.product_focus ? (ctx.productByName.get(slot.product_focus.toLowerCase()) ?? null) : null
  const isCarousel = slot.content_type === "carousel"
  const isReel = slot.content_type === "reel_script"

  const captionStartedAt = Date.now()
  // Fact-guard retry only if it can still finish well inside the lease.
  const generated = await generateSlotContent(brand, slot, product, params.totalSlots, tracker, workDeadline - 60_000)
  tracker.captionMs += Date.now() - captionStartedAt

  // The per-slot prompt has no structural guarantee that `caption` opens
  // with the hook or closes with the CTA -- merged in so caption_text (the
  // only field publish-scheduled/route.ts sends) is the true final text.
  const mergedCaption = generated.caption
    ? mergeCaptionWithHookAndCta(generated.caption, generated.hook, generated.call_to_action)
    : generated.caption

  // Post slots: AI image (clean, no text overlay -- Autopilot has no human
  // choosing on-image text). Uploaded now; referenced only if committed.
  let imageUrl: string | null = null
  if (!isReel && !isCarousel) {
    try {
      const imageStartedAt = Date.now()
      const imageResult = await generatePostImage({
        imagePrompt: generated.visual_direction || "professional product photography",
        brandNiche: brand.niche,
        targetAudience: brand.target_audience,
        template: DEFAULT_POST_TEMPLATE_ID,
        colorTheme: ctx.imageColorTheme,
        logoUrl: brand.logo_url,
        plan: params.plan,
        isInternalUnlimitedUser: params.isInternalUnlimitedUser,
        // Autopilot post backgrounds get text on top -- "low" is enough.
        quality: "low",
      })
      trackUsage(tracker, undefined, attemptsCostUsd(imageResult.attempts))
      tracker.imageMs += Date.now() - imageStartedAt
      if (imageResult.success) {
        const image = await prepareGeneratedImage(imageResult.buffer, imageResult.mimeType, `autopilot-worker slot ${job.id}`)
        const storagePath = `${job.user_id}/${job.brand_id}/${Date.now()}-${crypto.randomUUID()}.${image.ext}`
        const { error: uploadError } = await admin.storage.from(IMAGE_BUCKET)
          .upload(storagePath, image.buffer, { contentType: image.mimeType, upsert: false })
        if (uploadError) {
          console.error(`[autopilot-worker] slot ${job.id}: image upload failed:`, uploadError.message)
        } else {
          imageUrl = admin.storage.from(IMAGE_BUCKET).getPublicUrl(storagePath).data.publicUrl
        }
      } else {
        console.error(`[autopilot-worker] slot ${job.id}: image generation failed:`, imageResult.error)
      }
    } catch (err) {
      console.error(`[autopilot-worker] slot ${job.id}: image generation unexpected error:`, err instanceof Error ? err.message : err)
    }
  }

  // Carousel slots: HTML preview + real PNG slides, uploaded now.
  const carouselSlides = Array.isArray(generated.slides) ? generated.slides : []
  let carouselHtml: string | null = null
  let carouselImageUrls: string[] = []
  if (isCarousel && carouselSlides.length > 0) {
    try {
      carouselHtml = generateCarouselHtml(brand, generated.hook, carouselSlides)
    } catch {
      // non-fatal
    }
  }
  if (isCarousel && carouselSlides.length >= MIN_CAROUSEL_SLIDES) {
    try {
      const slidePngs = await renderCarouselSlidesToPng({ brand, coverHook: generated.hook || slot.theme, slides: carouselSlides })
      const uploaded: string[] = []
      for (let idx = 0; idx < slidePngs.length; idx++) {
        const uploadResult = await uploadMediaToStorage(
          { kind: "buffer", buffer: slidePngs[idx]!, mimeType: "image/png" },
          `${job.brand_id}/carousel/${Date.now()}-${idx}`,
          { generatedImage: true }
        )
        if ("publicUrl" in uploadResult) uploaded.push(uploadResult.publicUrl)
        else console.error(`[autopilot-worker] slot ${job.id}: carousel slide ${idx} upload failed:`, uploadResult.error)
      }
      if (uploaded.length >= MIN_CAROUSEL_SLIDES) carouselImageUrls = uploaded
    } catch (err) {
      console.error(`[autopilot-worker] slot ${job.id}: carousel rendering failed:`, err instanceof Error ? err.message : err)
    }
  }

  // Reel slots: scenes + music now; the script/job rows and the video
  // submission happen only after commit.
  const reelScenes = isReel ? normalizeReelScenes(generated.scenes) : []
  const reelMusicUrl = isReel && reelScenes.length > 0
    ? (MUSIC_OPTIONS.find((m) => m.id === resolveMusicTrackId(generated.audio_suggestion)) ?? MUSIC_OPTIONS.find((m) => m.id === "upbeat")!).url
    : null

  return {
    generated, mergedCaption, product,
    scheduledDate: slotScheduledDate(params.baseDate, slot.day),
    isCarousel, isReel, imageUrl, carouselHtml, carouselSlides, carouselImageUrls, reelScenes, reelMusicUrl,
  }
}

type Written = { hookId?: string; captionId?: string; carouselId?: string; reelScriptId?: string; reelJobId?: string; entryId?: string }

// Phase 3: only after a successful commit. Ids written so far are kept on
// the error so revertCommittedSlot can delete them.
async function persistSlot(admin: Admin, job: SlotJobRow, ctx: RunContext, p: PreparedSlot): Promise<void> {
  const written: Written = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (table: string) => admin.from(table as any) as any
  const slot = job.slot
  const brandId = job.brand_id
  const g = p.generated
  try {
    if (g.hook) {
      const { data } = await db("hooks").insert({
        brand_id: brandId, hook_text: g.hook, hook_type: "bold_statement",
        generation_prompt: `fastlane day:${slot.day} platform:${slot.platform}`, model_used: MODELS.creative, is_saved: true,
      }).select("id").single() as { data: { id: string } | null }
      written.hookId = data?.id
    }
    if (g.caption) {
      const { data } = await db("captions").insert({
        brand_id: brandId, hook_id: written.hookId ?? null, caption_text: p.mergedCaption, hashtags: g.hashtags ?? [],
        cta: g.call_to_action || null, character_count: p.mergedCaption.length, platform: slot.platform,
        model_used: MODELS.creative, is_saved: true,
      }).select("id").single() as { data: { id: string } | null }
      written.captionId = data?.id
    }
    if (p.isCarousel && p.carouselImageUrls.length > 0) {
      const { data } = await db("carousels").insert({
        brand_id: brandId, product_id: p.product?.id ?? null, platform: slot.platform, title: g.title || slot.theme,
        slides: p.carouselSlides as unknown as Json, hashtags: g.hashtags ?? [], is_saved: true,
      }).select("id").single() as { data: { id: string } | null }
      written.carouselId = data?.id
    }

    const platformData: Record<string, string | string[]> = {}
    if (p.imageUrl) platformData.image_url = p.imageUrl
    if (p.carouselHtml) platformData.carousel_html = p.carouselHtml
    if (p.carouselImageUrls.length > 0) {
      // Same shape schedule-post/route.ts produces for a manual carousel.
      platformData.content_format = "carousel"
      platformData.image_urls = p.carouselImageUrls
      platformData.hosted_image_urls = p.carouselImageUrls
    }

    if (p.isReel) {
      platformData.content_format = "video"
      if (p.reelScenes.length === 0) {
        platformData.video_status = "failed"
        platformData.video_error = "Couldn't plan out scenes for this reel."
      } else {
        const { data: script } = await db("reel_scripts").insert({
          brand_id: brandId, product_id: p.product?.id ?? null, platform: slot.platform, hook: g.hook || slot.theme,
          scenes: p.reelScenes as unknown as Json, caption: p.mergedCaption || null, hashtags: g.hashtags ?? [], is_saved: true,
        }).select("id").single() as { data: { id: string } | null }
        written.reelScriptId = script?.id
        if (written.reelScriptId) {
          const { data: jobRow } = await db("reel_video_jobs").insert({
            brand_id: brandId, reel_script_id: written.reelScriptId, status: "pending",
            progress_message: "Queued by Autopilot…", music_url: p.reelMusicUrl,
          }).select("id").single() as { data: { id: string } | null }
          written.reelJobId = jobRow?.id
        }
        platformData.video_status = written.reelJobId ? "rendering" : "failed"
        if (!written.reelJobId) platformData.video_error = written.reelScriptId ? "Couldn't start video rendering." : "Couldn't save the reel script for rendering."
      }
    }

    const { data: entry, error: entryError } = await db("calendar_entries").insert({
      brand_id: brandId,
      title: g.title || slot.theme,
      scheduled_date: p.scheduledDate,
      platform: slot.platform as Platform,
      content_type: p.isCarousel ? "carousel" : p.isReel ? "reel" : "post",
      status: "content_ready",
      hook_text: g.hook || null,
      caption_text: p.mergedCaption || null,
      hashtags: g.hashtags ?? [],
      visual_direction: g.visual_direction || null,
      audio_suggestion: g.audio_suggestion || null,
      notes: g.call_to_action || null,
      hook_id: written.hookId ?? null,
      caption_id: written.captionId ?? null,
      carousel_id: written.carouselId ?? null,
      is_ready: true,
      platform_specific_data: platformData,
      color: slot.priority === "high" ? "#6366f1" : slot.priority === "medium" ? "#8b5cf6" : "#a78bfa",
    }).select("id").single() as { data: { id: string } | null; error: { message: string } | null }
    if (entryError || !entry) throw new Error(`Calendar insert failed: ${entryError?.message ?? "no row"}`)
    written.entryId = entry.id

    await db("autopilot_slot_jobs").update({ calendar_entry_id: entry.id, updated_at: new Date().toISOString() }).eq("id", job.id)

    if (written.reelJobId && written.reelScriptId) {
      await db("reel_video_jobs").update({ calendar_entry_id: entry.id }).eq("id", written.reelJobId)
      const scriptId = written.reelScriptId
      const jobId = written.reelJobId
      const scenes = p.reelScenes
      after(async () => {
        await submitAutopilotReel({ brandId, scriptId, jobId, calendarEntryId: entry.id, scenes })
      })
    }
  } catch (err) {
    throw Object.assign(err instanceof Error ? err : new Error(String(err)), { written })
  }
}

// The slot was charged (committed) but its content couldn't be saved:
// refund it, delete anything partially written, and fail it -- so the user
// is never charged for a slot they don't get, and never gets content for a
// slot they were refunded for.
async function revertCommittedSlot(admin: Admin, job: SlotJobRow, ctx: RunContext, err: unknown): Promise<void> {
  console.error(`[autopilot-worker] slot ${job.id}: saving failed after charge, refunding:`, err instanceof Error ? err.message : err)
  const written: Written = (err as { written?: Written })?.written ?? {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (table: string) => admin.from(table as any) as any
  const deletes: [string, string | undefined][] = [
    ["calendar_entries", written.entryId], ["reel_video_jobs", written.reelJobId], ["reel_scripts", written.reelScriptId],
    ["carousels", written.carouselId], ["captions", written.captionId], ["hooks", written.hookId],
  ]
  for (const [table, id] of deletes) {
    if (id) await db(table).delete().eq("id", id).then(() => undefined, () => undefined)
  }

  if (ctx.pLimit !== null) {
    await refundGenerationUsage(admin, job.user_id, job.credit_cost)
    if (ctx.logId) {
      const { data: log } = await db("ai_generation_logs").select("credits_charged").eq("id", ctx.logId).single() as { data: { credits_charged: number | null } | null }
      await db("ai_generation_logs").update({ credits_charged: Math.max(0, (log?.credits_charged ?? 0) - job.credit_cost) }).eq("id", ctx.logId)
    }
  }
  await db("autopilot_slot_jobs").update({ status: "failed", failure_reason: "Couldn't save after generating (refunded)", updated_at: new Date().toISOString() }).eq("id", job.id)
  const { data: run } = await db("autopilot_run_status").select("completed_slots, failed_slots").eq("id", job.run_id).single() as { data: { completed_slots: number; failed_slots: number } | null }
  if (run) {
    await db("autopilot_run_status").update({ completed_slots: Math.max(0, run.completed_slots - 1), failed_slots: run.failed_slots + 1 }).eq("id", job.run_id)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.rpc as any)("finish_autopilot_run_if_done", { p_run_id: job.run_id })
}

// Adds this slot's tokens/cost onto the run's single ai_generation_logs row.
// Atomic increment in Postgres (supabase/migrations/058_add_generation_log_usage.sql)
// -- concurrent slots finishing at once no longer lose each other's additions.
async function recordSlotUsage(admin: Admin, ctx: RunContext, tracker: AutopilotUsageTracker): Promise<void> {
  if (!ctx.logId) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin.rpc as any)("add_generation_log_usage", {
    p_log_id: ctx.logId,
    p_prompt: tracker.usage?.prompt_tokens ?? 0,
    p_completion: tracker.usage?.completion_tokens ?? 0,
    p_total: tracker.usage?.total_tokens ?? 0,
    p_cost: tracker.costUsd ?? 0,
  }) as { error: { message: string } | null }
  if (error) console.error(`[autopilot-worker] failed to record slot usage on log ${ctx.logId}:`, error.message)
}

/**
 * The finished-run summary the Autopilot page shows (same FastlaneResult
 * shape the old synchronous run returned), built from the slot jobs once a
 * run is done. Works with the user's own RLS-scoped client.
 */
export async function buildAutopilotRunResult(supabase: SupabaseClient<Database>, run: { id: string; brand_id: string; total_slots: number; params: unknown; log_id?: string | null }): Promise<FastlaneResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (table: string) => supabase.from(table as any) as any
  const { data: jobs } = await db("autopilot_slot_jobs").select("status, failure_reason, calendar_entry_id").eq("run_id", run.id) as
    { data: { status: string; failure_reason: string | null; calendar_entry_id: string | null }[] | null }
  const entryIds = (jobs ?? []).map((j) => j.calendar_entry_id).filter((id): id is string => !!id)
  const { data: entries } = entryIds.length
    ? await supabase.from("calendar_entries").select("*").in("id", entryIds).order("scheduled_date", { ascending: true }).returns<CalendarEntryRow[]>()
    : { data: [] as CalendarEntryRow[] }

  const failed = (jobs ?? []).filter((j) => j.status === "failed")
  const errors = failed.length > 0
    ? [`${failed.length} slot(s) couldn't be generated and weren't charged${failed.some((f) => f.failure_reason === "insufficient_credits") ? " (some ran out of credits)" : ""}.`]
    : []

  let creditsCharged: number | undefined
  if (run.log_id) {
    const { data: log } = await db("ai_generation_logs").select("credits_charged").eq("id", run.log_id).single() as { data: { credits_charged: number | null } | null }
    creditsCharged = log?.credits_charged ?? 0
  }

  const params = (run.params ?? {}) as Partial<AutopilotRunParams>
  return {
    brand_id: run.brand_id,
    slots_planned: run.total_slots,
    slots_generated: (jobs ?? []).filter((j) => j.status === "done").length,
    calendar_entries_created: (entries ?? []).length,
    strategy_summary: params.strategySummary ?? "",
    errors,
    created_entries: entries ?? [],
    credits_charged: creditsCharged,
  }
}
