"use client"

import { useState, useEffect, useRef } from "react"
import { Loader2, Download, Copy, Check, RefreshCw, AlertCircle, Image, Upload, X } from "lucide-react"
import { useBrand } from "@/hooks/useBrand"
import type { StorySlide } from "@/app/api/v1/ai/stories/generate/route"
import { downloadElementAsImage, downloadMultipleAsImages } from "@/lib/utils/download-as-image"
import { GenerationWarning } from "@/components/shared/GenerationWarning"
import { getFriendlyError } from "@/lib/utils/error-messages"

// ─── Story background gradients ────────────────────────────────────────────────

const STORY_BG: Record<string, { bg: string; text: string; sub: string }> = {
  gradient_violet: { bg: "bg-gradient-to-b from-violet-600 via-purple-600 to-indigo-700", text: "text-white", sub: "text-white/70" },
  gradient_pink:   { bg: "bg-gradient-to-b from-pink-500 via-rose-500 to-red-500", text: "text-white", sub: "text-white/70" },
  gradient_dark:   { bg: "bg-gradient-to-b from-gray-900 via-gray-800 to-black", text: "text-white", sub: "text-white/60" },
  gradient_warm:   { bg: "bg-gradient-to-b from-amber-400 via-orange-500 to-red-600", text: "text-white", sub: "text-white/70" },
  white:           { bg: "bg-white border border-gray-200", text: "text-gray-900", sub: "text-gray-500" },
}

// ─── TOPIC CHIPS ────────────────────────────────────────────────────────────────

const QUICK_TOPICS = [
  "New product launch",
  "Behind the scenes",
  "Before & after",
  "Day in my life",
  "How it's made",
  "Customer review",
  "Limited offer",
]

// ─── Phone frame story card ────────────────────────────────────────────────────

