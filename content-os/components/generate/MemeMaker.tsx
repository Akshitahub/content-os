"use client"

import { useState } from "react"
import { Loader2, Copy, Check, RefreshCw, Download, AlertCircle } from "lucide-react"
import type { MemeFormat, MemeResult } from "@/app/api/v1/ai/meme/generate/route"

// ─── Meme format cards ─────────────────────────────────────────────────────────

const MEME_FORMATS: {
  id: MemeFormat
  emoji: string
  name: string
  desc: string
  placeholder: string
}[] = [
  { id: "drake",                emoji: "🤔", name: "Drake Yes/No",         desc: "Preference comparison",         placeholder: "What NOT to do vs what TO do with your brand" },
  { id: "big_brain",            emoji: "🧠", name: "Big Brain",            desc: "Escalating ideas",              placeholder: "The evolution of how people think about your product" },
  { id: "disaster_girl",        emoji: "😰", name: "Disaster Girl",        desc: "Chaos / before-after",          placeholder: "The common problem your brand solves" },
  { id: "this_is_fine",         emoji: "🔥", name: "This is Fine",         desc: "Relatable struggle",            placeholder: "Struggles your customers face before finding you" },
  { id: "giga_chad",            emoji: "💪", name: "Giga Chad",            desc: "Confidence flex",               placeholder: "The bold statement your brand stands for" },
  { id: "surprised_pikachu",    emoji: "😮", name: "Surprised Pikachu",    desc: "Unexpected result",             placeholder: "What happens when people try your product" },
  { id: "distracted_boyfriend", emoji: "😤", name: "Distracted Boyfriend", desc: "Classic comparison",            placeholder: "Old solution vs your brand vs customer's attention" },
  { id: "custom",               emoji: "✍️", name: "Custom Format",        desc: "Describe your own",             placeholder: "Describe the meme concept you have in mind" },
]

// ─── CSS meme layout renderers ────────────────────────────────────────────────

