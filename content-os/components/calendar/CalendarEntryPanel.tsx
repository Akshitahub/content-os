"use client"

import { useState, useEffect, useCallback } from "react"
import { X, Copy, Check, Download, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { CalendarEntryRow } from "@/types/database"

const PLATFORM_COLORS: Record<string, string> = {
  instagram: "bg-pink-100 text-pink-700",
  tiktok: "bg-slate-900 text-white",
  facebook: "bg-blue-100 text-blue-700",
  youtube: "bg-red-100 text-red-700",
  linkedin: "bg-blue-700 text-white",
  twitter: "bg-sky-100 text-sky-700",
}

const STATUS_STYLES: Record<string, string> = {
  planned: "bg-slate-100 text-slate-700",
  content_ready: "bg-blue-100 text-blue-700",
  scheduled: "bg-purple-100 text-purple-700",
  published: "bg-green-100 text-green-700",
  missed: "bg-red-100 text-red-700",
}

interface CalendarEntryPanelProps {
  entry: CalendarEntryRow | null
  onClose: () => void
  onUpdate: (updated: CalendarEntryRow) => void
}

function CopyButton({ getText, label }: { getText: () => string; label?: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(getText())
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard not available
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
      {label ?? "Copy"}
    </button>
  )
}

export function CalendarEntryPanel({ entry, onClose, onUpdate }: CalendarEntryPanelProps) {
  const [isMarkingPublished, setIsMarkingPublished] = useState(false)
  const [showPublishedBanner, setShowPublishedBanner] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editCaption, setEditCaption] = useState("")
  const [editHashtags, setEditHashtags] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (entry) {
      setEditCaption(entry.caption_text ?? "")
      setEditHashtags((entry.hashtags ?? []).join(" "))
      setIsEditing(false)
    }
  }, [entry])

  const handleClose = useCallback(() => {
    setIsEditing(false)
    onClose()
  }, [onClose])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose()
    }
    if (entry) document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [entry, handleClose])

  async function markPublished() {
    if (!entry) return
    setIsMarkingPublished(true)
    try {
      const res = await fetch("/api/v1/calendar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry.id, status: "published" }),
      })
      if (res.ok) {
        onUpdate({ ...entry, status: "published" })
        setShowPublishedBanner(true)
        setTimeout(() => setShowPublishedBanner(false), 4000)
      }
    } finally {
      setIsMarkingPublished(false)
    }
  }

  async function saveEdit() {
    if (!entry) return
    setIsSaving(true)
    const newHashtags = editHashtags
      .split(/[\s,]+/)
      .map(h => h.replace(/^#/, "").trim())
      .filter(Boolean)
    try {
      const res = await fetch("/api/v1/calendar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry.id, caption_text: editCaption, hashtags: newHashtags }),
      })
      if (res.ok) {
        onUpdate({ ...entry, caption_text: editCaption, hashtags: newHashtags })
        setIsEditing(false)
      }
    } finally {
      setIsSaving(false)
    }
  }

  function buildInstagramCopy(): string {
    if (!entry) return ""
    const tags = (entry.hashtags ?? []).map(h => `#${h}`).join(" ")
    return [entry.caption_text, tags].filter(Boolean).join("\n\n")
  }

  function buildLinkedInCopy(): string {
    return entry?.caption_text ?? ""
  }

  function buildTwitterCopy(): string {
    return (entry?.caption_text ?? "").slice(0, 280)
  }

  return (
    <>
      {/* Backdrop — mobile only */}
      {entry && (
        <div
          className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm lg:hidden"
          onClick={handleClose}
        />
      )}

      {/* Slide-out panel */}
      <div
        className={`fixed right-0 top-0 z-50 h-full w-full max-w-[420px] overflow-hidden border-l bg-card shadow-2xl transition-transform duration-300 ease-in-out ${
          entry ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {entry && (
          <div className="flex h-full flex-col">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b p-5 shrink-0">
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  {entry.platform && (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${PLATFORM_COLORS[entry.platform] ?? "bg-slate-100 text-slate-700"}`}>
                      {entry.platform}
                    </span>
                  )}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[entry.status] ?? STATUS_STYLES.planned}`}>
                    {entry.status.replace("_", " ")}
                  </span>
                  {entry.is_ready && (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                      Ready
                    </span>
                  )}
                </div>
                <h3 className="font-semibold leading-snug">{entry.title}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{entry.scheduled_date}</p>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={handleClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* AI image or carousel preview */}
              {(() => {
                const platformData = entry.platform_specific_data as Record<string, unknown> | null
                const imageUrl = typeof platformData?.image_url === "string" ? platformData.image_url : null
                const carouselHtml = typeof platformData?.carousel_html === "string" ? platformData.carousel_html : null

                if (imageUrl) {
                  return (
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI Image</p>
                        <a
                          href={imageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        >
                          <ExternalLink className="h-3 w-3" /> View full size
                        </a>
                      </div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={imageUrl}
                        alt="AI generated post image"
                        width={300}
                        height={300}
                        className="rounded-lg border object-cover"
                        style={{ width: 300, height: 300 }}
                      />
                    </div>
                  )
                }

                if (carouselHtml) {
                  return (
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Carousel Preview</p>
                        <button
                          type="button"
                          onClick={() => {
                            const blob = new Blob([carouselHtml], { type: "text/html" })
                            const url = URL.createObjectURL(blob)
                            const a = document.createElement("a")
                            a.href = url
                            a.download = "carousel.html"
                            a.click()
                            URL.revokeObjectURL(url)
                          }}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        >
                          <Download className="h-3 w-3" /> Download graphic
                        </button>
                      </div>
                      <div
                        style={{ width: 300, height: 300, overflow: "hidden", borderRadius: 8, border: "1px solid hsl(var(--border))", flexShrink: 0 }}
                      >
                        <iframe
                          srcDoc={carouselHtml}
                          sandbox="allow-same-origin"
                          title="Carousel preview"
                          style={{
                            width: 1080,
                            height: 1080,
                            border: "none",
                            transform: "scale(0.278)",
                            transformOrigin: "top left",
                          }}
                        />
                      </div>
                    </div>
                  )
                }

                return null
              })()}

              {/* Hook */}
              {entry.hook_text && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hook</p>
                    <CopyButton getText={() => entry.hook_text ?? ""} />
                  </div>
                  <p className="text-sm font-semibold leading-relaxed">{entry.hook_text}</p>
                </div>
              )}

              {/* Caption */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Caption</p>
                  <div className="flex items-center gap-1">
                    {!isEditing && entry.caption_text && (
                      <CopyButton getText={() => entry.caption_text ?? ""} />
                    )}
                    <button
                      onClick={() => setIsEditing(v => !v)}
                      className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      {isEditing ? "Cancel" : "Edit"}
                    </button>
                  </div>
                </div>
                {isEditing ? (
                  <div className="space-y-2">
                    <textarea
                      rows={5}
                      value={editCaption}
                      onChange={e => setEditCaption(e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                    />
                    <div>
                      <p className="mb-1 text-xs text-muted-foreground">Hashtags (space or comma separated)</p>
                      <input
                        value={editHashtags}
                        onChange={e => setEditHashtags(e.target.value)}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        placeholder="#skincare #beauty"
                      />
                    </div>
                    <Button size="sm" onClick={saveEdit} disabled={isSaving}>
                      {isSaving ? "Saving…" : "Save"}
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm leading-relaxed text-foreground/90">
                    {entry.caption_text ?? (
                      <span className="italic text-muted-foreground">No caption generated</span>
                    )}
                  </p>
                )}
              </div>

              {/* Hashtags */}
              {!isEditing && entry.hashtags.length > 0 && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hashtags</p>
                    <CopyButton
                      getText={() => entry.hashtags.map(h => `#${h}`).join(" ")}
                      label="Copy all"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {entry.hashtags.map(tag => (
                      <button
                        key={tag}
                        className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-foreground/80 hover:bg-muted/60 transition-colors"
                        onClick={() => navigator.clipboard.writeText(`#${tag}`).catch(() => {})}
                        title={`Copy #${tag}`}
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Visual direction */}
              {entry.visual_direction && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Visual direction</p>
                  <p className="text-sm leading-relaxed text-foreground/80">{entry.visual_direction}</p>
                </div>
              )}

              {/* Audio suggestion */}
              {entry.audio_suggestion && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Audio / Music</p>
                  <p className="text-sm text-foreground/80">{entry.audio_suggestion}</p>
                </div>
              )}

              {/* Call to action */}
              {entry.notes && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Call to action</p>
                  <p className="text-sm text-foreground/80">{entry.notes}</p>
                </div>
              )}

              {/* Platform-specific copy */}
              <div className="rounded-lg border p-3 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Copy for platform</p>
                <div className="flex flex-wrap gap-2">
                  <CopyButton getText={buildInstagramCopy} label="Instagram" />
                  <CopyButton getText={buildLinkedInCopy} label="LinkedIn" />
                  <CopyButton getText={buildTwitterCopy} label="Twitter / X" />
                </div>
                <p className="text-xs text-muted-foreground pt-1">
                  Copy content and post manually. Auto-posting (coming soon).
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="shrink-0 border-t p-5 space-y-3">
              {showPublishedBanner && (
                <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2">
                  <Check className="h-4 w-4 text-green-500 shrink-0" />
                  <span className="text-sm font-medium text-green-700">✓ Marked as published</span>
                </div>
              )}
              {entry.status === "published" ? (
                <div className="flex items-center justify-center gap-2 text-sm font-medium text-green-600">
                  <Check className="h-4 w-4" /> Published
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground text-center">
                    Copy your content, post it manually, then click Published to mark it done.
                  </p>
                  <div className="flex gap-2">
                    <CopyButton
                      getText={buildInstagramCopy}
                      label="Copy content"
                    />
                    <Button className="flex-1" size="sm" onClick={markPublished} disabled={isMarkingPublished}>
                      {isMarkingPublished ? "Updating…" : "Mark as Published"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
