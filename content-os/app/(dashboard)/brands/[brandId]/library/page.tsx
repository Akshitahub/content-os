"use client"

import { useState, useCallback, useEffect } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Archive, Copy, Check, Star, Sparkles, BookOpen, ChevronDown, ChevronUp, Film, LayoutGrid, Megaphone, Download, Search, Zap, Timer, Newspaper, MoreVertical, Eye, CalendarClock, Trash2 } from "lucide-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import Link from "next/link"
import { GenerateVideoAction } from "@/components/shared/GenerateVideoAction"
import { ContentDetailPanel, type DetailItem } from "@/components/shared/ContentDetailPanel"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { SlidingTabs } from "@/components/shared/SlidingTabs"
import type { HookRow, CaptionRow, ReelScriptRow, CarouselRow, AdCopyRow, EmailSequenceRow, ProductDescriptionRow, StoryRow, BlogPostRow } from "@/types/database"
import type { Json } from "@/types/database"
import { scoreHook, scoreColor, scoreLabel } from "@/lib/utils/content-score"

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DATE_RANGES = [
  { label: "All time", value: "all" },
  { label: "Last 7 days", value: "7" },
  { label: "Last 30 days", value: "30" },
  { label: "Last 90 days", value: "90" },
] as const

const HOOK_TYPES = ["all", "question", "bold_statement", "story", "statistic", "controversial", "how_to"] as const
const PLATFORMS = ["all", "instagram", "tiktok", "youtube", "facebook", "linkedin", "twitter"] as const

// Pill-shaped, matching the app's other filter/select controls rather
// than a bare native <select> box -- the one styling these dropdowns
// shared before this pass.
const FILTER_SELECT_CLASS = "rounded-full border bg-background px-3.5 py-1.5 text-xs font-medium shadow-sm transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

function inDateRange(dateStr: string, days: string): boolean {
  if (days === "all") return true
  const d = parseInt(days, 10)
  return new Date(dateStr) >= new Date(Date.now() - d * 24 * 60 * 60 * 1000)
}

// ─── Shared components ────────────────────────────────────────────────────────

function StarRating({ value, onChange, disabled }: { value: number | null; onChange: (r: number) => void; disabled?: boolean }) {
  const [hover, setHover] = useState<number | null>(null)
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          disabled={disabled}
          onClick={() => onChange(star)}
          onMouseEnter={() => setHover(star)}
          onMouseLeave={() => setHover(null)}
          className="rounded p-0.5 transition-colors hover:text-yellow-400 focus-visible:outline-none disabled:cursor-not-allowed"
        >
          <Star className={`h-4 w-4 transition-colors ${(hover ?? value ?? 0) >= star ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/40"}`} />
        </button>
      ))}
    </div>
  )
}

function CopyButton({ text, className, touchUrl }: { text: string; className?: string; touchUrl?: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
    // Copying is genuine engagement — bump last_accessed_at so this item
    // doesn't look abandoned to the cleanup cron. Fire-and-forget: never
    // block the copy feedback on this, and a failure here is silently
    // non-fatal since it's just a freshness signal, not user data.
    if (touchUrl) {
      fetch(touchUrl, { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {})
    }
  }, [text, touchUrl])
  return (
    <Button variant="ghost" size="sm" onClick={handleCopy} className={className}>
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  )
}

/**
 * "⋮" quick-actions trigger for a card's top-right corner -- a faster path
 * to View/Schedule/Delete/rating than opening the full ContentDetailPanel
 * first. View and Schedule both just call the card's own openDetail (same
 * one the card body's onClick already uses) rather than duplicating
 * ScheduleAction's modal here: Schedule lands the user in the panel where
 * it already lives, not a second instance of it. Delete sets a lifted
 * `deleteConfirming` flag the card's own footer DeleteConfirmButton
 * already renders from (controlled mode) -- same confirmation UI, one
 * instance, just triggerable from two places. Rating is the real
 * StarRating component embedded directly, no separate rating UI.
 *
 * DropdownMenuContent renders through a portal, so a click inside it still
 * bubbles through the *React* tree (not the DOM tree) up to the card's own
 * onClick={openDetail} unless stopped here -- confirmed this is necessary,
 * not just the trigger button.
 */
function CardQuickActions({
  onView,
  canSchedule,
  onRequestDelete,
  rating,
  onRatingChange,
  ratingPending,
}: {
  onView: () => void
  canSchedule: boolean
  onRequestDelete: () => void
  rating: number | null
  onRatingChange: (r: number) => void
  ratingPending?: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="More actions"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={onView}>
          <Eye className="h-3.5 w-3.5" /> View
        </DropdownMenuItem>
        {canSchedule && (
          <DropdownMenuItem onSelect={onView}>
            <CalendarClock className="h-3.5 w-3.5" /> Schedule
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onRequestDelete} className="text-destructive focus:bg-destructive/10 focus:text-destructive">
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Edit rating</p>
          <StarRating value={rating} onChange={onRatingChange} disabled={ratingPending} />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// 45 days matches the cleanup cron's ABANDONED_AFTER_DAYS
// (app/api/v1/cron/cleanup-abandoned-drafts/route.ts). Only shown once an
// item is within a week of that threshold — otherwise every card would be
// cluttered with a countdown no one needs yet.
const ABANDONED_AFTER_DAYS = 45
const EXPIRY_WARNING_WINDOW_DAYS = 7

function ExpiryBadge({ lastAccessedAt }: { lastAccessedAt?: string }) {
  // Date.now() is impure, so it's read inside an effect rather than
  // directly in the render body.
  const [daysLeft, setDaysLeft] = useState<number | null>(null)

  useEffect(() => {
    if (!lastAccessedAt) {
      setDaysLeft(null)
      return
    }
    const ageDays = (Date.now() - new Date(lastAccessedAt).getTime()) / (1000 * 60 * 60 * 24)
    setDaysLeft(Math.ceil(ABANDONED_AFTER_DAYS - ageDays))
  }, [lastAccessedAt])

  if (daysLeft === null || daysLeft > EXPIRY_WARNING_WINDOW_DAYS || daysLeft < 0) return null
  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
      Expires in {daysLeft} day{daysLeft !== 1 ? "s" : ""}
    </span>
  )
}

const HOOK_TYPE_COLORS: Record<string, string> = {
  question: "bg-blue-100 text-blue-700",
  bold_statement: "bg-orange-100 text-orange-700",
  story: "bg-purple-100 text-purple-700",
  statistic: "bg-green-100 text-green-700",
  controversial: "bg-red-100 text-red-700",
  how_to: "bg-teal-100 text-teal-700",
}

function HookTypeBadge({ type }: { type: string | null }) {
  if (!type) return null
  const color = HOOK_TYPE_COLORS[type] ?? "bg-muted text-muted-foreground"
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${color}`}>{type.replace(/_/g, " ")}</span>
}

function ScoreBadge({ text }: { text: string }) {
  const score = scoreHook(text)
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${scoreColor(score)}`}>
      {score}/10 · {scoreLabel(score)}
    </span>
  )
}

