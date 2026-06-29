"use client"

import { useState } from "react"
import { Loader2, Download, Copy, Check, RefreshCw, AlertCircle } from "lucide-react"
import { useBrand } from "@/hooks/useBrand"
import type { StorySlide } from "@/app/api/v1/ai/stories/generate/route"

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
}: {
  story: StorySlide
  index: number
  total: number
  brandHandle: string
}) {
  const [copied, setCopied] = useState(false)
  const s = STORY_BG[story.background] ?? STORY_BG.gradient_violet

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
        className="relative overflow-hidden rounded-[28px] border-[5px] border-gray-900 shadow-2xl"
        style={{ width: 220, height: 390 }}
      >
        <div className={`flex h-full flex-col ${s.bg}`}>
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
      <div className="flex gap-2">
        <button onClick={copyText}
          className="flex items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-medium hover:bg-secondary">
          {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
          Copy text
        </button>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function StorySequence({ brandId }: { brandId: string }) {
  const { data: brand } = useBrand(brandId)

  const [topic, setTopic] = useState("")
  const [storyCount, setStoryCount] = useState(3)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [stories, setStories] = useState<StorySlide[]>([])
  const [allCopied, setAllCopied] = useState(false)

  const handle = brand?.instagram_handle ?? brand?.name ?? "yourbrand"

  async function generate() {
    if (!topic.trim()) { setError("Please enter a topic for your story sequence."); return }
    setLoading(true)
    setError("")
    setStories([])
    try {
      const res = await fetch("/api/v1/ai/stories/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, topic: topic.trim(), storyCount }),
      })
      const json = await res.json() as { data?: { stories: StorySlide[] }; error?: { message?: string } }
      if (!res.ok || !json.data?.stories) throw new Error(json.error?.message ?? "Generation failed")
      setStories(json.data.stories)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong")
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

        <button onClick={generate} disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 py-3 text-sm font-semibold text-white shadow-md transition hover:from-violet-700 hover:to-indigo-700 disabled:opacity-60">
          {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating stories…</> : "✨ Generate stories"}
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 rounded-xl border bg-card">
          <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
          <p className="text-sm font-medium">Writing your {storyCount}-part story sequence…</p>
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
              <button onClick={downloadAllText}
                className="flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium hover:bg-secondary">
                <Download className="h-3.5 w-3.5" /> Download
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
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
