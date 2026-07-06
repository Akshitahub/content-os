"use client"

import { useState, useCallback, useEffect } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Film, Loader2, Download, CalendarClock, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { isApiError } from "@/types/api"

type VideoJobStatus = "pending" | "generating_images" | "generating_voiceover" | "assets_ready" | "rendering" | "completed" | "failed"

interface VideoJobStatusResponse {
  id: string
  status: VideoJobStatus
  progress_message: string | null
  scene_assets: unknown
  music_url: string | null
  video_url: string | null
  error_message: string | null
}

const IN_PROGRESS_STATUSES: VideoJobStatus[] = ["pending", "generating_images", "generating_voiceover", "rendering"]

/**
 * Defense-in-depth: the server sanitizes error text before storing it in
 * error_message, but this guards against any future failure path that
 * forgets to — a raw API error (JSON body, provider error codes) should
 * never reach the user, regardless of which layer let it through.
 */
function safeErrorMessage(raw: string | null): string {
  if (!raw) return "Video generation failed."
  const looksRaw = raw.trim().startsWith("{") || raw.includes("invalid_request_error") || raw.includes('"code"') || raw.includes('"type"')
  return looksRaw ? "Video generation failed. Please try again." : raw
}

interface SceneAssetLike {
  sceneIndex: number
  error: string | null
}

/**
 * scene_assets is stored as jsonb, so it arrives as `unknown` — the shape
 * is already sanitized server-side in lib/video/reel-scene-assets.ts, this
 * just narrows it enough to iterate safely.
 */