function PlatformBadge({ platform }: { platform: string | null }) {
  if (!platform) return null
  return <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary capitalize">{platform}</span>
}

function EmptyState({ label, brandId }: { label: string; brandId: string }) {
  return (
    <div className="flex h-48 flex-col items-center justify-center rounded-lg border border-dashed text-center">
      <BookOpen className="h-10 w-10 text-muted-foreground/30 mb-3" />
      <p className="text-sm font-medium">No {label} yet</p>
      <p className="mt-1 text-xs text-muted-foreground mb-4">Generate content to build your library.</p>
      <Button size="sm" asChild variant="outline">
        <Link href={`/brands/${brandId}/generate`}>Go to Create</Link>
      </Button>
    </div>
  )
}

function SkeletonGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[1, 2, 3].map(i => <div key={i} className="h-44 animate-pulse rounded-lg bg-secondary" />)}
    </div>
  )
}

// ─── Hook card ────────────────────────────────────────────────────────────────

function HookCard({ hook, brandId }: { hook: HookRow; brandId: string }) {
  const [expanded, setExpanded] = useState(false)
  const qc = useQueryClient()
  const ratingMutation = useMutation({
    mutationFn: async (rating: number) => {
      const res = await fetch(`/api/v1/brands/${brandId}/hooks/${hook.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_rating: rating }),
      })
      if (!res.ok) throw new Error("Failed to update rating")
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library", "hooks", brandId] }),
  })
  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/v1/brands/${brandId}/hooks/${hook.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_saved: !hook.is_saved }),
      })
      if (!res.ok) throw new Error("Failed to update")
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library", "hooks", brandId] }),
  })
  const isLong = hook.hook_text.length > 180
  const displayText = isLong && !expanded ? hook.hook_text.slice(0, 180) + "…" : hook.hook_text
  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <HookTypeBadge type={hook.hook_type} />
            <ScoreBadge text={hook.hook_text} />
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">{new Date(hook.created_at).toLocaleDateString()}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm leading-relaxed">{displayText}</p>
        {isLong && (
          <button onClick={() => setExpanded(e => !e)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
        <div className="flex items-center justify-between gap-2 pt-1 border-t">
          <StarRating value={hook.user_rating} onChange={(r) => ratingMutation.mutate(r)} disabled={ratingMutation.isPending} />
          <div className="flex gap-1">
            <CopyButton text={hook.hook_text} />
            <Button variant="ghost" size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {hook.is_saved ? "Unsave" : "Save"}
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/brands/${brandId}/generate`}><Sparkles className="h-3.5 w-3.5" />Caption</Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Caption card ─────────────────────────────────────────────────────────────

export type CaptionWithImages = CaptionRow & { images: { public_url: string }[] }

function CaptionCard({ caption, brandId, onOpenDetail }: { caption: CaptionWithImages; brandId: string; onOpenDetail: (item: DetailItem) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [deleteConfirming, setDeleteConfirming] = useState(false)
  const qc = useQueryClient()
  const ratingMutation = useMutation({
    mutationFn: async (rating: number) => {
      const res = await fetch(`/api/v1/brands/${brandId}/captions/${caption.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_rating: rating }),
      })
      if (!res.ok) throw new Error("Failed to update rating")
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library", "captions", brandId] }),
  })
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/v1/brands/${brandId}/captions/${caption.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete caption.")
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library", "captions", brandId] }),
  })
  const isLong = caption.caption_text.length > 200
  const displayText = isLong && !expanded ? caption.caption_text.slice(0, 200) + "…" : caption.caption_text
  const thumbnail = caption.images[0]?.public_url ?? null

  function openDetail() {
    onOpenDetail({
      kind: "caption",
      title: "Caption",
      blocks: [{ text: caption.caption_text, imageUrl: thumbnail }],
      hashtags: caption.hashtags,
      createdAt: caption.created_at,
      scheduleCaption: caption.caption_text,
      scheduleImageUrl: thumbnail,
      platform: caption.platform,
      onDelete: () => deleteMutation.mutateAsync(),
    })
  }

  return (
    <Card
      onClick={openDetail}
      className="group cursor-pointer overflow-hidden transition-all duration-200 hover:-translate-y-1 hover:shadow-lg hover:shadow-violet-100"
    >
      {thumbnail ? (
        <div className="aspect-square overflow-hidden bg-secondary">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumbnail} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
        </div>
      ) : (
        <div className="flex aspect-square items-center justify-center bg-gradient-to-br from-violet-50 to-fuchsia-50">
          <Archive className="h-10 w-10 text-violet-300" />
        </div>
      )}
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <PlatformBadge platform={caption.platform} />
            {caption.character_count !== null && <span className="text-xs text-muted-foreground">{caption.character_count} chars</span>}
            <ExpiryBadge lastAccessedAt={caption.last_accessed_at} />
          </div>
          <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <span className="text-xs text-muted-foreground">{new Date(caption.created_at).toLocaleDateString()}</span>
            <CardQuickActions
              onView={openDetail}
              canSchedule
              onRequestDelete={() => setDeleteConfirming(true)}
              rating={caption.user_rating}
              onRatingChange={(r) => ratingMutation.mutate(r)}
              ratingPending={ratingMutation.isPending}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{displayText}</p>
        {isLong && (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(v => !v) }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
        {caption.hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {caption.hashtags.map((tag) => (
              <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">#{tag.replace(/^#/, "")}</span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t" onClick={(e) => e.stopPropagation()}>
          <StarRating value={caption.user_rating} onChange={(r) => ratingMutation.mutate(r)} disabled={ratingMutation.isPending} />
          <div className="flex items-center gap-1">
            <CopyButton text={caption.caption_text} touchUrl={`/api/v1/brands/${brandId}/captions/${caption.id}`} />
            <DeleteConfirmButton
              onDelete={() => deleteMutation.mutateAsync()}
              confirming={deleteConfirming}
              onConfirmingChange={setDeleteConfirming}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Reel Script card ─────────────────────────────────────────────────────────

interface SceneShape { visual_direction?: string; voiceover_or_text_overlay?: string; duration_seconds?: number }

function ReelScriptCard({ script, brandId }: { script: ReelScriptRow; brandId: string }) {
  const qc = useQueryClient()
  const scenes = (script.scenes as Json[]) ?? []
  const ratingMutation = useMutation({
    mutationFn: async (rating: number) => {
      const res = await fetch(`/api/v1/brands/${brandId}/reel-scripts/${script.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_rating: rating }),
      })
      if (!res.ok) throw new Error("Failed to update rating")
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library", "scripts", brandId] }),
  })
  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500">
              <Film className="h-3.5 w-3.5" />
            </span>
            <PlatformBadge platform={script.platform} />
            <ExpiryBadge lastAccessedAt={script.last_accessed_at} />
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">{new Date(script.created_at).toLocaleDateString()}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm font-medium leading-snug line-clamp-3">{script.hook}</p>
        <p className="text-xs text-muted-foreground">{scenes.length} scene{scenes.length !== 1 ? "s" : ""}</p>
        {scenes[0] && (
          <p className="text-xs text-muted-foreground line-clamp-2 italic">
            Scene 1: {(scenes[0] as SceneShape).visual_direction ?? ""}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 pt-1 border-t">
          <StarRating value={script.user_rating} onChange={(r) => ratingMutation.mutate(r)} disabled={ratingMutation.isPending} />
          <CopyButton
            text={`${script.hook}\n\n${scenes.map((s, i) => `Scene ${i + 1}: ${(s as SceneShape).voiceover_or_text_overlay ?? ""}`).join("\n")}`}
            touchUrl={`/api/v1/brands/${brandId}/reel-scripts/${script.id}`}
          />
        </div>
        <GenerateVideoAction
          scriptId={script.id}
          brandId={brandId}
          defaultCaption={script.caption ?? script.hook}
          initialScenePrompts={scenes.map((s) => (s as SceneShape).visual_direction ?? "")}
        />
      </CardContent>
    </Card>
  )
}

// ─── Carousel card ────────────────────────────────────────────────────────────

// Confirmed against a real persisted carousels row (not assumed from the
// generation prompt alone): content slides carry their bullet points
// under `points` (a string array), never a `body` string field -- reading
// `s.body` here always resolved to undefined, silently dropping every
// body slide's actual substantive text (not just its background) from
// the Library's detail view. `subtext` is cover-only.
interface SlideShape { headline?: string; subtext?: string; points?: string[]; image_url?: string | null; background_style?: string | null }

function CarouselCard({ carousel, brandId, onOpenDetail }: { carousel: CarouselRow; brandId: string; onOpenDetail: (item: DetailItem) => void }) {
  const [deleteConfirming, setDeleteConfirming] = useState(false)
  const qc = useQueryClient()
  const slides = (carousel.slides as Json[] as SlideShape[]) ?? []
  const ratingMutation = useMutation({
    mutationFn: async (rating: number) => {
      const res = await fetch(`/api/v1/brands/${brandId}/carousels/${carousel.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_rating: rating }),
      })
      if (!res.ok) throw new Error("Failed to update rating")
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library", "carousels", brandId] }),
  })
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/v1/brands/${brandId}/carousels/${carousel.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete carousel.")
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library", "carousels", brandId] }),
  })
  const thumbnail = slides.find((s) => s.image_url)?.image_url ?? null
  const scheduleImages = slides.map((s) => s.image_url).filter((u): u is string => !!u)

  function openDetail() {
    onOpenDetail({
      kind: "carousel",
      title: carousel.title || "Carousel",
      blocks: slides.map((s, i) => ({
        label: `Slide ${i + 1}`,
        text: [s.headline, s.subtext, ...(s.points ?? [])].filter(Boolean).join("\n"),
        imageUrl: s.image_url,
        backgroundStyle: s.background_style,
      })),
      hashtags: carousel.hashtags,
      createdAt: carousel.created_at,
      scheduleCaption: carousel.title || slides[0]?.headline || "",
      scheduleImageUrls: scheduleImages,
      platform: carousel.platform,
      onDelete: () => deleteMutation.mutateAsync(),
    })
  }

  return (
    <Card
      onClick={openDetail}
      className="group cursor-pointer overflow-hidden transition-all duration-200 hover:-translate-y-1 hover:shadow-lg hover:shadow-violet-100"
    >
      {thumbnail ? (
        <div className="aspect-square overflow-hidden bg-secondary">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumbnail} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
        </div>
      ) : (
        <div className="flex aspect-square items-center justify-center bg-gradient-to-br from-violet-50 to-fuchsia-50">
          <LayoutGrid className="h-10 w-10 text-violet-300" />
        </div>
      )}
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <PlatformBadge platform={carousel.platform} />
            <ExpiryBadge lastAccessedAt={carousel.last_accessed_at} />
          </div>
          <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <span className="text-xs text-muted-foreground">{new Date(carousel.created_at).toLocaleDateString()}</span>
            <CardQuickActions
              onView={openDetail}
              canSchedule
              onRequestDelete={() => setDeleteConfirming(true)}
              rating={carousel.user_rating}
              onRatingChange={(r) => ratingMutation.mutate(r)}
              ratingPending={ratingMutation.isPending}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {carousel.title && <p className="text-sm font-semibold line-clamp-2">{carousel.title}</p>}
        <p className="text-xs text-muted-foreground">{slides.length} slide{slides.length !== 1 ? "s" : ""}</p>
        {slides[0] && (
          <p className="text-xs text-muted-foreground line-clamp-2">Slide 1: {slides[0].headline ?? ""}</p>
        )}
        {carousel.hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {carousel.hashtags.slice(0, 4).map((tag) => (
              <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">#{tag.replace(/^#/, "")}</span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t" onClick={(e) => e.stopPropagation()}>
          <StarRating value={carousel.user_rating} onChange={(r) => ratingMutation.mutate(r)} disabled={ratingMutation.isPending} />
          <div className="flex items-center gap-1">
            <CopyButton
              text={slides.map((s, i) => [`Slide ${i + 1}`, s.headline, s.subtext, ...(s.points ?? [])].filter(Boolean).join("\n")).join("\n\n")}
              touchUrl={`/api/v1/brands/${brandId}/carousels/${carousel.id}`}
            />
            <DeleteConfirmButton
              onDelete={() => deleteMutation.mutateAsync()}
              confirming={deleteConfirming}
              onConfirmingChange={setDeleteConfirming}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Story card ───────────────────────────────────────────────────────────────

interface StorySlideShape { text?: string; subtext?: string; type?: string; background_image_url?: string | null }

function StoryCard({ story, brandId, onOpenDetail }: { story: StoryRow; brandId: string; onOpenDetail: (item: DetailItem) => void }) {
  const [deleteConfirming, setDeleteConfirming] = useState(false)
  const qc = useQueryClient()
  const slides = (story.stories as Json[] as StorySlideShape[]) ?? []
  const ratingMutation = useMutation({
    mutationFn: async (rating: number) => {
      const res = await fetch(`/api/v1/brands/${brandId}/stories/${story.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_rating: rating }),
      })
      if (!res.ok) throw new Error("Failed to update rating")
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library", "stories", brandId] }),
  })
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/v1/brands/${brandId}/stories/${story.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete story.")
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library", "stories", brandId] }),
  })
  const thumbnail = slides.find((s) => s.background_image_url)?.background_image_url ?? null
  const scheduleImages = slides.map((s) => s.background_image_url).filter((u): u is string => !!u)

  function openDetail() {
    onOpenDetail({
      kind: "story",
      title: "Story sequence",
      subtitle: story.topic,
      blocks: slides.map((s, i) => ({
        label: `Story ${i + 1}${s.type ? ` (${s.type})` : ""}`,
        text: [s.text, s.subtext].filter(Boolean).join("\n"),
        imageUrl: s.background_image_url,
      })),
      hashtags: [],
      createdAt: story.created_at,
      scheduleCaption: story.topic || slides[0]?.text || "",
      scheduleImageUrls: scheduleImages,
      // stories has no platform column of its own -- Instagram Stories is
      // the only thing this feature ever produces (StorySequence.tsx,
      // ScheduleAction's isMultiSlide path), not a guessed default.
      platform: "instagram",
      onDelete: () => deleteMutation.mutateAsync(),
    })
  }

  return (
    <Card
      onClick={openDetail}
      className="group cursor-pointer overflow-hidden transition-all duration-200 hover:-translate-y-1 hover:shadow-lg hover:shadow-violet-100"
    >
      {thumbnail ? (
        <div className="aspect-square overflow-hidden bg-secondary">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumbnail} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
        </div>
      ) : (
        <div className="flex aspect-square items-center justify-center bg-gradient-to-br from-violet-50 to-fuchsia-50">
          <Zap className="h-10 w-10 text-violet-300" />
        </div>
      )}
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            {story.topic && <p className="text-sm font-medium leading-snug line-clamp-2">{story.topic}</p>}
            <ExpiryBadge lastAccessedAt={story.last_accessed_at} />
          </div>
          <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <span className="text-xs text-muted-foreground">{new Date(story.created_at).toLocaleDateString()}</span>
            <CardQuickActions
              onView={openDetail}
              canSchedule
              onRequestDelete={() => setDeleteConfirming(true)}
              rating={story.user_rating}
              onRatingChange={(r) => ratingMutation.mutate(r)}
              ratingPending={ratingMutation.isPending}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{slides.length} stor{slides.length !== 1 ? "ies" : "y"}</p>
        {slides[0] && (
          <p className="text-xs text-muted-foreground line-clamp-2 italic">
            Story 1: {slides[0].text ?? ""}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t" onClick={(e) => e.stopPropagation()}>
          <StarRating value={story.user_rating} onChange={(r) => ratingMutation.mutate(r)} disabled={ratingMutation.isPending} />
          <div className="flex items-center gap-1">
            <CopyButton
              text={slides.map((s, i) => `Story ${i + 1} (${s.type ?? ""}):\n${s.text ?? ""}\n${s.subtext ?? ""}`).join("\n\n")}
              touchUrl={`/api/v1/brands/${brandId}/stories/${story.id}`}
            />
            <DeleteConfirmButton
              onDelete={() => deleteMutation.mutateAsync()}
              confirming={deleteConfirming}
              onConfirmingChange={setDeleteConfirming}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Ad Copy card ─────────────────────────────────────────────────────────────

function AdCopyCard({ ad, brandId, onOpenDetail }: { ad: AdCopyRow; brandId: string; onOpenDetail: (item: DetailItem) => void }) {
  const [deleteConfirming, setDeleteConfirming] = useState(false)
  const qc = useQueryClient()
  const ratingMutation = useMutation({
    mutationFn: async (rating: number) => {
      const res = await fetch(`/api/v1/brands/${brandId}/ad-copies/${ad.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_rating: rating }),
      })
      if (!res.ok) throw new Error("Failed to update rating")
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library", "ad-copies", brandId] }),
  })
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/v1/brands/${brandId}/ad-copies/${ad.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete ad copy.")
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library", "ad-copies", brandId] }),
  })
  const fullText = `${ad.headline}\n\n${ad.primary_text}${ad.description ? `\n\n${ad.description}` : ""}${ad.cta_button ? `\n\nCTA: ${ad.cta_button}` : ""}`

  function openDetail() {
    // No image (Ad Copy never had one) and no scheduleImageUrl/Urls --
    // ContentDetailPanel skips rendering ScheduleAction entirely when
    // neither is set, so this is view + copy only, same as the card
    // itself today. See the task's own note: ad copy is platform-ad-
    // manager copy (Meta/Google Ads), not necessarily an organic
    // scheduled post -- not wiring ScheduleAction here pending
    // confirmation on whether "schedule to calendar" is even the right
    // action for this content type.
    onOpenDetail({
      kind: "ad_copy",
      title: ad.headline,
      blocks: [
        { label: "Headline", text: ad.headline },
        { label: "Primary text", text: ad.primary_text },
        ...(ad.description ? [{ label: "Description", text: ad.description }] : []),
        ...(ad.cta_button ? [{ label: "CTA", text: ad.cta_button }] : []),
      ],
      hashtags: [],
      createdAt: ad.created_at,
      scheduleCaption: fullText,
      platform: ad.platform,
      onDelete: () => deleteMutation.mutateAsync(),
    })
  }

  return (
    <Card
      onClick={openDetail}
      className="cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500">
              <Megaphone className="h-3.5 w-3.5" />
            </span>
            <PlatformBadge platform={ad.platform} />
            <ExpiryBadge lastAccessedAt={ad.last_accessed_at} />
          </div>
          <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <span className="text-xs text-muted-foreground">{new Date(ad.created_at).toLocaleDateString()}</span>
            <CardQuickActions
              onView={openDetail}
              canSchedule={false}
              onRequestDelete={() => setDeleteConfirming(true)}
              rating={ad.user_rating}
              onRatingChange={(r) => ratingMutation.mutate(r)}
              ratingPending={ratingMutation.isPending}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm font-bold line-clamp-2">{ad.headline}</p>
        <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">{ad.primary_text}</p>
        {ad.cta_button && (
          <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{ad.cta_button}</span>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t" onClick={(e) => e.stopPropagation()}>
          <StarRating value={ad.user_rating} onChange={(r) => ratingMutation.mutate(r)} disabled={ratingMutation.isPending} />
          <div className="flex items-center gap-1">
            <CopyButton text={fullText} touchUrl={`/api/v1/brands/${brandId}/ad-copies/${ad.id}`} />
            <DeleteConfirmButton
              onDelete={() => deleteMutation.mutateAsync()}
              confirming={deleteConfirming}
              onConfirmingChange={setDeleteConfirming}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Email Sequence card ──────────────────────────────────────────────────────

interface EmailShape { subject?: string; body?: string }

function EmailSequenceCard({ sequence, brandId }: { sequence: EmailSequenceRow; brandId: string }) {
  const qc = useQueryClient()
  const emails = (sequence.emails as Json[]) ?? []
  const ratingMutation = useMutation({
    mutationFn: async (rating: number) => {
      const res = await fetch(`/api/v1/brands/${brandId}/email-sequences/${sequence.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_rating: rating }),
      })
      if (!res.ok) throw new Error("Failed to update rating")
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library", "emails", brandId] }),
  })
  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          {sequence.sequence_type && (
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium capitalize">{sequence.sequence_type}</span>
          )}
          <span className="shrink-0 ml-auto text-xs text-muted-foreground">{new Date(sequence.created_at).toLocaleDateString()}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{emails.length} email{emails.length !== 1 ? "s" : ""} in sequence</p>
        {emails[0] && (
          <p className="text-xs text-muted-foreground line-clamp-2">Email 1: {(emails[0] as EmailShape).subject ?? ""}</p>
        )}
        <div className="flex items-center justify-between gap-2 pt-1 border-t">
          <StarRating value={sequence.user_rating} onChange={(r) => ratingMutation.mutate(r)} disabled={ratingMutation.isPending} />
          <CopyButton text={emails.map((e, i) => `Email ${i + 1}\nSubject: ${(e as EmailShape).subject ?? ""}\n\n${(e as EmailShape).body ?? ""}`).join("\n\n---\n\n")} />
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Product Description card ─────────────────────────────────────────────────

function ProductDescCard({ desc, brandId }: { desc: ProductDescriptionRow; brandId: string }) {
  const qc = useQueryClient()
  const ratingMutation = useMutation({
    mutationFn: async (rating: number) => {
      const res = await fetch(`/api/v1/brands/${brandId}/product-descriptions/${desc.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_rating: rating }),
      })
      if (!res.ok) throw new Error("Failed to update rating")
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library", "product-descriptions", brandId] }),
  })
  const preview = desc.short_description ?? desc.long_description?.slice(0, 200) ?? ""
  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-end gap-2">
          <span className="shrink-0 text-xs text-muted-foreground">{new Date(desc.created_at).toLocaleDateString()}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {preview && <p className="text-sm leading-relaxed line-clamp-4">{preview}</p>}
        {desc.bullet_points.length > 0 && (
          <ul className="space-y-1">
            {desc.bullet_points.slice(0, 3).map((b, i) => (
              <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                {b}
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between gap-2 pt-1 border-t">
          <StarRating value={desc.user_rating} onChange={(r) => ratingMutation.mutate(r)} disabled={ratingMutation.isPending} />
          <CopyButton text={[desc.short_description, desc.long_description, desc.bullet_points.map(b => `• ${b}`).join("\n")].filter(Boolean).join("\n\n")} />
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Tab components ───────────────────────────────────────────────────────────

function HooksTab({ brandId }: { brandId: string }) {
  const [hookTypeFilter, setHookTypeFilter] = useState("all")
  const [dateFilter, setDateFilter] = useState("all")
  const [searchQuery, setSearchQuery] = useState("")
  const { data: hooks = [], isLoading } = useQuery({
    queryKey: ["library", "hooks", brandId, hookTypeFilter],
    queryFn: async (): Promise<HookRow[]> => {
      const params = new URLSearchParams({ saved: "true" })
      if (hookTypeFilter !== "all") params.set("hookType", hookTypeFilter)
      const res = await fetch(`/api/v1/brands/${brandId}/hooks?${params}`)
      if (!res.ok) throw new Error("Failed to fetch hooks")
      return ((await res.json()) as { data: HookRow[] }).data
    },
    enabled: !!brandId,
  })
  const filtered = hooks
    .filter(h => inDateRange(h.created_at, dateFilter))
    .filter(h => !searchQuery || h.hook_text.toLowerCase().includes(searchQuery.toLowerCase()))
  return (
    <div>
      <div className="mb-4 flex flex-col gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search hooks…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full rounded-md border bg-background py-1.5 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <select value={hookTypeFilter} onChange={e => setHookTypeFilter(e.target.value)} className="rounded-md border bg-background px-3 py-1.5 text-sm">
            {HOOK_TYPES.map(t => <option key={t} value={t}>{t === "all" ? "All types" : t.replace(/_/g, " ")}</option>)}
          </select>
          <select value={dateFilter} onChange={e => setDateFilter(e.target.value)} className="rounded-md border bg-background px-3 py-1.5 text-sm">
            {DATE_RANGES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </div>
      </div>
      {isLoading ? <SkeletonGrid /> : filtered.length === 0 ? <EmptyState label="saved hooks" brandId={brandId} /> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(h => <HookCard key={h.id} hook={h} brandId={brandId} />)}
        </div>
      )}
    </div>
  )
}

// Renders the "Posts" tab (TABS' id: "posts") -- named CaptionsTab
// because it queries the real captions table, which is where Create ->
// Post (Full Post) generations actually land. Not renamed to match the
// tab, since that would blur what data this is actually reading.
function CaptionsTab({ brandId, onOpenDetail }: { brandId: string; onOpenDetail: (item: DetailItem) => void }) {
  const [platformFilter, setPlatformFilter] = useState("all")
  const [dateFilter, setDateFilter] = useState("all")
  const { data: captions = [], isLoading } = useQuery({
    queryKey: ["library", "captions", brandId, platformFilter],
    queryFn: async (): Promise<CaptionWithImages[]> => {
      const params = new URLSearchParams({ saved: "true" })
      if (platformFilter !== "all") params.set("platform", platformFilter)
      const res = await fetch(`/api/v1/brands/${brandId}/captions?${params}`)
      if (!res.ok) throw new Error("Failed to fetch captions")
      return ((await res.json()) as { data: CaptionWithImages[] }).data
    },
    enabled: !!brandId,
  })
  const filtered = captions.filter(c => inDateRange(c.created_at, dateFilter))
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <select value={platformFilter} onChange={e => setPlatformFilter(e.target.value)} className={FILTER_SELECT_CLASS}>
          {PLATFORMS.map(p => <option key={p} value={p}>{p === "all" ? "All platforms" : p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
        </select>
        <select value={dateFilter} onChange={e => setDateFilter(e.target.value)} className={FILTER_SELECT_CLASS}>
          {DATE_RANGES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
      </div>
      {isLoading ? <SkeletonGrid /> : filtered.length === 0 ? <EmptyState label="saved posts" brandId={brandId} /> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(c => <CaptionCard key={c.id} caption={c} brandId={brandId} onOpenDetail={onOpenDetail} />)}
        </div>
      )}
    </div>
  )
}

function ScriptsTab({ brandId }: { brandId: string }) {
  const { data: scripts = [], isLoading } = useQuery({
    queryKey: ["library", "scripts", brandId],
    queryFn: async (): Promise<ReelScriptRow[]> => {
      const res = await fetch(`/api/v1/brands/${brandId}/reel-scripts?saved=true`)
      if (!res.ok) throw new Error("Failed to fetch scripts")
      return ((await res.json()) as { data: ReelScriptRow[] }).data
    },
    enabled: !!brandId,
  })
  return isLoading ? <SkeletonGrid /> : scripts.length === 0 ? <EmptyState label="saved reel scripts" brandId={brandId} /> : (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {scripts.map(s => <ReelScriptCard key={s.id} script={s} brandId={brandId} />)}
    </div>
  )
}

function CarouselsTab({ brandId, onOpenDetail }: { brandId: string; onOpenDetail: (item: DetailItem) => void }) {
  const { data: carousels = [], isLoading } = useQuery({
    queryKey: ["library", "carousels", brandId],
    queryFn: async (): Promise<CarouselRow[]> => {
      const res = await fetch(`/api/v1/brands/${brandId}/carousels?saved=true`)
      if (!res.ok) throw new Error("Failed to fetch carousels")
      return ((await res.json()) as { data: CarouselRow[] }).data
    },
    enabled: !!brandId,
  })
  return isLoading ? <SkeletonGrid /> : carousels.length === 0 ? <EmptyState label="saved carousels" brandId={brandId} /> : (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {carousels.map(c => <CarouselCard key={c.id} carousel={c} brandId={brandId} onOpenDetail={onOpenDetail} />)}
    </div>
  )
}

function StoriesTab({ brandId, onOpenDetail }: { brandId: string; onOpenDetail: (item: DetailItem) => void }) {
  const { data: stories = [], isLoading } = useQuery({
    queryKey: ["library", "stories", brandId],
    queryFn: async (): Promise<StoryRow[]> => {
      const res = await fetch(`/api/v1/brands/${brandId}/stories?saved=true`)
      if (!res.ok) throw new Error("Failed to fetch stories")
      return ((await res.json()) as { data: StoryRow[] }).data
    },
    enabled: !!brandId,
  })
  return isLoading ? <SkeletonGrid /> : stories.length === 0 ? <EmptyState label="saved story sequences" brandId={brandId} /> : (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {stories.map(s => <StoryCard key={s.id} story={s} brandId={brandId} onOpenDetail={onOpenDetail} />)}
    </div>
  )
}

function AdCopyTab({ brandId, onOpenDetail }: { brandId: string; onOpenDetail: (item: DetailItem) => void }) {
  const { data: ads = [], isLoading } = useQuery({
    queryKey: ["library", "ad-copies", brandId],
    queryFn: async (): Promise<AdCopyRow[]> => {
      const res = await fetch(`/api/v1/brands/${brandId}/ad-copies?saved=true`)
      if (!res.ok) throw new Error("Failed to fetch ad copies")
      return ((await res.json()) as { data: AdCopyRow[] }).data
    },
    enabled: !!brandId,
  })
  return isLoading ? <SkeletonGrid /> : ads.length === 0 ? <EmptyState label="saved ad copies" brandId={brandId} /> : (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {ads.map(a => <AdCopyCard key={a.id} ad={a} brandId={brandId} onOpenDetail={onOpenDetail} />)}
    </div>
  )
}

function EmailsTab({ brandId }: { brandId: string }) {
  const { data: sequences = [], isLoading } = useQuery({
    queryKey: ["library", "emails", brandId],
    queryFn: async (): Promise<EmailSequenceRow[]> => {
      const res = await fetch(`/api/v1/brands/${brandId}/email-sequences?saved=true`)
      if (!res.ok) throw new Error("Failed to fetch email sequences")
      return ((await res.json()) as { data: EmailSequenceRow[] }).data
    },
    enabled: !!brandId,
  })
  return isLoading ? <SkeletonGrid /> : sequences.length === 0 ? <EmptyState label="saved email sequences" brandId={brandId} /> : (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sequences.map(s => <EmailSequenceCard key={s.id} sequence={s} brandId={brandId} />)}
    </div>
  )
}

function ProductDescTab({ brandId }: { brandId: string }) {
  const { data: descriptions = [], isLoading } = useQuery({
    queryKey: ["library", "product-descriptions", brandId],
    queryFn: async (): Promise<ProductDescriptionRow[]> => {
      const res = await fetch(`/api/v1/brands/${brandId}/product-descriptions?saved=true`)
      if (!res.ok) throw new Error("Failed to fetch product descriptions")
      return ((await res.json()) as { data: ProductDescriptionRow[] }).data
    },
    enabled: !!brandId,
  })
  return isLoading ? <SkeletonGrid /> : descriptions.length === 0 ? <EmptyState label="saved product descriptions" brandId={brandId} /> : (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {descriptions.map(d => <ProductDescCard key={d.id} desc={d} brandId={brandId} />)}
    </div>
  )
}

// ─── Image card ───────────────────────────────────────────────────────────────

interface GeneratedImage {
  id: string
  prompt: string
  style: string | null
  aspect_ratio: string
  public_url: string
  created_at: string
}

function ImageCard({ image, brandId }: { image: GeneratedImage; brandId: string }) {
  const qc = useQueryClient()
  const unsaveMutation = useMutation({
    mutationFn: async () => {
      await fetch(`/api/v1/brands/${brandId}/images/${image.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_saved: false }),
      })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library", "images", brandId] }),
  })
  return (
    <Card className="overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="relative group aspect-square bg-secondary">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.public_url} alt={image.prompt} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
        <a
          href={image.public_url}
          download
          target="_blank"
          rel="noopener noreferrer"
          className="absolute top-2 right-2 rounded-full bg-background/90 p-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Download className="h-3.5 w-3.5" />
        </a>
      </div>
      <CardContent className="p-3 space-y-2">
        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{image.prompt}</p>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {image.style && (
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium capitalize">
                {image.style.replace(/_/g, " ")}
              </span>
            )}
            <span className="text-xs text-muted-foreground">{image.aspect_ratio}</span>
          </div>
          <span className="text-xs text-muted-foreground">{new Date(image.created_at).toLocaleDateString()}</span>
        </div>
        <div className="flex gap-1 pt-1 border-t">
          <CopyButton text={image.public_url} className="flex-1 justify-start" />
          <Button variant="ghost" size="sm" onClick={() => unsaveMutation.mutate()} disabled={unsaveMutation.isPending}>
            Unsave
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function ImagesTab({ brandId }: { brandId: string }) {
  const { data: images = [], isLoading } = useQuery({
    queryKey: ["library", "images", brandId],
    queryFn: async (): Promise<GeneratedImage[]> => {
      const res = await fetch(`/api/v1/brands/${brandId}/images`)
      if (!res.ok) throw new Error("Failed to fetch images")
      return ((await res.json()) as { data: GeneratedImage[] }).data
    },
    enabled: !!brandId,
  })
  return isLoading ? (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[1, 2, 3].map(i => <div key={i} className="aspect-square animate-pulse rounded-lg bg-secondary" />)}
    </div>
  ) : images.length === 0 ? (
    <EmptyState label="generated images" brandId={brandId} />
  ) : (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {images.map(img => <ImageCard key={img.id} image={img} brandId={brandId} />)}
    </div>
  )
}

// ─── Blog Post card ───────────────────────────────────────────────────────────

function BlogPostCard({ post, brandId }: { post: BlogPostRow; brandId: string }) {
  const qc = useQueryClient()
  const tags = post.suggested_tags ?? []
  const ratingMutation = useMutation({
    mutationFn: async (rating: number) => {
      const res = await fetch(`/api/v1/brands/${brandId}/blog-posts/${post.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_rating: rating }),
      })
      if (!res.ok) throw new Error("Failed to update rating")
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library", "blog-posts", brandId] }),
  })
  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500">
              <Newspaper className="h-3.5 w-3.5" />
            </span>
            <ExpiryBadge lastAccessedAt={post.last_accessed_at} />
          </div>
          <span className="shrink-0 ml-auto text-xs text-muted-foreground">{new Date(post.created_at).toLocaleDateString()}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm font-bold line-clamp-2">{post.title}</p>
        <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">{post.body}</p>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.slice(0, 4).map((tag) => (
              <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{tag}</span>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between gap-2 pt-1 border-t">
          <StarRating value={post.user_rating} onChange={(r) => ratingMutation.mutate(r)} disabled={ratingMutation.isPending} />
          <CopyButton
            text={`${post.title}\n\n${post.body}${tags.length ? `\n\nTags: ${tags.join(", ")}` : ""}`}
            touchUrl={`/api/v1/brands/${brandId}/blog-posts/${post.id}`}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function BlogPostsTab({ brandId }: { brandId: string }) {
  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["library", "blog-posts", brandId],
    queryFn: async (): Promise<BlogPostRow[]> => {
      const res = await fetch(`/api/v1/brands/${brandId}/blog-posts?saved=true`)
      if (!res.ok) throw new Error("Failed to fetch blog posts")
      return ((await res.json()) as { data: BlogPostRow[] }).data
    },
    enabled: !!brandId,
  })
  return isLoading ? <SkeletonGrid /> : posts.length === 0 ? <EmptyState label="saved blog posts" brandId={brandId} /> : (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {posts.map(p => <BlogPostCard key={p.id} post={p} brandId={brandId} />)}
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

// "posts" (not "captions") -- Create -> Post (Full Post) is the app's
// primary, first-listed content format, and its generations land in the
// captions table (hook + caption + image, linked via content_project_id
// -- see the content-linking work this pairs with). The table name stays
// "captions" (renaming a live table is a much bigger migration for a
// pure display/naming fix), but every user-facing label and this tab's
// own identifier now say "Posts", matching what a user actually thinks
// they made.
type LibraryTab = "posts" | "scripts" | "carousels" | "stories" | "ad_copy" | "blog_posts"

const VALID_TABS = new Set<LibraryTab>(["posts", "scripts", "carousels", "stories", "ad_copy", "blog_posts"])

const TABS: { id: LibraryTab; label: string; icon: React.ElementType }[] = [
  { id: "posts", label: "Posts", icon: Archive },
  { id: "scripts", label: "Scripts", icon: Film },
  { id: "carousels", label: "Carousels", icon: LayoutGrid },
  { id: "stories", label: "Stories", icon: Zap },
  { id: "ad_copy", label: "Ad Copy", icon: Megaphone },
  { id: "blog_posts", label: "Blog Posts", icon: Newspaper },
]

export default function LibraryPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const brandId = params.brandId as string
  const tabParam = searchParams.get("tab") as LibraryTab | null
  const [activeTab, setActiveTab] = useState<LibraryTab>(
    tabParam && VALID_TABS.has(tabParam) ? tabParam : "posts"
  )
  // Caption/Carousel/Story cards open into this instead of being dead ends
  // (see components/shared/ContentDetailPanel.tsx) — same top-level-state
  // pattern ContentCalendar.tsx uses for CalendarEntryPanel.
  const [previewItem, setPreviewItem] = useState<DetailItem | null>(null)

  // Sync tab when URL changes (handles soft navigation)
  useEffect(() => {
    if (tabParam && VALID_TABS.has(tabParam)) setActiveTab(tabParam)
  }, [tabParam])

  return (
    <div className="px-4 py-6 md:p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <Archive className="h-7 w-7 text-primary" />
            My Content
          </h1>
        </div>
        <Button asChild size="sm">
          <Link href={`/brands/${brandId}/generate`}>
            <Sparkles className="mr-2 h-4 w-4" />
            Generate more
          </Link>
        </Button>
      </div>

      {/* Persistent expiry warning — intentionally not dismissible, reappears
          on every load, matching ClickCast's "expires after 48 hours" banner. */}
      <div className="mb-6 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100">
          <Timer className="h-4 w-4 text-amber-600" />
        </span>
        <p className="text-sm font-medium text-amber-900">
          Unused drafts are automatically removed after 45 days of inactivity. Open, copy, or rate a draft to keep it.
        </p>
      </div>

      {/* Tabs — same sliding-pill pattern as the Influencers page's filter
          row, instead of a plain underline. */}
      <div className="mb-6 overflow-x-auto border-b pb-4">
        <SlidingTabs tabs={TABS} active={activeTab} onChange={setActiveTab} variant="filter" />
      </div>

      {activeTab === "posts" && <CaptionsTab brandId={brandId} onOpenDetail={setPreviewItem} />}
      {activeTab === "scripts" && <ScriptsTab brandId={brandId} />}
      {activeTab === "carousels" && <CarouselsTab brandId={brandId} onOpenDetail={setPreviewItem} />}
      {activeTab === "stories" && <StoriesTab brandId={brandId} onOpenDetail={setPreviewItem} />}
      {activeTab === "ad_copy" && <AdCopyTab brandId={brandId} onOpenDetail={setPreviewItem} />}
      {activeTab === "blog_posts" && <BlogPostsTab brandId={brandId} />}

      <ContentDetailPanel item={previewItem} onClose={() => setPreviewItem(null)} brandId={brandId} />
    </div>
  )
}
