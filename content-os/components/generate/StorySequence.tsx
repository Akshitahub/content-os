"use client"

import { useState, useEffect, useRef } from "react"
import { Loader2, Download, Copy, Check, RefreshCw, AlertCircle, Image, Upload, X, Plus, Minus, Palette } from "lucide-react"
import { ProductPicker, type PickedProduct } from "@/components/shared/ProductPicker"
import type { StorySlide, StoryCaption } from "@/app/api/v1/ai/stories/generate/route"
import { downloadElementAsImage, downloadMultipleAsImages } from "@/lib/utils/download-as-image"
import { GenerationWarning } from "@/components/shared/GenerationWarning"
import { getFriendlyError } from "@/lib/utils/error-messages"
import { TopicSuggestButton } from "@/components/shared/TopicSuggestButton"
import { ScheduleAction } from "@/components/shared/ScheduleAction"
import { isApiError } from "@/types/api"
import { ApiResponseError } from "@/hooks/useGeneration"
import { STORY as STORY_CREDIT_COST } from "@/lib/usage/credit-costs"
import { VibePicker, type Vibe } from "@/components/shared/VibePicker"
import { cssBackgroundFromColors } from "@/components/shared/ColorWheelPicker"
import Link from "next/link"

// ─── Story background gradients ────────────────────────────────────────────────

const STORY_BG: Record<string, { bg: string; text: string; sub: string }> = {
  gradient_violet: { bg: "bg-gradient-to-b from-violet-600 via-purple-600 to-indigo-700", text: "text-white", sub: "text-white/70" },
  gradient_pink:   { bg: "bg-gradient-to-b from-pink-500 via-rose-500 to-red-500", text: "text-white", sub: "text-white/70" },
  gradient_dark:   { bg: "bg-gradient-to-b from-gray-900 via-gray-800 to-black", text: "text-white", sub: "text-white/60" },
  gradient_warm:   { bg: "bg-gradient-to-b from-amber-400 via-orange-500 to-red-600", text: "text-white", sub: "text-white/70" },
  white:           { bg: "bg-white border border-gray-200", text: "text-gray-900", sub: "text-gray-500" },
  // Vibe-specific flat backgrounds — see VIBE_TO_STORY_BACKGROUND in
  // app/api/v1/ai/stories/generate/route.ts, which assigns these
  // deterministically from the selected vibe (clean_minimal/bold_dramatic/
  // warm_cozy reuse the keys above; these three vibes had no matching
  // pre-existing key).
  vibe_fun_playful:   { bg: "bg-gradient-to-b from-orange-400 via-yellow-400 to-teal-400", text: "text-white", sub: "text-white/70" },
  vibe_professional:  { bg: "bg-gradient-to-b from-blue-900 via-slate-800 to-gray-900", text: "text-white", sub: "text-white/70" },
  vibe_trendy_genz:   { bg: "bg-gradient-to-b from-violet-500 via-fuchsia-500 to-cyan-400", text: "text-white", sub: "text-white/80" },
}

// Curated preset swatches offered by the inline color picker below — the
// same 5 flat backgrounds StorySequence can already render, just exposed
// as a tap target. Picking one is a local re-composite only: it swaps
// `background` and drops any AI `background_image_url` so the flat color
// actually shows, with no new generation call.
const STORY_BG_PRESETS: { key: string; swatch: string; label: string }[] = [
  { key: "gradient_violet", swatch: "bg-gradient-to-b from-violet-600 to-indigo-700", label: "Violet" },
  { key: "gradient_pink", swatch: "bg-gradient-to-b from-pink-500 to-red-500", label: "Pink" },
  { key: "gradient_dark", swatch: "bg-gradient-to-b from-gray-900 to-black", label: "Dark" },
  { key: "gradient_warm", swatch: "bg-gradient-to-b from-amber-400 to-red-600", label: "Warm" },
  { key: "white", swatch: "bg-white border border-gray-300", label: "White" },
]

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

// Best-effort AI background fetch for a single hook/cta story slide — never
// throws, resolves to null (falls back to the existing flat gradient) on
// any HTTP error or network failure. Available to every plan, no tiering.
// Confirmed live (2026-08-28): this call never sent `vibe` at all, so the
// generated background image always ignored whichever vibe was selected —
// unlike CarouselBuilder.tsx's equivalent call, which already sent it.
async function fetchSlideBackground(brandId: string, text: string, vibe: Vibe | undefined, role: "hook" | "cta"): Promise<string | null> {
  try {
    const res = await fetch("/api/v1/ai/stories/slide-image/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brandId, text, vibe, role }),
    })
    if (!res.ok) return null
    const json = await res.json() as { data?: { public_url?: string } }
    return json.data?.public_url ?? null
  } catch {
    return null
  }
}