function DrakeLayout({ panels }: { panels: { label: string; text: string }[] }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-white">
      {panels.slice(0, 2).map((p, i) => (
        <div key={i} className={`flex items-center gap-4 p-4 ${i === 0 ? "border-b" : ""}`}>
          <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-lg text-3xl ${i === 0 ? "bg-red-100" : "bg-green-100"}`}>
            {i === 0 ? "😒" : "😊"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{p.label}</p>
            <p className="mt-0.5 text-sm font-bold text-gray-900 leading-snug">{p.text}</p>
          </div>
          <span className="text-2xl shrink-0">{i === 0 ? "❌" : "✅"}</span>
        </div>
      ))}
    </div>
  )
}

function BigBrainLayout({ panels }: { panels: { label: string; text: string }[] }) {
  const emojis = ["🧠", "🧠", "🧠✨", "🌌🧠"]
  const sizes = ["text-sm", "text-base font-semibold", "text-lg font-bold", "text-xl font-extrabold text-violet-600"]
  return (
    <div className="overflow-hidden rounded-xl border bg-white">
      {panels.map((p, i) => (
        <div key={i} className={`flex items-center gap-4 p-4 ${i < panels.length - 1 ? "border-b" : ""}`}
          style={{ background: `rgba(109,40,217,${i * 0.04})` }}>
          <div className="shrink-0 text-3xl">{emojis[i] ?? "🧠"}</div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{p.label}</p>
            <p className={`mt-0.5 leading-snug text-gray-900 ${sizes[i] ?? "text-sm"}`}>{p.text}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function DisasterLayout({ panels }: { panels: { label: string; text: string }[] }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-orange-50">
      {panels.slice(0, 2).map((p, i) => (
        <div key={i} className={`flex items-center gap-4 p-4 ${i === 0 ? "border-b border-orange-200" : ""}`}>
          <div className="text-4xl shrink-0">{i === 0 ? "😱" : "😈"}</div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{p.label}</p>
            <p className="mt-0.5 text-sm font-bold text-gray-900 leading-snug">{p.text}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function ThisIsFineLayout({ panels }: { panels: { label: string; text: string }[] }) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="bg-gradient-to-r from-orange-500 to-red-600 p-4 flex items-center gap-3">
        <span className="text-3xl">🔥</span>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-orange-100">{panels[0]?.label}</p>
          <p className="text-sm font-bold text-white leading-snug">{panels[0]?.text}</p>
        </div>
        <span className="text-3xl ml-auto">🔥</span>
      </div>
      {panels[1] && (
        <div className="bg-white p-4 flex items-center gap-3">
          <span className="text-3xl">😌</span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{panels[1].label}</p>
            <p className="text-sm font-bold text-gray-900 leading-snug">{panels[1].text}</p>
          </div>
        </div>
      )}
    </div>
  )
}

function GigaChadLayout({ panels }: { panels: { label: string; text: string }[] }) {
  return (
    <div className="overflow-hidden rounded-xl bg-gradient-to-br from-gray-900 to-black p-6 text-center">
      <div className="text-5xl mb-3">💪</div>
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">{panels[0]?.label}</p>
      <p className="text-xl font-black text-white leading-snug">{panels[0]?.text}</p>
    </div>
  )
}

function SurprisedLayout({ panels }: { panels: { label: string; text: string }[] }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-yellow-50">
      <div className="p-4 border-b border-yellow-200">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{panels[0]?.label}</p>
        <p className="mt-1 text-sm font-bold text-gray-900 leading-snug">{panels[0]?.text}</p>
      </div>
      <div className="p-4 flex items-center gap-3">
        <span className="text-4xl">😮</span>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{panels[1]?.label}</p>
          <p className="text-sm font-bold text-gray-900 leading-snug">{panels[1]?.text}</p>
        </div>
      </div>
    </div>
  )
}

function DistractedLayout({ panels }: { panels: { label: string; text: string }[] }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-white">
      <div className="grid grid-cols-3 divide-x">
        {panels.slice(0, 3).map((p, i) => (
          <div key={i} className={`p-3 text-center ${i === 1 ? "bg-red-50" : i === 2 ? "bg-green-50" : ""}`}>
            <div className="text-2xl mb-1.5">
              {i === 0 ? "👀" : i === 1 ? "🙄" : "😍"}
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">{p.label}</p>
            <p className="text-xs font-bold text-gray-900 leading-snug">{p.text}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function CustomLayout({ panels }: { panels: { label: string; text: string }[] }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {panels.map((p, i) => (
        <div key={i} className={`flex items-center gap-4 p-4 ${i < panels.length - 1 ? "border-b" : ""}`}>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700 font-bold text-sm">
            {i + 1}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{p.label}</p>
            <p className="mt-0.5 text-sm font-bold text-gray-900 leading-snug">{p.text}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function MemeDisplay({ meme, brandName }: { meme: MemeResult; brandName: string }) {
  const props = { panels: meme.panels }
  switch (meme.format) {
    case "drake":                return <DrakeLayout {...props} />
    case "big_brain":            return <BigBrainLayout {...props} />
    case "disaster_girl":        return <DisasterLayout {...props} />
    case "this_is_fine":         return <ThisIsFineLayout {...props} />
    case "giga_chad":            return <GigaChadLayout {...props} />
    case "surprised_pikachu":    return <SurprisedLayout {...props} />
    case "distracted_boyfriend": return <DistractedLayout {...props} />
    default:                     return <CustomLayout {...props} />
  }
  // brand watermark is shown below in parent
  void brandName
}

// ─── Main component ───────────────────────────────────────────────────────────

export function MemeMaker({ brandId }: { brandId: string }) {
  const [selectedFormat, setSelectedFormat] = useState<MemeFormat>("drake")
  const [context, setContext] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [meme, setMeme] = useState<MemeResult | null>(null)
  const [copied, setCopied] = useState(false)

  const activeFormat = MEME_FORMATS.find((f) => f.id === selectedFormat)!

  async function generate() {
    if (!context.trim()) { setError("Please describe what the meme is about."); return }
    setLoading(true)
    setError("")
    setMeme(null)
    try {
      const res = await fetch("/api/v1/ai/meme/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, format: selectedFormat, context: context.trim() }),
      })
      const json = await res.json() as { data?: MemeResult; error?: { message?: string } }
      if (!res.ok || !json.data) throw new Error(json.error?.message ?? "Generation failed")
      setMeme(json.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  function copyMemeText() {
    if (!meme) return
    const text = meme.panels.map((p) => `${p.label}: ${p.text}`).join("\n") + `\n\n${meme.caption}\n${meme.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}`
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  function downloadMemeText() {
    if (!meme) return
    const text = [
      `Meme Format: ${meme.format}`,
      "─".repeat(30),
      ...meme.panels.map((p) => `${p.label}:\n  ${p.text}`),
      "",
      `Caption: ${meme.caption}`,
      `Hashtags: ${meme.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}`,
    ].join("\n")
    const blob = new Blob([text], { type: "text/plain" })
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "brand-meme.txt"; a.click()
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {/* Header */}
        <div>
          <h3 className="text-sm font-semibold">Make a brand meme 😂</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Memes get 3× more shares than regular posts</p>
        </div>

        {/* Step 1: Format picker */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Step 1 — Pick a meme format</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {MEME_FORMATS.map((fmt) => (
              <button key={fmt.id} type="button" onClick={() => { setSelectedFormat(fmt.id); setMeme(null) }}
                className={`flex flex-col items-start gap-1 rounded-xl border-2 p-3 text-left transition-all hover:scale-[1.01] ${selectedFormat === fmt.id ? "border-violet-500 bg-violet-50" : "border-border hover:border-violet-300"}`}>
                <span className="text-xl">{fmt.emoji}</span>
                <p className="text-xs font-semibold leading-tight">{fmt.name}</p>
                <p className="text-[10px] text-muted-foreground leading-snug">{fmt.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Step 2: Context input */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Step 2 — What&apos;s the meme about?</p>
          <textarea
            rows={2}
            value={context}
            onChange={(e) => { setContext(e.target.value); setError("") }}
            placeholder={activeFormat.placeholder}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
          {error && (
            <div className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5" /> {error}
            </div>
          )}
        </div>

        <button onClick={generate} disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 py-3 text-sm font-semibold text-white shadow-md transition hover:from-violet-700 hover:to-indigo-700 disabled:opacity-60">
          {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating meme…</> : "✨ Generate meme text"}
        </button>
      </div>

      {/* Result */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-10 gap-3 rounded-xl border bg-card">
          <Loader2 className="h-7 w-7 animate-spin text-violet-500" />
          <p className="text-sm text-muted-foreground">Writing your brand meme…</p>
        </div>
      )}

      {meme && !loading && (
        <div className="rounded-xl border bg-card p-4 space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Step 3 — Your meme card</p>

          {/* Meme visual */}
          <MemeDisplay meme={meme} brandName="" />

          {/* Caption */}
          <div className="rounded-lg bg-muted/50 p-3 space-y-1">
            <p className="text-xs font-semibold text-muted-foreground">Caption</p>
            <p className="text-sm leading-relaxed">{meme.caption}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {meme.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <button onClick={copyMemeText}
              className="flex items-center gap-1.5 rounded-full border border-input px-4 py-2 text-xs font-medium hover:bg-secondary">
              {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              Copy meme text
            </button>
            <button onClick={downloadMemeText}
              className="flex items-center gap-1.5 rounded-full border border-input px-4 py-2 text-xs font-medium hover:bg-secondary">
              <Download className="h-3.5 w-3.5" /> Download
            </button>
            <button onClick={generate} disabled={loading}
              className="flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-4 py-2 text-xs font-medium text-violet-700 hover:bg-violet-100">
              <RefreshCw className="h-3.5 w-3.5" /> Regenerate
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