function SceneFailureDetails({ sceneAssets }: { sceneAssets: unknown }) {
  const [expanded, setExpanded] = useState(false)

  if (!Array.isArray(sceneAssets)) return null
  const failures = (sceneAssets as SceneAssetLike[]).filter(
    (scene) => scene && typeof scene === "object" && scene.error
  )
  if (failures.length === 0) return null

  return (
    <div className="mt-1">
      <button
        type="button"
        className="text-muted-foreground underline underline-offset-2"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? "Hide details" : "Show details"}
      </button>
      {expanded && (
        <ul className="mt-1 space-y-0.5 text-muted-foreground">
          {failures.map((scene) => (
            <li key={scene.sceneIndex}>
              Scene {scene.sceneIndex}: {scene.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Schedules a completed Reel video to YouTube via the Zernio-backed
 * schedule-post endpoint. Only rendered once the video job has actually
 * finished, since there's nothing to schedule before that.
 */
function ScheduleToYoutube({ brandId, videoUrl, defaultCaption }: { brandId: string; videoUrl: string; defaultCaption?: string }) {
  const [youtubeConnected, setYoutubeConnected] = useState<boolean | null>(null)
  const [open, setOpen] = useState(false)
  const [caption, setCaption] = useState(defaultCaption ?? "")
  const [date, setDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return d.toISOString().split("T")[0]
  })
  const [time, setTime] = useState("10:00")
  const [submitState, setSubmitState] = useState<"idle" | "loading" | "success" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const checkConnection = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/brands/${brandId}/social-connections`)
      const json: unknown = await res.json()
      if (res.ok && !isApiError(json)) {
        setYoutubeConnected(Boolean((json as { data: { youtube_connected?: boolean } }).data.youtube_connected))
      } else {
        setYoutubeConnected(false)
      }
    } catch {
      setYoutubeConnected(false)
    }
  }, [brandId])

  useEffect(() => {
    checkConnection()
  }, [checkConnection])

  const handleSchedule = useCallback(async () => {
    setSubmitState("loading")
    setErrorMsg(null)
    try {
      const res = await fetch("/api/v1/calendar/schedule-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          platform: "youtube",
          videoUrl,
          contentFormat: "video",
          caption,
          hashtags: [],
          scheduledDate: date,
          scheduledTime: time,
        }),
      })
      const json: unknown = await res.json()
      if (!res.ok || isApiError(json)) {
        setErrorMsg(isApiError(json) ? json.error.message : "Failed to schedule.")
        setSubmitState("error")
        return
      }
      setSubmitState("success")
    } catch {
      setErrorMsg("Network error. Please try again.")
      setSubmitState("error")
    }
  }, [brandId, videoUrl, caption, date, time])

  if (youtubeConnected === null) return null

  if (!youtubeConnected) {
    return (
      <a
        href={`/api/v1/social/youtube/connect?brandId=${brandId}`}
        className="text-xs text-primary underline underline-offset-2"
      >
        Connect YouTube to schedule this
      </a>
    )
  }

  if (submitState === "success") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-green-700">
        <Check className="h-3 w-3" /> Scheduled for YouTube on {date} at {time}
      </div>
    )
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="w-full" onClick={() => setOpen(true)}>
        <CalendarClock className="mr-1.5 h-3.5 w-3.5" /> Schedule to YouTube
      </Button>
    )
  }

  return (
    <div className="space-y-2 rounded-md border p-2">
      <div className="space-y-1">
        <Label className="text-xs">Caption</Label>
        <textarea
          rows={2}
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Time</Label>
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>
      <Button size="sm" className="w-full" onClick={handleSchedule} disabled={submitState === "loading" || !caption.trim()}>
        {submitState === "loading" ? "Scheduling…" : "Confirm schedule"}
      </Button>
      {submitState === "error" && errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}
    </div>
  )
}

/**
 * Kicks off the async reel-to-video job and polls its status. Shared
 * between the Library's saved-script card and the reel generation screen
 * itself, so both entry points behave identically.
 */
export function GenerateVideoAction({ scriptId, brandId, defaultCaption }: { scriptId: string; brandId: string; defaultCaption?: string }) {
  const [jobId, setJobId] = useState<string | null>(null)

  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/v1/brands/${brandId}/reel-scripts/${scriptId}/video`, { method: "POST" })
      const json = await res.json() as { data?: { jobId: string }; error?: { message?: string } }
      if (!res.ok || !json.data) throw new Error(json.error?.message ?? "Failed to start video generation.")
      return json.data
    },
    onSuccess: (data) => setJobId(data.jobId),
  })

  const statusQuery = useQuery({
    queryKey: ["reel-video-job", scriptId, jobId],
    queryFn: async (): Promise<VideoJobStatusResponse> => {
      const res = await fetch(`/api/v1/brands/${brandId}/reel-scripts/${scriptId}/video?jobId=${jobId}`)
      const json = await res.json() as { data?: VideoJobStatusResponse; error?: { message?: string } }
      if (!res.ok || !json.data) throw new Error(json.error?.message ?? "Failed to check video status.")
      return json.data
    },
    enabled: !!jobId,
    refetchInterval: (query) => (query.state.data && IN_PROGRESS_STATUSES.includes(query.state.data.status) ? 3000 : false),
  })

  const job = statusQuery.data

  return (
    <div className="space-y-1.5 border-t pt-2">
      {!jobId && (
        <Button size="sm" variant="outline" className="w-full" onClick={() => startMutation.mutate()} disabled={startMutation.isPending}>
          <Film className="mr-1.5 h-3.5 w-3.5" />
          {startMutation.isPending ? "Starting…" : "Generate video"}
        </Button>
      )}

      {jobId && job && (
        <div className="text-xs">
          {IN_PROGRESS_STATUSES.includes(job.status) && (
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> {job.progress_message ?? "Working…"}
            </p>
          )}
          {job.status === "assets_ready" && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900">
              <p className="font-medium">Scene assets generated ✓</p>
              <p className="mt-0.5">{job.progress_message}</p>
            </div>
          )}
          {job.status === "completed" && job.video_url && (
            <div className="space-y-2">
              <a
                href={job.video_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-primary underline underline-offset-2"
              >
                <Download className="h-3 w-3" /> Download video
              </a>
              <ScheduleToYoutube brandId={brandId} videoUrl={job.video_url} defaultCaption={defaultCaption} />
            </div>
          )}
          {job.status === "failed" && (
            <div>
              <p className="text-destructive">{safeErrorMessage(job.error_message)}</p>
              <SceneFailureDetails sceneAssets={job.scene_assets} />
            </div>
          )}
        </div>
      )}

      {startMutation.isError && (
        <p className="text-xs text-destructive">{startMutation.error instanceof Error ? startMutation.error.message : "Failed to start video generation."}</p>
      )}
    </div>
  )
}
