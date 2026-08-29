"use client"

import { useState, useEffect, useRef } from "react"
import { Loader2, Download, Copy, Check, RefreshCw, AlertCircle, Image, Upload, X, Plus, Minus, Palette, Move } from "lucide-react"
import { ProductPicker, type PickedProduct } from "@/components/shared/ProductPicker"
import type { StorySlide, StoryCaption } from "@/app/api/v1/ai/stories/generate/route"
import { downloadStorySlideAsImage, downloadStorySlidesAsImages, type StoryExportSlide } from "@/lib/utils/story-export"
import { GenerationWarning } from "@/components/shared/GenerationWarning"
import { getFriendlyError } from "@/lib/utils/error-messages"
import { TopicSuggestButton } from "@/components/shared/TopicSuggestButton"
import { ScheduleAction } from "@/components/shared/ScheduleAction"
import { isApiError } from "@/types/api"
import { ApiResponseError } from "@/hooks/useGeneration"
import { STORY as STORY_CREDIT_COST, STORY_SLIDE_AI_BACKGROUND } from "@/lib/usage/credit-costs"
import { VibePicker, type Vibe } from "@/components/shared/VibePicker"
import { cssBackgroundFromColors, ColorWheelPicker } from "@/components/shared/ColorWheelPicker"
import { useDraggableText, type TextPosition } from "@/components/shared/useDraggableText"
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

// Shared by the per-slide "PNG" button, "Save all as PNG", and
// ScheduleAction below — all three need the same slide data handed to the
// server-side compositor (lib/image/story-compositor.ts via
// lib/utils/story-export.ts), just for a different number of slides at a
// time. productImageSource is safe to always pass regardless of slide
// type — the compositor itself gates whether it's actually used (reveal/
// cta, or hook for a single-slide sequence), same as the live preview.
function toExportSlide(story: StorySlide, productImageSource: string | null | undefined): StoryExportSlide {
  return {
    type: story.type,
    text: story.text,
    subtext: story.subtext,
    background: story.background,
    text_position: story.text_position,
    has_poll: story.has_poll,
    poll_options: story.poll_options,
    background_image_url: story.background_image_url,
    custom_background_colors: story.custom_background_colors,
    productImageSource: productImageSource ?? null,
    text_position_x: story.text_position_x,
    text_position_y: story.text_position_y,
  }
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

// Deliberately doesn't send the slide's own text -- lib/ai/story-slide-
// background.ts no longer quotes it into the image prompt at all
// (confirmed live via the identical Carousel bug: doing so caused the
// model to render the text as real on-image text, which then visually
// duplicated the actual overlaid text in PhoneStory).
//
// "body" slides (reveal/buildup -- the opt-in "AI background for every
// slide" mode) spend real credits per call, unlike hook/cta -- so unlike
// the old swallow-everything version, a caller needs to tell "ran out of
// credits, stop asking for more" apart from "this one attempt failed, try
// the next slide anyway." fetchSlideBackgroundResult keeps that
// distinction; fetchSlideBackground wraps it back down to the simpler
// null-on-any-failure shape hook/cta (which are never credit-gated) have
// always used. Mirrors CarouselBuilder.tsx's identical pair exactly.
type SlideBackgroundResult = { url: string } | { error: "insufficient_credits" | "failed" }

async function fetchSlideBackgroundResult(brandId: string, vibe: Vibe | undefined, role: "hook" | "cta" | "body"): Promise<SlideBackgroundResult> {
  try {
    const res = await fetch("/api/v1/ai/stories/slide-image/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brandId, vibe, role }),
    })
    if (res.status === 429) return { error: "insufficient_credits" }
    if (!res.ok) return { error: "failed" }
    const json = await res.json() as { data?: { public_url?: string } }
    return json.data?.public_url ? { url: json.data.public_url } : { error: "failed" }
  } catch {
    return { error: "failed" }
  }
}

// Best-effort AI background fetch for the hook/cta slides — never throws,
// resolves to null (falls back to the existing flat gradient) on any HTTP
// error or network failure. Available to every plan, no tiering. Neither
// role is credit-gated, so the insufficient_credits/failed distinction
// never matters here.
async function fetchSlideBackground(brandId: string, vibe: Vibe | undefined, role: "hook" | "cta"): Promise<string | null> {
  const result = await fetchSlideBackgroundResult(brandId, vibe, role)
  return "url" in result ? result.url : null
}

// ─── Draggable text positioning ────────────────────────────────────────────────