function PhoneStory({
  story,
  index,
  total,
  brandHandle,
  uploadedImage,
}: {
  story: StorySlide
  index: number
  total: number
  brandHandle: string
  uploadedImage?: string
}) {
  const [copied, setCopied] = useState(false)
  const s = STORY_BG[story.background] ?? STORY_BG.gradient_violet
  const elementId = `story-card-${index}`

  const posClass =
    story.text_position === "top" ? "justify-start pt-16" :
    story.text_position === "bottom" ? "justify-end pb-16" :
    "justify-center"

  function copyText() {
    navigator.clipboard.writeText(`${story.text}\n${story.subtext}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Type label */}
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Story {index + 1} — {story.type}
        </span>
      </div>

      {/* Phone frame */}
      <div
        id={elementId}
        className="relative overflow-hidden rounded-[28px] border-[5px] border-gray-900 shadow-2xl"
        style={{ width: 220, height: 390 }}
      >
        <div className={`flex h-full flex-col relative ${s.bg}`}>
          {story.type === "reveal" && uploadedImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={uploadedImage} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ opacity: 0.65 }} />
          )}
          {/* Story progress bars */}
          <div className="flex gap-0.5 px-3 pt-3">
            {Array.from({ length: total }, (_, i) => (
              <div key={i} className={`h-0.5 flex-1 rounded-full ${i <= index ? "bg-white" : "bg-white/30"}`} />
            ))}
          </div>

          {/* Handle at top */}
          <div className="flex items-center gap-1.5 px-3 py-2">
            <div className="h-5 w-5 rounded-full bg-white/20" />
            <span className={`text-[10px] font-semibold ${s.text}`}>
              {brandHandle || "yourbrand"}
            </span>
          </div>

          {/* Main content */}
          <div className={`flex flex-1 flex-col items-center px-4 ${posClass}`}>
            <p className={`text-center text-lg font-black leading-tight ${s.text}`}>
              {story.text}
            </p>
            {story.subtext && (
              <p className={`mt-2 text-center text-xs font-medium ${s.sub}`}>
                {story.subtext}
              </p>
            )}

            {/* Poll sticker */}
            {story.has_poll && story.poll_options && (
              <div className="mt-4 w-full rounded-xl bg-white/20 backdrop-blur-sm p-2 space-y-1.5">
                {story.poll_options.map((opt, i) => (
                  <div key={i} className="rounded-lg bg-white/80 px-3 py-1.5">
                    <span className="text-[10px] font-bold text-gray-900">{opt}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Tap to continue hint */}
          {index < total - 1 && (
            <p className={`pb-3 text-center text-[9px] ${s.sub}`}>Tap to continue →</p>
          )}
        </div>

        {/* Notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 h-4 w-16 rounded-b-xl bg-gray-900" />
      </div>

      {/* Actions */}
      <div className="flex gap-2 flex-wrap justify-center">
        <button onClick={copyText}
          className="flex items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-medium hover:bg-secondary">
          {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
          Copy
        </button>
        <button onClick={() => downloadElementAsImage(elementId, `story-${index + 1}`)}
          className="flex items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-medium hover:bg-secondary">
          <Image className="h-3 w-3" /> PNG
        </button>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function StorySequence({ brandId }: { brandId: string }) {
  const { data: brand } = useBrand(brandId)
  const STORAGE_KEY = `stories_${brandId}`

  const [topic, setTopic] = useState("")
  const [storyCount, setStoryCount] = useState(3)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [apiError, setApiError] = useState("")
  const [stories, setStories] = useState<StorySlide[]>([])
  const [allCopied, setAllCopied] = useState(false)
  const [savedToContent, setSavedToContent] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [uploadedImages, setUploadedImages] = useState<{ preview: string; base64: string }[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handle = brand?.instagram_handle ?? brand?.name ?? "yourbrand"

  // Restore from sessionStorage
  useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { stories?: StorySlide[] }
        if (parsed.stories && parsed.stories.length > 0) setStories(parsed.stories)
      } catch {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId])

  // Persist to sessionStorage
  useEffect(() => {
    if (stories.length > 0) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ stories }))
    }
  }, [stories, STORAGE_KEY])

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    files.slice(0, 3 - uploadedImages.length).forEach((file) => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const base64 = ev.target?.result as string
        setUploadedImages((prev) => [...prev, { preview: base64, base64 }].slice(0, 3))
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ""
  }

  function removeImage(idx: number) {
    setUploadedImages((prev) => prev.filter((_, i) => i !== idx))
  }

  async function generate() {
    if (!topic.trim()) { setError("Please enter a topic for your story sequence."); return }
    setLoading(true)
    setError("")
    setApiError("")
    setStories([])
    try {
      const res = await fetch("/api/v1/ai/stories/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          topic: topic.trim(),
          storyCount,
          hasUserImages: uploadedImages.length > 0,
          imageDescriptions: uploadedImages.map((_, i) => `User provided image ${i + 1}`),
        }),
      })
      const json = await res.json() as { data?: { stories: StorySlide[] }; error?: { message?: string } }
      if (!res.ok || !json.data?.stories) throw new Error(json.error?.message ?? "Generation failed")
      const savedStories = json.data.stories
      setStories(savedStories)
      setSavedToContent(false)
      setShowSuccess(true)
      setTimeout(() => setShowSuccess(false), 4000)
      // Save to DB (non-blocking, non-fatal)
      try {
        await fetch(`/api/v1/brands/${brandId}/reel-scripts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: savedStories.map((s, i) =>
              `Story ${i + 1} (${s.type}):\n${s.text}\n${s.subtext}`
            ).join("\n\n---\n\n"),
            platform: "instagram",
            title: `Story sequence: ${topic}`,
          }),
        })
        setSavedToContent(true)
        setTimeout(() => setSavedToContent(false), 4000)
      } catch {
        // Non-fatal — content is shown even if save fails
      }
    } catch (e) {
      setApiError(getFriendlyError(e))
    } finally {
      setLoading(false)
    }
  }

  function copyAllText() {
    const text = stories.map((s, i) => `Story ${i + 1} (${s.type}):\n${s.text}\n${s.subtext}`).join("\n\n---\n\n")
    navigator.clipboard.writeText(text)
    setAllCopied(true)
    setTimeout(() => setAllCopied(false), 1800)
  }

  function downloadAllText() {
    const lines = stories.map((s, i) =>
      `Story ${i + 1} — ${s.type.toUpperCase()}\n${"─".repeat(30)}\nMain text: ${s.text}\nSubtext: ${s.subtext}${s.has_poll && s.poll_options ? `\nPoll: ${s.poll_options.join(" | ")}` : ""}\n`
    )
    const blob = new Blob([lines.join("\n")], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a"); a.href = url; a.download = `story-sequence.txt`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* Settings */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold">Create a story sequence</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Tell a story across multiple connected slides</p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium">What&apos;s the story about?</label>
          {/* Quick chips */}
          <div className="flex flex-wrap gap-1.5 mb-2">
            {QUICK_TOPICS.map((t) => (
              <button key={t} type="button" onClick={() => { setTopic(t); setError("") }}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${topic === t ? "border-violet-500 bg-violet-50 text-violet-700" : "border-border hover:border-violet-300 text-muted-foreground"}`}>
                {t}
              </button>
            ))}
          </div>
          <textarea
            rows={2}
            value={topic}
            onChange={(e) => { setTopic(e.target.value); setError("") }}
            placeholder="Or describe your own story topic…"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
          {error && (
            <div className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5" /> {error}
            </div>
          )}
        </div>

        {/* Image upload zone */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium">Add your photos (optional, max 3)</label>
          <div className="flex items-center gap-2 flex-wrap">
            {uploadedImages.map((img, i) => (
              <div key={i} className="relative h-16 w-16 rounded-lg overflow-hidden border shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.preview} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeImage(i)}
                  className="absolute top-0.5 right-0.5 h-4 w-4 rounded-full bg-black/60 flex items-center justify-center"
                >
                  <X className="h-2.5 w-2.5 text-white" />
                </button>
              </div>
            ))}
            {uploadedImages.length < 3 && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="h-16 w-16 rounded-lg border-2 border-dashed flex items-center justify-center hover:border-violet-400 transition-colors shrink-0"
              >
                <Upload className="h-5 w-5 text-muted-foreground" />
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleImageUpload}
          />
          <p className="text-[11px] text-muted-foreground">Images will appear in &quot;reveal&quot; type story slides</p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium">Number of stories</label>
          <div className="flex gap-2">
            {[3, 4, 5].map((n) => (
              <button key={n} type="button" onClick={() => setStoryCount(n)}
                className={`flex-1 rounded-lg border-2 py-2 text-sm font-semibold transition-all ${storyCount === n ? "border-violet-500 bg-violet-50 text-violet-700" : "border-border hover:border-violet-300"}`}>
                {n}
              </button>
            ))}
          </div>
        </div>

        <GenerationWarning isPending={loading} />
        <button onClick={generate} disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 py-3 text-sm font-semibold text-white shadow-md transition hover:from-violet-700 hover:to-indigo-700 disabled:opacity-60">
          {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating stories…</> : "✨ Generate stories"}
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
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 rounded-xl border bg-card">
          <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
          <p className="text-sm font-medium">Writing your {storyCount}-part story sequence…</p>
        </div>
      )}

      {/* Success banner */}
      {showSuccess && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 animate-in fade-in duration-300">
          <Check className="h-4 w-4 text-green-500 shrink-0" />
          <span className="text-sm font-medium text-green-700">✓ Generated successfully — scroll down to see your content</span>
        </div>
      )}

      {/* Saved banner */}
      {savedToContent && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <Check className="h-4 w-4 shrink-0 text-green-600" />
          <span className="text-sm font-medium text-green-700">Saved to My Content ✓</span>
        </div>
      )}

      {/* Story previews */}
      {stories.length > 0 && !loading && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">{stories.length} stories ready</p>
            <div className="flex gap-2">
              <button onClick={copyAllText}
                className="flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium hover:bg-secondary">
                {allCopied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                Copy all
              </button>
              <button onClick={() => downloadMultipleAsImages(stories.map((_, i) => `story-card-${i}`), "story-sequence")}
                className="flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium hover:bg-secondary">
                <Image className="h-3.5 w-3.5" /> Save all as PNG
              </button>
              <button onClick={downloadAllText}
                className="flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium hover:bg-secondary">
                <Download className="h-3.5 w-3.5" /> Text file
              </button>
              <button onClick={generate} disabled={loading}
                className="flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100">
                <RefreshCw className="h-3.5 w-3.5" /> Regenerate
              </button>
            </div>
          </div>

          {/* Horizontal scroll of phone frames */}
          <div className="flex gap-6 overflow-x-auto pb-4">
            {stories.map((story, i) => (
              <PhoneStory
                key={i}
                story={story}
                index={i}
                total={stories.length}
                brandHandle={handle}
                uploadedImage={uploadedImages[i]?.preview}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