// ─── Phone frame story card ────────────────────────────────────────────────────

function PhoneStory({
  story,
  index,
  total,
  uploadedImage,
  onUpdateSlide,
}: {
  story: StorySlide
  index: number
  total: number
  uploadedImage?: string
  onUpdateSlide: (updates: Partial<StorySlide>) => void
}) {
  const [copied, setCopied] = useState(false)
  const [dlErr, setDlErr] = useState(false)
  const [showColors, setShowColors] = useState(false)
  const s = STORY_BG[story.background] ?? STORY_BG.gradient_violet
  const elementId = `story-card-${index}`
  const hasBg = !!story.background_image_url
  // "Custom color" mode (see VibePicker/ColorWheelPicker in the main
  // component below) -- an exact user pick, takes priority over the
  // named `background` enum but never over a real AI photo (the two
  // can't coexist today anyway: picking Custom color skips AI background
  // generation entirely, see generate()).
  const customBg = !hasBg ? cssBackgroundFromColors(story.custom_background_colors) : undefined

  // contentEditable is inherently uncontrolled — commit on blur only
  // (never on every keystroke) so the cursor never jumps mid-typing.
  // Enter commits instead of inserting a newline, since both fields are
  // meant to stay short single-line copy.
  function commitEdit(field: "text" | "subtext", e: React.FocusEvent<HTMLParagraphElement>) {
    const value = e.currentTarget.innerText.trim()
    if (field === "text" && !value) {
      e.currentTarget.innerText = story.text
      return
    }
    if (value !== story[field]) onUpdateSlide({ [field]: value })
  }
  function commitOnEnter(e: React.KeyboardEvent<HTMLParagraphElement>) {
    if (e.key === "Enter") {
      e.preventDefault()
      e.currentTarget.blur()
    }
  }
  // A photo or custom color background's own contrast can't be predicted
  // the way the flat STORY_BG swatches can, so text always goes
  // white-on-scrim instead of following the slide's normal light/dark
  // text pairing.
  const textColor = hasBg || customBg ? "text-white" : s.text
  const subColor = hasBg || customBg ? "text-white/70" : s.sub

  const posClass =
    story.text_position === "top" ? "justify-start" :
    story.text_position === "bottom" ? "justify-end" :
    "justify-center"

  // Instagram's Stories UI overlays the top (profile/username) and bottom
  // (reply bar, link stickers) of the real 1080x1920 canvas — standard
  // guidance keeps text within the central ~1420px band, i.e. clear of the
  // outer ~250px top and bottom. This preview's phone frame is a fixed
  // 220x390px mock (the same element html-to-image captures for
  // download/schedule), so the same 250/1920 ratio scaled to 390px height
  // is applied as a hard inset — independent of text_position, which only
  // controls alignment within this already-safe interior.
  const STORY_SAFE_ZONE_PX = Math.round(390 * (250 / 1920))

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
          Story {index + 1}: {story.type}
        </span>
      </div>

      {/* Phone frame */}
      <div
        id={elementId}
        className="relative overflow-hidden rounded-[28px] border-[5px] border-gray-900 shadow-2xl"
        style={{ width: 220, height: 390 }}
      >
        <div
          className={`flex h-full flex-col relative bg-cover bg-center ${hasBg || customBg ? "" : s.bg}`}
          style={hasBg ? { backgroundImage: `url(${story.background_image_url})` } : customBg ? { background: customBg } : undefined}
        >
          {/* Dark scrim so text stays readable over an AI-generated or
           * custom color/gradient background. */}
          {(hasBg || customBg) && (
            <div className="absolute inset-0 z-0 bg-gradient-to-t from-black/75 via-black/25 to-black/45" />
          )}

          {/* buildStoryTypeSequence() only produces a "reveal" slide when
              storyCount >= 3, so gating solely on "reveal" silently drops
              the uploaded product photo for 1- and 2-slide sequences.
              "cta" always exists whenever storyCount >= 2, and for a
              single-slide sequence ("hook" only) that hook slide is the
              fallback, so the image is guaranteed to show up somewhere. */}
          {(story.type === "reveal" || story.type === "cta" || (total === 1 && story.type === "hook")) && uploadedImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={uploadedImage} alt="" crossOrigin="anonymous" className="absolute inset-0 z-10 h-full w-full object-contain" style={{ background: "rgba(0,0,0,0.35)" }} />
          )}
          {/* No progress bars or handle row here on purpose — if this
              design gets scheduled and posted as a real Instagram Story,
              Instagram's own interface already renders the account's real
              handle and its own real progress bar natively. Baking fake
              versions into the image would double them up once actually
              live. Not a style preference — avoids a real duplicate-UI bug
              at publish time. */}

          {/* Main content */}
          <div
            className={`relative z-10 flex flex-1 flex-col items-center px-4 ${posClass}`}
            style={{ paddingTop: STORY_SAFE_ZONE_PX, paddingBottom: STORY_SAFE_ZONE_PX }}
          >
            <p
              contentEditable
              suppressContentEditableWarning
              onBlur={(e) => commitEdit("text", e)}
              onKeyDown={commitOnEnter}
              className={`text-center text-lg font-black leading-tight outline-none rounded px-1 -mx-1 cursor-text hover:bg-white/10 focus:bg-white/10 focus:ring-1 focus:ring-white/40 ${textColor}`}
            >
              {story.text}
            </p>
            <p
              contentEditable
              suppressContentEditableWarning
              onBlur={(e) => commitEdit("subtext", e)}
              onKeyDown={commitOnEnter}
              className={`mt-2 text-center text-xs font-medium outline-none rounded px-1 -mx-1 cursor-text hover:bg-white/10 focus:bg-white/10 focus:ring-1 focus:ring-white/40 min-h-[1em] ${subColor}`}
            >
              {story.subtext}
            </p>

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
            <p className={`relative z-10 pb-3 text-center text-[9px] ${subColor}`}>Tap to continue →</p>
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
        <button onClick={() => setShowColors((v) => !v)}
          className={`flex items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-medium hover:bg-secondary ${showColors ? "border-violet-300 bg-violet-50 text-violet-700" : ""}`}>
          <Palette className="h-3 w-3" /> Color
        </button>
        <button onClick={async () => {
          setDlErr(false)
          const ok = await downloadElementAsImage(elementId, `story-${index + 1}`)
          if (!ok) setDlErr(true)
        }}
          className="flex items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-medium hover:bg-secondary">
          <Image className="h-3 w-3" /> PNG
        </button>
        {dlErr && <p className="text-[10px] text-destructive">Download failed</p>}
      </div>

      {/* Preset color/gradient swap — local re-composite only, no new
          generation call. Picking a swatch also drops any AI background
          image so the flat color actually becomes visible. */}
      {showColors && (
        <div className="flex items-center gap-1.5">
          {STORY_BG_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              title={preset.label}
              onClick={() => onUpdateSlide({ background: preset.key as StorySlide["background"], background_image_url: undefined, custom_background_colors: undefined })}
              className={`h-6 w-6 rounded-full ${preset.swatch} transition-transform hover:scale-110 ${story.background === preset.key && !hasBg && !customBg ? "ring-2 ring-offset-2 ring-violet-500" : ""}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function StorySequence({ brandId }: { brandId: string }) {
  const STORAGE_KEY = `stories_${brandId}`

  const [topic, setTopic] = useState("")
  const [storyCount, setStoryCount] = useState(3)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [apiError, setApiError] = useState<unknown>(null)
  const [stories, setStories] = useState<StorySlide[]>([])
  const [storyCaption, setStoryCaption] = useState<StoryCaption | null>(null)
  const [showCaptionEditor, setShowCaptionEditor] = useState(false)
  const [allCopied, setAllCopied] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [saveAllErr, setSaveAllErr] = useState(false)
  const [showStaleCue, setShowStaleCue] = useState(false)
  const prevStoriesRef = useRef<StorySlide[]>([])
  const [selectedProduct, setSelectedProduct] = useState<PickedProduct | null>(null)
  const [uploadedImages, setUploadedImages] = useState<{ preview: string; base64: string }[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Bumped on every generate() call — lets an in-flight background-image
  // fetch from a superseded generation detect it's stale and no-op instead
  // of writing its result onto a newer, unrelated set of stories.
  const generationIdRef = useRef(0)

  // Vibe (including "Custom color", the 7th option) -- this component
  // never exposed a Vibe picker at all before now (the AI text-generation
  // route already accepted an optional `vibe` param, just nothing here
  // ever sent one), so this brings it to parity with CarouselBuilder
  // rather than only adding Custom color with nothing for it to sit
  // "alongside" the way the task describes.
  const [vibe, setVibe] = useState<Vibe | undefined>()
  const [customColors, setCustomColors] = useState<string[]>([])

  // The saved stories row id -- needed by the debounced autosave effect
  // below, so lifted into state instead of staying a local `const` inside
  // generate() the way it was before this fix.
  const [storyRowId, setStoryRowId] = useState<string | null>(null)
  const lastPersistedStoriesRef = useRef<string | null>(null)
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")

  // Restore from sessionStorage
  useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { stories?: StorySlide[]; caption?: StoryCaption }
        if (parsed.stories && parsed.stories.length > 0) {
          setStories(parsed.stories)
          setStoryCaption(parsed.caption ?? null)
        }
      } catch {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId])

  // Persist to sessionStorage
  useEffect(() => {
    if (stories.length > 0) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ stories, caption: storyCaption }))
    }
  }, [stories, storyCaption, STORAGE_KEY])

  // Debounced autosave for slide edits made via updateSlide (inline text
  // edits, the existing preset color swap, and the new Custom color mode
  // alike) -- mirrors CarouselBuilder.tsx's identical fix for the same
  // underlying gap: this component's only PUT used to fire once, right
  // after the initial hook/cta background-image fetch, and any edit made
  // after that point was silently lost the moment the user navigated
  // away. See lastPersistedStoriesRef's declaration above for why this
  // doesn't also double-save right when the background-image PUT below
  // completes. 1.5s after the last edit, not on every keystroke.
  useEffect(() => {
    if (!storyRowId || stories.length === 0) return
    const serialized = JSON.stringify(stories)
    if (serialized === lastPersistedStoriesRef.current) return

    setAutosaveStatus("saving")
    const rowId = storyRowId
    const timer = setTimeout(() => {
      fetch(`/api/v1/brands/${brandId}/stories/${rowId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stories: JSON.parse(serialized) }),
      })
        .then((res) => {
          if (!res.ok) throw new Error("Save failed")
          lastPersistedStoriesRef.current = serialized
          setAutosaveStatus("saved")
          setTimeout(() => setAutosaveStatus((s) => (s === "saved" ? "idle" : s)), 2000)
        })
        .catch(() => setAutosaveStatus("error"))
    }, 1500)
    return () => clearTimeout(timer)
  }, [storyRowId, stories, brandId])

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
    const hadPrevStories = stories.length > 0
    prevStoriesRef.current = stories
    const genId = ++generationIdRef.current
    setLoading(true)
    setError("")
    setApiError(null)
    setShowStaleCue(false)
    setStories([])
    setStoryCaption(null)
    setShowCaptionEditor(false)
    setStoryRowId(null)
    // "custom_color" is a client-only rendering mode, never a real vibe
    // the text-generation prompt should see -- omitted from the request
    // entirely in that case rather than sent literally (same reasoning as
    // CarouselBuilder.tsx's identical guard).
    const isCustomColorMode = vibe === "custom_color"
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
          vibe: isCustomColorMode ? undefined : vibe,
        }),
      })
      const json = await res.json() as { data?: { id?: string | null; stories: StorySlide[]; caption?: StoryCaption }; error?: { code?: string; message?: string } }
      if (!res.ok || !json.data?.stories) {
        if (isApiError(json)) throw new ApiResponseError(json.error.code, json.error.message)
        throw new Error(json.error?.message ?? "Generation failed")
      }
      const savedStories = json.data.stories
      const rowId = json.data.id ?? null
      setStories(savedStories)
      setStoryRowId(rowId)
      // Already persisted -- the generate route's own insert wrote these
      // exact stories -- so the autosave effect above doesn't immediately
      // re-PUT the same data the instant this render commits.
      lastPersistedStoriesRef.current = JSON.stringify(savedStories)
      setStoryCaption(json.data.caption ?? null)
      setShowSuccess(true)
      setTimeout(() => setShowSuccess(false), 4000)

      if (isCustomColorMode) {
        // The whole point of Custom color is an instant, zero-AI-cost
        // background -- applied uniformly to every slide (hook, reveal,
        // buildup, and cta alike), not just hook/cta the way AI
        // backgrounds are scoped. Deliberately does NOT update
        // lastPersistedStoriesRef: these colors were never sent to
        // /api/v1/ai/stories/generate, so the debounced autosave effect
        // above needs to see this as a real, unsaved change and persist
        // it on its own -- no separate PUT needed here.
        const coloredStories = savedStories.map((s) => ({ ...s, custom_background_colors: customColors }))
        if (generationIdRef.current === genId) setStories(coloredStories)
      } else {
        // Best-effort AI backgrounds for hook/cta slides only (available to
        // every plan, no tiering) — fired after text succeeds so a slow/
        // failed image call never blocks or breaks story generation itself.
        // Waits for ALL of them to settle before writing anything back, one
        // PUT per generation instead of one per slide — fetchSlideBackground
        // never throws, so Promise.all here always resolves. Guarded by genId
        // so a stale response from a superseded generate() call can't write
        // onto a newer set of stories.
        const bgTargets = savedStories
          .map((slide, i) => ({ slide, i }))
          .filter((t): t is { slide: StorySlide & { type: "hook" | "cta" }; i: number } => t.slide.type === "hook" || t.slide.type === "cta")

        Promise.all(bgTargets.map(({ slide }) => fetchSlideBackground(brandId, slide.text, vibe, slide.type))).then((urls) => {
          if (generationIdRef.current !== genId) return
          if (!urls.some((u) => u)) return

          const updated = [...savedStories]
          bgTargets.forEach(({ i }, idx) => {
            const url = urls[idx]
            if (url) updated[i] = { ...updated[i]!, background_image_url: url }
          })
          setStories(updated)
          // Same reasoning as the generation-time assignment above -- this
          // PUT is about to persist exactly this stories array, so the
          // autosave effect shouldn't treat it as an unsaved edit too.
          lastPersistedStoriesRef.current = JSON.stringify(updated)

          if (rowId) {
            fetch(`/api/v1/brands/${brandId}/stories/${rowId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ stories: updated }),
            }).catch(() => {
              // Best-effort — the story sequence itself already generated
              // fine; a failed persist here just means the Library won't
              // show its images, not a user-facing generation failure.
            })
          }
        })
      }
    } catch (e) {
      setApiError(e)
      if (hadPrevStories && prevStoriesRef.current.length > 0) {
        setStories(prevStoriesRef.current)
        setShowStaleCue(true)
      }
    } finally {
      setLoading(false)
    }
  }

  // Backs both the inline text edit (contentEditable onBlur) and the color
  // swatch picker in PhoneStory — always a local state update, never a new
  // generation call. Round-trips through the existing sessionStorage
  // persistence effect above for free, same as any other stories change.
  function updateSlide(index: number, updates: Partial<StorySlide>) {
    setStories((prev) => {
      if (!prev[index]) return prev
      const next = [...prev]
      next[index] = { ...next[index]!, ...updates }
      return next
    })
  }

  function copyAllText() {
    const text = stories.map((s, i) => `Story ${i + 1} (${s.type}):\n${s.text}\n${s.subtext}`).join("\n\n---\n\n")
    navigator.clipboard.writeText(text)
    setAllCopied(true)
    setTimeout(() => setAllCopied(false), 1800)
  }

  function downloadAllText() {
    const lines = stories.map((s, i) =>
      `Story ${i + 1}: ${s.type.toUpperCase()}\n${"─".repeat(30)}\nMain text: ${s.text}\nSubtext: ${s.subtext}${s.has_poll && s.poll_options ? `\nPoll: ${s.poll_options.join(" | ")}` : ""}\n`
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
          <TopicSuggestButton
            brandId={brandId}
            contentType="story"
            currentInput={topic}
            onSelectTopic={(t) => { setTopic(t); setError("") }}
          />
        </div>

        {/* Product image */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium">Product image (optional)</label>
          <ProductPicker
            brandId={brandId}
            selected={selectedProduct}
            onSelect={setSelectedProduct}
            label="Select product image (shown on reveal/CTA slides)"
          />
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
          <p className="text-[11px] text-muted-foreground">Images will appear on &quot;reveal&quot; and &quot;cta&quot; slides (or the only slide, if just one)</p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium">Number of stories</label>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setStoryCount((n) => Math.max(1, n - 1))}
              disabled={storyCount <= 1}
              className="flex h-9 w-9 items-center justify-center rounded-lg border-2 border-border transition-all hover:border-violet-300 disabled:opacity-40 disabled:cursor-not-allowed">
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-8 text-center text-sm font-semibold">{storyCount}</span>
            <button type="button" onClick={() => setStoryCount((n) => Math.min(10, n + 1))}
              disabled={storyCount >= 10}
              className="flex h-9 w-9 items-center justify-center rounded-lg border-2 border-border transition-all hover:border-violet-300 disabled:opacity-40 disabled:cursor-not-allowed">
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium">Vibe</label>
          <VibePicker
            selected={vibe}
            onSelect={setVibe}
            compact
            customColors={customColors}
            onCustomColorsChange={setCustomColors}
          />
        </div>

        <GenerationWarning isPending={loading} />
        <button onClick={generate} disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 py-3 text-sm font-semibold text-white shadow-md transition hover:from-violet-700 hover:to-indigo-700 disabled:opacity-60">
          {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating stories…</> : "✨ Generate stories"}
        </button>

        {!!apiError && (
          apiError instanceof ApiResponseError && apiError.code === "USAGE_LIMIT_EXCEEDED" ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-50 p-3 text-center space-y-0.5">
              <p className="text-sm font-semibold text-amber-900">{apiError.message}</p>
              <p className="text-xs text-amber-700">Upgrade your plan to keep creating.</p>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-3">
              <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-amber-900 font-medium">{getFriendlyError(apiError)}</p>
                <button onClick={generate} className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-amber-700 hover:text-amber-900">
                  🔄 Try again
                </button>
              </div>
            </div>
          )
        )}
        {showStaleCue && stories.length > 0 && (
          <p className="text-xs text-amber-600">Showing your last successful result below.</p>
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
        <div className="flex items-center justify-between gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 animate-in fade-in duration-300">
          <div className="flex items-center gap-2 text-green-700">
            <Check className="h-4 w-4 shrink-0" />
            <span className="text-sm font-medium">✓ Story sequence generated and saved to My Content · {STORY_CREDIT_COST} credits used</span>
          </div>
          <Link
            href={`/brands/${brandId}/library?tab=stories`}
            className="text-xs font-medium text-green-700 underline underline-offset-2 hover:text-green-900 shrink-0"
          >
            View in My Content →
          </Link>
        </div>
      )}

      {/* Story previews */}
      {stories.length > 0 && !loading && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <p className="text-sm font-semibold">{stories.length} stories ready</p>
              {/* Subtle, not a toast -- edits (inline text, color swap,
               * Custom color) autosave 1.5s after the last change. */}
              {autosaveStatus === "saving" && <span className="text-xs text-muted-foreground">Saving…</span>}
              {autosaveStatus === "saved" && <span className="text-xs text-green-600">✓ Saved</span>}
              {autosaveStatus === "error" && <span className="text-xs text-destructive">Couldn&apos;t save — check your connection</span>}
            </div>
            <div className="flex gap-2">
              <button onClick={copyAllText}
                className="flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium hover:bg-secondary">
                {allCopied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                Copy all
              </button>
              <button onClick={async () => {
                setSaveAllErr(false)
                const ok = await downloadMultipleAsImages(stories.map((_, i) => `story-card-${i}`), "story-sequence")
                if (!ok) setSaveAllErr(true)
              }}
                className="flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium hover:bg-secondary">
                <Image className="h-3.5 w-3.5" /> Save all as PNG
              </button>
              {saveAllErr && <p className="text-[10px] text-destructive">Some downloads failed</p>}
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
                uploadedImage={selectedProduct?.imageUrl ?? uploadedImages[i]?.preview}
                onUpdateSlide={(updates) => updateSlide(i, updates)}
              />
            ))}
          </div>

          {storyCaption && (
            <div className="rounded-lg border bg-card p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Caption</p>
                <button
                  onClick={() => setShowCaptionEditor((v) => !v)}
                  className="text-xs font-medium text-violet-600 hover:underline"
                >
                  {showCaptionEditor ? "Hide editor" : "✏️ Edit caption"}
                </button>
              </div>
              {showCaptionEditor ? (
                <textarea
                  value={storyCaption.caption_text}
                  onChange={(e) => setStoryCaption({ ...storyCaption, caption_text: e.target.value })}
                  rows={5}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-y"
                />
              ) : (
                <p className="text-sm whitespace-pre-wrap text-foreground">{storyCaption.caption_text}</p>
              )}
              {storyCaption.hashtags.length > 0 && (
                <p className="text-xs text-primary">{storyCaption.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}</p>
              )}
            </div>
          )}

          <ScheduleAction
            brandId={brandId}
            slideElementIds={stories.map((_, i) => `story-card-${i}`)}
            contentFormat="story"
            itemLabel="story"
            caption={storyCaption?.caption_text || stories[0]?.text || ""}
            hashtags={storyCaption?.hashtags ?? []}
          />
        </div>
      )}
    </div>
  )
}