// Instagram's Stories UI overlays the top (profile/username) and bottom
// (reply bar, link stickers) of the real 1080x1920 canvas -- same ratio
// lib/image/story-compositor.ts's SAFE_ZONE/CANVAS_HEIGHT uses, expressed
// as a percentage here since the drag position is stored as one. Clamps
// dragging so the text block's center can never land in either overlay
// area (a small inward nudge on top of the raw ratio, since a real block
// has real height and a center-anchor sitting exactly on the line would
// still let half the block poke into it).
const STORY_SAFE_ZONE_PCT = (250 / 1920) * 100
const STORY_TEXT_BOUNDS = { minX: 15, maxX: 85, minY: STORY_SAFE_ZONE_PCT + 4, maxY: 100 - STORY_SAFE_ZONE_PCT - 4 }

// Starting point for a freshly generated slide that's never been dragged
// -- approximates where the old fixed top/center/bottom flex layout used
// to land text, so switching to free drag positioning doesn't jump
// existing content around on first render. Once dragged even once,
// story.text_position_x/y take over completely and this is never
// consulted again for that slide.
function defaultStoryTextPosition(pos: StorySlide["text_position"]): TextPosition {
  if (pos === "top") return { x: 50, y: STORY_TEXT_BOUNDS.minY + 6 }
  if (pos === "bottom") return { x: 50, y: STORY_TEXT_BOUNDS.maxY - 6 }
  return { x: 50, y: 50 }
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
  const frameRef = useRef<HTMLDivElement>(null)
  const textBlockRef = useRef<HTMLDivElement>(null)
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

  // Free-drag text positioning -- text_position (top/center/bottom) only
  // still matters as the starting point for a slide that's never been
  // dragged; once story.text_position_x/y exist, they're the sole source
  // of truth. Percentage-based against the whole 220x390 phone frame
  // (frameRef), the exact same box the real compositor treats as 0-100 --
  // see useDraggableText's own doc comment for why that's what makes one
  // stored position render correctly at both sizes.
  const storedPosition: TextPosition | null =
    story.text_position_x !== undefined && story.text_position_y !== undefined
      ? { x: story.text_position_x, y: story.text_position_y }
      : null
  const { onPointerDown: onDragHandleDown, current: textPos } = useDraggableText({
    containerRef: frameRef,
    measureRef: textBlockRef,
    position: storedPosition ?? defaultStoryTextPosition(story.text_position),
    bounds: STORY_TEXT_BOUNDS,
    onCommit: (p) => onUpdateSlide({ text_position_x: p.x, text_position_y: p.y }),
  })

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
        ref={frameRef}
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

          {/* Main content -- free-drag positioned (see useDraggableText),
              replacing the old fixed top/center/bottom flex layout. left/
              top are percentages of the phone frame itself (frameRef),
              anchored at the block's own center via the translate, so the
              same textPos renders correctly at this small preview size and
              at the compositor's real 1080x1920 canvas alike. */}
          <div
            ref={textBlockRef}
            className="absolute z-10 flex flex-col items-center px-2"
            style={{
              left: `${textPos.x}%`,
              top: `${textPos.y}%`,
              transform: "translate(-50%, -50%)",
              // Shrink-to-fit (not a fixed near-full-frame width) -- a
              // fixed wide box centered off to one side clips its own
              // text against the frame edge the moment it's dragged away
              // from x=50 (confirmed live). Capped by maxWidth so long
              // text still wraps instead of overflowing the frame.
              width: "max-content",
              maxWidth: "calc(100% - 32px)",
              touchAction: "none",
            }}
          >
            {/* Drag handle -- deliberately separate from the text itself
                so grabbing it never fights the contentEditable fields'
                own click-to-place-cursor behavior below. Always visible
                (not hover-only) since hover has no touch-device
                equivalent and this handle is the only way to discover
                free positioning exists. */}
            <button
              type="button"
              onPointerDown={onDragHandleDown}
              title="Drag to reposition"
              className="mb-1.5 flex h-5 w-8 shrink-0 cursor-grab items-center justify-center rounded-full bg-black/40 text-white transition-colors hover:bg-black/60 active:cursor-grabbing"
            >
              <Move className="h-3 w-3" />
            </button>
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

            {/* Plain CTA text, not an interactive sticker -- baked into the
                image file, this can't actually collect taps/votes once
                published (Instagram's real Question/Poll stickers are only
                addable natively through Instagram's own app/API afterward),
                so it shouldn't be styled to look like one. */}
            {story.has_poll && story.poll_options && (
              <p className={`mt-4 text-center text-xs font-semibold ${subColor}`}>
                {story.poll_options.join("  ·  ")}
              </p>
            )}
          </div>

          {/* Tap to continue hint -- pinned to the bottom edge directly
              now that the content block above is out of normal flow
              (absolutely positioned for free dragging), rather than
              relying on a flex-1 sibling pushing it down. */}
          {index < total - 1 && (
            <p className={`absolute z-10 bottom-0 inset-x-0 pb-3 text-center text-[9px] ${subColor}`}>Tap to continue →</p>
          )}
        </div>
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
          const ok = await downloadStorySlideAsImage(toExportSlide(story, uploadedImage), `story-${index + 1}`)
          if (!ok) setDlErr(true)
        }}
          className="flex items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-medium hover:bg-secondary">
          <Image className="h-3 w-3" /> PNG
        </button>
        {dlErr && <p className="text-[10px] text-destructive">Download failed</p>}
      </div>

      {/* Preset color/gradient swap plus a real per-slide custom color --
          both a local re-composite only, no new generation call. Picking
          either drops any AI background image so the flat color actually
          becomes visible. Custom color is stored on THIS slide's own
          custom_background_colors via onUpdateSlide (which only ever
          updates stories[index], never siblings — see updateSlide in the
          main component) rather than the whole-sequence customColors
          state the top-level "Custom color" vibe option sets at
          generation time -- that's still what seeds an initial color for
          every slide when picked upfront, but this is what lets one slide
          get its own different color afterward, per-slide, exactly like
          Carousel's SlideEditor. */}
      {showColors && (
        <div className="flex flex-col items-center gap-2">
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
            <button
              type="button"
              title="Custom color"
              onClick={() => onUpdateSlide({ custom_background_colors: story.custom_background_colors?.length ? story.custom_background_colors : ["#6366F1", "#EC4899"], background_image_url: undefined })}
              className={`flex h-6 w-6 items-center justify-center rounded-full border border-black/10 transition-transform hover:scale-110 ${customBg ? "ring-2 ring-offset-2 ring-violet-500" : ""}`}
              style={{ background: customBg ?? "linear-gradient(135deg, #6366F1, #EC4899)" }}
            >
              <Palette className="h-3 w-3 text-white drop-shadow" />
            </button>
          </div>

          {customBg && (
            <div className="w-56 rounded-lg border bg-card p-3">
              <ColorWheelPicker
                colors={story.custom_background_colors ?? ["#6366F1", "#EC4899"]}
                onChange={(colors) => onUpdateSlide({ custom_background_colors: colors, background_image_url: undefined })}
              />
            </div>
          )}
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
  // Extends the hook/cta-only AI background to every reveal/buildup slide
  // too -- opt-in since, unlike hook/cta, each one spends real credits
  // (see STORY_SLIDE_AI_BACKGROUND). Only meaningful alongside a real
  // vibe (custom_color already means "flat color everywhere, no AI,
  // ever" -- mutually exclusive with this, not layered on top of it).
  // Mirrors CarouselBuilder.tsx's identical allSlidesAiBg exactly.
  const [allSlidesAiBg, setAllSlidesAiBg] = useState(false)
  const [bodyBgProgress, setBodyBgProgress] = useState<{ current: number; total: number } | null>(null)
  const [bodyBgWarning, setBodyBgWarning] = useState<string | null>(null)

  // The saved stories row id -- needed by the debounced autosave effect
  // below, so lifted into state instead of staying a local `const` inside
  // generate() the way it was before this fix.
  const [storyRowId, setStoryRowId] = useState<string | null>(null)
  const lastPersistedStoriesRef = useRef<string | null>(null)
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")

  // Restore from sessionStorage -- confirmed live (2026-08-29), the exact
  // same bug found in CarouselBuilder.tsx's identical restore effect: this
  // dropped the saved stories row's own `id` entirely (never read from
  // `parsed`, never passed into setStoryRowId), even though the persist
  // effect right below now always writes it. A restored story sequence's
  // `storyRowId` therefore came back null after any reload/tab revisit,
  // and the debounced autosave effect's very first guard
  // (`if (!storyRowId || stories.length === 0) return`) means every edit
  // made afterward -- inline text, a preset color swap, the new per-slide
  // custom color -- looked like it saved (no error, no different UI) but
  // was quietly never persisted.
  useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { id?: string | null; stories?: StorySlide[]; caption?: StoryCaption }
        if (parsed.stories && parsed.stories.length > 0) {
          setStories(parsed.stories)
          setStoryCaption(parsed.caption ?? null)
          setStoryRowId(parsed.id ?? null)
        }
      } catch {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId])

  // Persist to sessionStorage -- now includes the row id (see the restore
  // effect's comment above for why this half of the round trip matters
  // just as much as reading it back).
  useEffect(() => {
    if (stories.length > 0) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ id: storyRowId, stories, caption: storyCaption }))
    }
  }, [stories, storyCaption, storyRowId, STORAGE_KEY])

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
        (async () => {
          // Best-effort AI backgrounds for hook/cta slides only (available
          // to every plan, no tiering) — fired after text succeeds so a
          // slow/failed image call never blocks or breaks story generation
          // itself. fetchSlideBackground never throws, so Promise.all here
          // always resolves.
          const bgTargets = savedStories
            .map((slide, i) => ({ slide, i }))
            .filter((t): t is { slide: StorySlide & { type: "hook" | "cta" }; i: number } => t.slide.type === "hook" || t.slide.type === "cta")

          const urls = await Promise.all(bgTargets.map(({ slide }) => fetchSlideBackground(brandId, vibe, slide.type)))
          if (generationIdRef.current !== genId) return

          const updated = [...savedStories]
          bgTargets.forEach(({ i }, idx) => {
            const url = urls[idx]
            if (url) updated[i] = { ...updated[i]!, background_image_url: url }
          })

          // Reveal/buildup slides are credit-metered (unlike hook/cta
          // above), so they're requested one at a time rather than all at
          // once — partly to fail fast and stop asking once credits run
          // out instead of firing a batch of doomed requests, and partly
          // because Pollinations itself only allows one in-flight request
          // per IP (confirmed live on the Carousel equivalent of this
          // feature), so real parallelism here would mostly just trade one
          // slow path for a bunch of failed ones. Mirrors
          // CarouselBuilder.tsx's identical body-slide loop exactly.
          const bodyIndices = allSlidesAiBg
            ? savedStories.map((_, i) => i).filter((i) => savedStories[i]!.type === "reveal" || savedStories[i]!.type === "buildup")
            : []

          for (let n = 0; n < bodyIndices.length; n++) {
            setBodyBgProgress({ current: n + 1, total: bodyIndices.length })
            const result = await fetchSlideBackgroundResult(brandId, vibe, "body")
            if (generationIdRef.current !== genId) { setBodyBgProgress(null); return }
            if ("url" in result) {
              updated[bodyIndices[n]!] = { ...updated[bodyIndices[n]!]!, background_image_url: result.url }
            } else if (result.error === "insufficient_credits") {
              setBodyBgWarning(
                `Ran out of credits after ${n} of ${bodyIndices.length} extra slide backgrounds — the rest kept their flat color.`
              )
              break
            }
            // A plain "failed" (transient generation error) doesn't stop
            // the loop -- that one slide just keeps its flat color, same
            // best-effort fallback hook/cta already have.
          }
          setBodyBgProgress(null)

          if (!urls.some((u) => u) && bodyIndices.length === 0) return

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
        })()
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

        {/* Optional per-sequence upgrade: AI photo backgrounds for every
            reveal/buildup slide, not just the hook/cta that already get
            one free. Only offered alongside a real vibe -- Custom color
            already means "flat color everywhere, no AI", so the two are
            mutually exclusive rather than combinable. Mirrors
            CarouselBuilder.tsx's identical toggle exactly. */}
        {vibe && vibe !== "custom_color" && (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm transition-colors hover:bg-secondary/40">
            <input
              type="checkbox"
              checked={allSlidesAiBg}
              onChange={(e) => setAllSlidesAiBg(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-input"
            />
            <div>
              <p className="font-medium">AI background for every slide</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Generates a real photo background for each reveal/buildup slide too, not just the opening and closing slide —{" "}
                {STORY_SLIDE_AI_BACKGROUND} credits per slide, charged only for slides that actually generate one.
              </p>
            </div>
          </label>
        )}

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

      {bodyBgProgress && (
        <div className="flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-700">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          Generating slide background {bodyBgProgress.current} of {bodyBgProgress.total}…
        </div>
      )}

      {bodyBgWarning && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          {bodyBgWarning}
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
                const exportSlides = stories.map((s, i) => toExportSlide(s, selectedProduct?.imageUrl ?? uploadedImages[i]?.preview))
                const ok = await downloadStorySlidesAsImages(exportSlides, "story-sequence")
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
            storySlides={stories.map((s, i) => toExportSlide(s, selectedProduct?.imageUrl ?? uploadedImages[i]?.preview))}
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
