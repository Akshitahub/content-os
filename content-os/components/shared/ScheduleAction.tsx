"use client"

import { useState, useCallback } from "react"
import { CalendarClock, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { isApiError } from "@/types/api"
import { renderStorySlides, type StoryExportSlide } from "@/lib/utils/story-export"
import { renderCarouselSlides, type CarouselExportSlide } from "@/lib/utils/carousel-export"
import Link from "next/link"

// Extracted from five copy-pasted definitions (AdMaker.tsx,
// FullPostGenerator.tsx, CarouselBuilder.tsx, StorySequence.tsx, and
// MemeMaker.tsx before it was deleted) — the platform-picker/date-picker/
// "push to calendar" flow was identical everywhere, but a few genuinely
// different variants had accumulated:
//
// 1. Single hosted image (AdMaker, FullPostGenerator): schedules one
//    already-uploaded imageUrl across whichever of 6 platforms are
//    connected (instagram/facebook/threads/pinterest/linkedin/twitter).
//    AdMaker's and Carousel/Story's copies had regressed to an
//    Instagram/Facebook-only ConnectionStatus/platform picker; only
//    FullPostGenerator's had been kept current with all 6 -- that's the
//    version kept here, so every single-image caller now gets full
//    platform support instead of just two of them.
// 2. Carousel slides (CarouselBuilder.tsx, and the Library's
//    ContentDetailPanel for a saved carousel): used to capture each
//    slide's live DOM element as a data URL (captureElementAsDataUrl) --
//    which only exists while CarouselBuilder's own editor page is open,
//    so scheduling a saved carousel later from Library had no DOM to
//    capture and fell back to the bare, uncomposited AI background photo
//    instead (CONFIRMED, 2026-08-29, as a real published-post defect:
//    missing text, missing slides). Carousels now render server-side via
//    lib/image/carousel-compositor.ts (real 1080x1350, no editor chrome)
//    at schedule-confirm time instead, same fix already applied to
//    stories below -- see the carouselSlides branch.
// 3. Story slides (StorySequence.tsx, and Library): used to be DOM-
//    captured the same way mode 2 was -- but that captured the live
//    phone-frame preview element verbatim (rounded corners, phone chrome,
//    and all) at browser-screenshot quality, which is exactly what was
//    reaching real published Instagram stories. Stories render server-side
//    via lib/image/story-compositor.ts (real 1080x1920, no phone-frame
//    chrome) at schedule-confirm time instead — see the storySlides
//    branch below.
//
// One real bug found while reconciling: StorySequence's copy forgot to
// strip a leading "#" from hashtags before sending
// (`hashtags.map((h) => h.replace(/^#+/, ""))`, present in the other
// three) -- fixed here rather than preserved as intentional variation.
export interface ConnectionStatus {
  connected: boolean
  facebook_connected: boolean
  instagram_connected: boolean
  threads_connected?: boolean
  pinterest_connected?: boolean
  linkedin_connected?: boolean
  twitter_connected?: boolean
}

type SinglePlatform = "instagram" | "facebook" | "threads" | "pinterest" | "linkedin" | "twitter"

type ScheduleActionProps =
  | {
      brandId: string
      caption: string
      hashtags: string[]
      /** Already-hosted image URL — schedules directly to whichever
       * connected platform the user picks. */
      imageUrl: string
      carouselSlides?: undefined
      storySlides?: undefined
      imageUrls?: undefined
      contentFormat?: undefined
      itemLabel?: undefined
    }
  | {
      brandId: string
      caption: string
      hashtags: string[]
      imageUrl?: undefined
      /** Real slide data, rendered server-side via
       * lib/image/carousel-compositor.ts right before scheduling — a
       * clean full-bleed 1080x1350 raster (background + headline/points/
       * CTA text baked in), not a screenshot of the live editor DOM.
       * Instagram-only, same as every carousel path. */
      carouselSlides: CarouselExportSlide[]
      /** Composited onto the bottom-right corner of every slide, same as
       * the live SlidePreview. */
      brandName: string
      storySlides?: undefined
      imageUrls?: undefined
      contentFormat: "carousel"
      /** What to call one render unit in progress/error copy — defaults
       * to contentFormat's own name. */
      itemLabel?: string
    }
  | {
      brandId: string
      caption: string
      hashtags: string[]
      imageUrl?: undefined
      carouselSlides?: undefined
      /** Real slide data, rendered server-side via
       * lib/image/story-compositor.ts right before scheduling — a clean
       * full-bleed 1080x1920 raster, not a screenshot of the phone-frame
       * editing preview. Instagram-only, same as every story path. */
      storySlides: StoryExportSlide[]
      imageUrls?: undefined
      contentFormat: "story"
      itemLabel?: string
    }
  | {
      brandId: string
      caption: string
      hashtags: string[]
      imageUrl?: undefined
      carouselSlides?: undefined
      storySlides?: undefined
      /** Already-hosted slide image URLs — scheduled directly, no render
       * step needed. Instagram-only, same as the other multi-slide
       * variants. Kept for any caller that already has final, composited
       * URLs on hand (nothing currently uses this for carousel/story --
       * both now always render server-side above, so those slides are
       * never scheduled from stale/incomplete stored URLs). */
      imageUrls: string[]
      contentFormat: "carousel" | "story"
      itemLabel?: string
    }

export function ScheduleAction(props: ScheduleActionProps) {
  const { brandId, caption, hashtags } = props
  const isMultiSlide = props.carouselSlides !== undefined || props.imageUrls !== undefined || props.storySlides !== undefined
  const itemLabel = isMultiSlide ? (props.itemLabel ?? props.contentFormat) : ""
  // Pulled out of the union so the handleConfirm callback below can depend
  // on plain values instead of the whole `props` object.
  const imageUrl = props.imageUrl
  const carouselSlides = props.carouselSlides
  const brandName = props.carouselSlides ? props.brandName : undefined
  const storySlides = props.storySlides
  const preHostedImageUrls = props.imageUrls
  const contentFormat = props.contentFormat

  const [open, setOpen] = useState(false)
  const [connection, setConnection] = useState<ConnectionStatus | null>(null)
  const [checkingConnection, setCheckingConnection] = useState(false)
  const [connectionError, setConnectionError] = useState(false)
  const [platform, setPlatform] = useState<SinglePlatform>("instagram")
  const [date, setDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return d.toISOString().split("T")[0]
  })
  const [time, setTime] = useState("10:00")
  const [submitState, setSubmitState] = useState<"idle" | "capturing" | "loading" | "success" | "error">("idle")
  const [captureProgress, setCaptureProgress] = useState<{ current: number; total: number } | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successInfo, setSuccessInfo] = useState<{ platform: string; date: string; time: string } | null>(null)

  const checkConnection = useCallback(async () => {
    setCheckingConnection(true)
    setConnectionError(false)
    try {
      const res = await fetch(`/api/v1/brands/${brandId}/social-connections`)
      const json: unknown = await res.json()
      if (res.ok && !isApiError(json)) {
        const data = (json as { data: ConnectionStatus }).data
        setConnection(data)
        if (!isMultiSlide) {
          setPlatform(
            data.instagram_connected ? "instagram"
              : data.facebook_connected ? "facebook"
              : data.threads_connected ? "threads"
              : data.pinterest_connected ? "pinterest"
              : data.linkedin_connected ? "linkedin"
              : "twitter"
          )
        }
      } else {
        setConnectionError(true)
      }
    } catch {
      setConnectionError(true)
    } finally {
      setCheckingConnection(false)
    }
  }, [brandId, isMultiSlide])

  const openPanel = useCallback(() => {
    setOpen(true)
    if (!connection && !checkingConnection) checkConnection()
  }, [connection, checkingConnection, checkConnection])

  const closePanel = useCallback(() => {
    setOpen(false)
    setSubmitState("idle")
    setCaptureProgress(null)
    setErrorMsg(null)
    setSuccessInfo(null)
  }, [])

  const handleConfirm = useCallback(async () => {
    setErrorMsg(null)

    let body: Record<string, unknown>
    if (carouselSlides) {
      setSubmitState("capturing")
      // Real server-side render (lib/image/carousel-compositor.ts) instead
      // of a DOM screenshot -- this is the fix for a carousel scheduled
      // from Library previously publishing with no text and missing
      // slides (there was no live editor DOM to screenshot there at all).
      const renderedUrls = await renderCarouselSlides(brandName ?? "", carouselSlides)
      if (!renderedUrls || renderedUrls.length !== carouselSlides.length) {
        setErrorMsg(`Couldn't render the ${itemLabel} images. Please try again.`)
        setSubmitState("error")
        return
      }
      body = { brandId, platform: "instagram", imageUrls: renderedUrls, contentFormat, caption, hashtags: hashtags.map((h) => h.replace(/^#+/, "")), scheduledDate: date, scheduledTime: time }
    } else if (storySlides) {
      setSubmitState("capturing")
      // Real server-side render (lib/image/story-compositor.ts) instead of
      // a DOM screenshot — this is the fix for rounded phone-frame corners
      // and low quality showing up in real published Instagram stories.
      const renderedUrls = await renderStorySlides(storySlides)
      if (!renderedUrls || renderedUrls.length !== storySlides.length) {
        setErrorMsg(`Couldn't render the ${itemLabel} images. Please try again.`)
        setSubmitState("error")
        return
      }
      body = { brandId, platform: "instagram", imageUrls: renderedUrls, contentFormat, caption, hashtags: hashtags.map((h) => h.replace(/^#+/, "")), scheduledDate: date, scheduledTime: time }
    } else if (preHostedImageUrls) {
      // Already hosted (e.g. slides persisted from a saved Library item) —
      // no capture step needed, straight to scheduling.
      body = { brandId, platform: "instagram", imageUrls: preHostedImageUrls, contentFormat, caption, hashtags: hashtags.map((h) => h.replace(/^#+/, "")), scheduledDate: date, scheduledTime: time }
    } else {
      body = { brandId, platform, imageUrl, caption, hashtags: hashtags.map((h) => h.replace(/^#+/, "")), scheduledDate: date, scheduledTime: time }
    }

    setSubmitState("loading")
    try {
      const res = await fetch("/api/v1/calendar/schedule-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json: unknown = await res.json()
      if (!res.ok || isApiError(json)) {
        const msg = isApiError(json) ? json.error.message : "Failed to schedule post."
        setErrorMsg(msg)
        setSubmitState("error")
        return
      }
      setSuccessInfo({ platform: isMultiSlide ? "instagram" : platform, date, time })
      setSubmitState("success")
    } catch {
      setErrorMsg("Network error. Please try again.")
      setSubmitState("error")
    }
  }, [brandId, isMultiSlide, imageUrl, carouselSlides, brandName, storySlides, preHostedImageUrls, contentFormat, itemLabel, platform, caption, hashtags, date, time])

  const isBusy = submitState === "capturing" || submitState === "loading"

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={openPanel} className="flex items-center gap-1.5">
        <CalendarClock className="h-3.5 w-3.5" />
        {isMultiSlide ? "Schedule to Instagram" : "Schedule to Instagram/Facebook"}
      </Button>
    )
  }

  // Only ever show platforms that are actually connected — never a disabled
  // button for one that isn't. Not used in multi-slide mode (Instagram-only).
  const connectedPlatforms: { id: SinglePlatform; label: string }[] = connection
    ? [
        ...(connection.instagram_connected ? [{ id: "instagram" as const, label: "Instagram" }] : []),
        ...(connection.facebook_connected ? [{ id: "facebook" as const, label: "Facebook" }] : []),
        ...(connection.threads_connected ? [{ id: "threads" as const, label: "Threads" }] : []),
        ...(connection.pinterest_connected ? [{ id: "pinterest" as const, label: "Pinterest" }] : []),
        ...(connection.linkedin_connected ? [{ id: "linkedin" as const, label: "LinkedIn" }] : []),
        ...(connection.twitter_connected ? [{ id: "twitter" as const, label: "Twitter / X" }] : []),
      ]
    : []
  const platformLabel: Record<SinglePlatform, string> = {
    instagram: "Instagram", facebook: "Facebook", threads: "Threads",
    pinterest: "Pinterest", linkedin: "LinkedIn", twitter: "Twitter / X",
  }

  const canSchedule = isMultiSlide ? !!connection?.instagram_connected : !!connection?.connected && connectedPlatforms.length > 0

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {isMultiSlide ? `Schedule ${props.contentFormat}` : "Schedule post"}
        </span>
        <button type="button" onClick={closePanel} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          Close
        </button>
      </div>

      {checkingConnection && (
        <p className="text-sm text-muted-foreground">Checking your connection…</p>
      )}

      {!checkingConnection && connectionError && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-1.5">
          <p className="text-sm text-amber-900">Couldn&apos;t check your connection status.</p>
          <button
            type="button"
            onClick={checkConnection}
            className="text-xs font-semibold text-amber-700 underline underline-offset-2 hover:text-amber-900"
          >
            Try again
          </button>
        </div>
      )}

      {!checkingConnection && !connectionError && connection && !canSchedule && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-1.5">
          <p className="text-sm text-amber-900">
            {isMultiSlide
              ? `Connect an Instagram Business account to schedule ${props.contentFormat}s. ${props.contentFormat === "carousel" ? "Carousel" : "Story"} scheduling is Instagram-only.`
              : "Connect Instagram or Facebook first to schedule posts."}
          </p>
          <Link
            href={`/brands/${brandId}`}
            className="text-xs font-semibold text-amber-700 underline underline-offset-2 hover:text-amber-900"
          >
            Go to brand settings →
          </Link>
        </div>
      )}

      {!checkingConnection && !connectionError && canSchedule && submitState !== "success" && (
        <div className="space-y-3">
          {!isMultiSlide && (
            <div className="space-y-1.5">
              <Label className="text-xs">Platform</Label>
              <div className="flex flex-wrap gap-1.5">
                {connectedPlatforms.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlatform(p.id)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      platform === p.id ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={isBusy} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Time</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={isBusy} />
            </div>
          </div>

          <Button size="sm" className="w-full" onClick={handleConfirm} disabled={isBusy}>
            {submitState === "capturing"
              ? (captureProgress
                  ? `Capturing ${itemLabel} ${captureProgress.current} of ${captureProgress.total}…`
                  : `Rendering ${itemLabel}s…`)
              : submitState === "loading"
                ? "Scheduling…"
                : "Confirm schedule"}
          </Button>

          {submitState === "error" && errorMsg && (
            <p className="text-sm text-destructive">{errorMsg}</p>
          )}
        </div>
      )}

      {submitState === "success" && successInfo && (
        <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2">
          <Check className="h-4 w-4 text-green-500 shrink-0" />
          <span className="text-sm font-medium text-green-700">
            Scheduled for {platformLabel[successInfo.platform as SinglePlatform] ?? successInfo.platform} on {successInfo.date} at {successInfo.time}
          </span>
        </div>
      )}
    </div>
  )
}
