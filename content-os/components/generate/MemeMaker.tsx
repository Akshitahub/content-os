"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Loader2, Copy, Check, RefreshCw, AlertCircle, Image, CalendarClock } from "lucide-react"
import type { MemeResult } from "@/app/api/v1/ai/meme/generate/route"
import { captureElementAsDataUrl } from "@/lib/utils/download-as-image"
import { GenerationWarning } from "@/components/shared/GenerationWarning"
import { getFriendlyError } from "@/lib/utils/error-messages"
import { TopicSuggestButton } from "@/components/shared/TopicSuggestButton"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { isApiError } from "@/types/api"
import Link from "next/link"

// ─── Schedule to Instagram/Facebook ──────────────────────────────────────────

interface ConnectionStatus {
  connected: boolean
  facebook_connected: boolean
  instagram_connected: boolean
  threads_connected: boolean
  pinterest_connected: boolean
  linkedin_connected: boolean
  twitter_connected: boolean
}

function ScheduleAction({
  brandId,
  elementId,
  caption,
  hashtags,
  imageUrl,
}: {
  brandId: string
  elementId: string
  caption: string
  hashtags: string[]
  imageUrl?: string
}) {
  const [open, setOpen] = useState(false)
  const [connection, setConnection] = useState<ConnectionStatus | null>(null)
  const [checkingConnection, setCheckingConnection] = useState(false)
  const [connectionError, setConnectionError] = useState(false)
  const [platform, setPlatform] = useState<"instagram" | "facebook" | "threads" | "pinterest" | "linkedin" | "twitter">("instagram")
  const [date, setDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return d.toISOString().split("T")[0]
  })
  const [time, setTime] = useState("10:00")
  const [submitState, setSubmitState] = useState<"idle" | "loading" | "success" | "error">("idle")
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
        setPlatform(data.instagram_connected ? "instagram" : data.facebook_connected ? "facebook" : data.threads_connected ? "threads" : data.pinterest_connected ? "pinterest" : data.linkedin_connected ? "linkedin" : "twitter")
      } else {
        setConnectionError(true)
      }
    } catch {
      setConnectionError(true)
    } finally {
      setCheckingConnection(false)
    }
  }, [brandId])

  const openPanel = useCallback(() => {
    setOpen(true)
    if (!connection && !checkingConnection) checkConnection()
  }, [connection, checkingConnection, checkConnection])

  const closePanel = useCallback(() => {
    setOpen(false)
    setSubmitState("idle")
    setErrorMsg(null)
    setSuccessInfo(null)
  }, [])

  const handleConfirm = useCallback(async () => {
    setSubmitState("loading")
    setErrorMsg(null)

    // Prefer the already-hosted meme image; only fall back to capturing the
    // DOM element as a data URL if no hosted image URL was provided.
    const resolvedImageUrl = imageUrl ?? (await captureElementAsDataUrl(elementId))
    if (!resolvedImageUrl) {
      setErrorMsg("Couldn't capture the meme image. Please try again.")
      setSubmitState("error")
      return
    }

    try {
      const res = await fetch("/api/v1/calendar/schedule-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          platform,
          imageUrl: resolvedImageUrl,
          caption,
          hashtags: hashtags.map((h) => h.replace(/^#+/, "")),
          scheduledDate: date,
          scheduledTime: time,
        }),
      })
      const json: unknown = await res.json()
      if (!res.ok || isApiError(json)) {
        const msg = isApiError(json) ? json.error.message : "Failed to schedule post."
        setErrorMsg(msg)
        setSubmitState("error")
        return
      }
      setSuccessInfo({ platform, date, time })
      setSubmitState("success")
    } catch {
      setErrorMsg("Network error. Please try again.")
      setSubmitState("error")
    }
  }, [brandId, platform, elementId, imageUrl, caption, hashtags, date, time])

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={openPanel} className="flex items-center gap-1.5">
        <CalendarClock className="h-3.5 w-3.5" /> Schedule to Instagram/Facebook
      </Button>
    )
  }

  // Only ever show platforms that are actually connected — never a disabled
  // button for one that isn't.
  const connectedPlatforms: { id: "instagram" | "facebook" | "threads" | "pinterest" | "linkedin" | "twitter"; label: string }[] = connection
    ? [
        ...(connection.instagram_connected ? [{ id: "instagram" as const, label: "Instagram" }] : []),
        ...(connection.facebook_connected ? [{ id: "facebook" as const, label: "Facebook" }] : []),
        ...(connection.threads_connected ? [{ id: "threads" as const, label: "Threads" }] : []),
        ...(connection.pinterest_connected ? [{ id: "pinterest" as const, label: "Pinterest" }] : []),
        ...(connection.linkedin_connected ? [{ id: "linkedin" as const, label: "LinkedIn" }] : []),
        ...(connection.twitter_connected ? [{ id: "twitter" as const, label: "Twitter / X" }] : []),
      ]
    : []

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Schedule post</span>
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

      {!checkingConnection && !connectionError && connection && (!connection.connected || connectedPlatforms.length === 0) && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-1.5">
          <p className="text-sm text-amber-900">Connect Instagram or Facebook first to schedule posts.</p>
          <Link
            href={`/brands/${brandId}`}
            className="text-xs font-semibold text-amber-700 underline underline-offset-2 hover:text-amber-900"
          >
            Go to brand settings →
          </Link>
        </div>
      )}

      {!checkingConnection && !connectionError && connection?.connected && connectedPlatforms.length > 0 && submitState !== "success" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Platform</Label>
            <div className="flex gap-1.5">
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Time</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>

          <Button size="sm" className="w-full" onClick={handleConfirm} disabled={submitState === "loading"}>
            {submitState === "loading" ? "Scheduling…" : "Confirm schedule"}
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
            Scheduled for {successInfo.platform === "instagram" ? "Instagram" : successInfo.platform === "threads" ? "Threads" : successInfo.platform === "pinterest" ? "Pinterest" : successInfo.platform === "linkedin" ? "LinkedIn" : successInfo.platform === "twitter" ? "Twitter / X" : "Facebook"} on {successInfo.date} at {successInfo.time}
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function MemeMaker({ brandId }: { brandId: string }) {
  const STORAGE_KEY = `meme_${brandId}`
  const [idea, setIdea] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [apiError, setApiError] = useState("")
  const [meme, setMeme] = useState<MemeResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [showStaleCue, setShowStaleCue] = useState(false)
  const prevMemeRef = useRef<MemeResult | null>(null)

  // Restore from sessionStorage
  useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { result?: MemeResult }
        if (parsed.result) setMeme(parsed.result)
      } catch {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId])

  // Persist to sessionStorage
  useEffect(() => {
    if (meme) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ result: meme }))
    }
  }, [meme, STORAGE_KEY])

  async function generate() {
    if (!idea.trim()) { setError("Please describe what the meme is about."); return }
    const hadPrevMeme = meme !== null
    prevMemeRef.current = meme
    setLoading(true)
    setError("")
    setApiError("")
    setShowStaleCue(false)
    setMeme(null)
    try {
      const res = await fetch("/api/v1/ai/meme/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, idea: idea.trim() }),
      })
      const json = await res.json() as { data?: MemeResult; error?: { message?: string } }
      if (!res.ok || !json.data) throw new Error(json.error?.message ?? "Generation failed")
      setMeme(json.data)
      setShowSuccess(true)
      setTimeout(() => setShowSuccess(false), 4000)
    } catch (e) {
      setApiError(getFriendlyError(e))
      if (hadPrevMeme && prevMemeRef.current) {
        setMeme(prevMemeRef.current)
        setShowStaleCue(true)
      }
    } finally {
      setLoading(false)
    }
  }

  function copyMemeText() {
    if (!meme) return
    const text = `${meme.caption}\n\n${meme.hashtags.map((h) => `#${h.replace(/^#+/, "")}`).join(" ")}`
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {/* Header */}
        <div>
          <h3 className="text-sm font-semibold">Make a brand meme 😂</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Memes get 3× more shares than regular posts</p>
        </div>

        {/* Idea input */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Describe your meme idea</p>
          <textarea
            rows={2}
            value={idea}
            onChange={(e) => { setIdea(e.target.value); setError("") }}
            placeholder="The struggle of finding matching size in every store"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
          {error && (
            <div className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5" /> {error}
            </div>
          )}
          <TopicSuggestButton
            brandId={brandId}
            contentType="meme"
            currentInput={idea}
            onSelectTopic={(t) => { setIdea(t); setError("") }}
          />
        </div>

        <GenerationWarning isPending={loading} />
        <button onClick={generate} disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 py-3 text-sm font-semibold text-white shadow-md transition hover:from-violet-700 hover:to-indigo-700 disabled:opacity-60">
          {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating meme…</> : "✨ Generate meme"}
        </button>

        {apiError && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-3">
            <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-amber-900 font-medium">{apiError}</p>
              <button onClick={generate} className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-amber-700 hover:text-amber-900">
                🔄 Try again
              </button>
            </div>
          </div>
        )}
        {showStaleCue && meme !== null && (
          <p className="text-xs text-amber-600">Showing your last successful result below.</p>
        )}
      </div>

      {/* Result */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-10 gap-3 rounded-xl border bg-card">
          <Loader2 className="h-7 w-7 animate-spin text-violet-500" />
          <p className="text-sm text-muted-foreground">Generating your brand meme…</p>
        </div>
      )}

      {showSuccess && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 animate-in fade-in duration-300">
          <Check className="h-4 w-4 text-green-500 shrink-0" />
          <span className="text-sm font-medium text-green-700">✓ Generated successfully — scroll down to see your content</span>
        </div>
      )}

      {meme && !loading && (
        <div className="rounded-xl border bg-card p-4 space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your meme</p>

          {/* Meme visual */}
          <img id="meme-result" src={meme.image_url} alt="Generated meme" className="w-full max-w-md mx-auto rounded-lg border" />

          {/* Caption */}
          <div className="rounded-lg bg-muted/50 p-3 space-y-1">
            <p className="text-xs font-semibold text-muted-foreground">Caption</p>
            <p className="text-sm leading-relaxed">{meme.caption}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {meme.hashtags.map((h) => `#${h.replace(/^#+/, "")}`).join(" ")}
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <button onClick={copyMemeText}
              className="flex items-center gap-1.5 rounded-full border border-input px-4 py-2 text-xs font-medium hover:bg-secondary">
              {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              Copy meme text
            </button>
            <a href={meme.image_url} download="brand-meme.png"
              className="flex items-center gap-1.5 rounded-full border border-input px-4 py-2 text-xs font-medium hover:bg-secondary">
              <Image className="h-3.5 w-3.5" /> Save as PNG
            </a>
            <button onClick={generate} disabled={loading}
              className="flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-4 py-2 text-xs font-medium text-violet-700 hover:bg-violet-100">
              <RefreshCw className="h-3.5 w-3.5" /> Regenerate
            </button>
          </div>

          <ScheduleAction
            brandId={brandId}
            elementId="meme-result"
            caption={meme.caption}
            hashtags={meme.hashtags}
            imageUrl={meme.image_url}
          />
        </div>
      )}
    </div>
  )
}
