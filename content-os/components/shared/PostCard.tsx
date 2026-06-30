"use client"

import { useState, useCallback } from "react"
import { Copy, Check, MoreHorizontal, Trash2, ExternalLink } from "lucide-react"
import { scoreHook, scoreColor, scoreLabel } from "@/lib/utils/content-score"
import type { Platform } from "@/types/app"

// ─── Platform gradients & icons ───────────────────────────────────────────────

const PLATFORM_GRADIENT: Record<string, string> = {
  instagram: "from-purple-500 via-pink-500 to-rose-400",
  tiktok: "from-gray-900 via-gray-800 to-black",
  linkedin: "from-blue-700 via-blue-600 to-blue-500",
  twitter: "from-sky-400 via-sky-500 to-blue-500",
  facebook: "from-blue-600 via-blue-500 to-indigo-600",
  youtube: "from-red-600 via-red-500 to-orange-500",
}

const HOOK_TYPE_GRADIENTS: Record<string, string> = {
  question:      "from-sky-500 via-blue-500 to-cyan-400",
  bold_statement:"from-orange-600 via-red-500 to-rose-500",
  story:         "from-purple-600 via-fuchsia-500 to-pink-500",
  statistic:     "from-emerald-600 via-teal-500 to-green-400",
  controversial: "from-gray-900 via-red-900 to-black",
  how_to:        "from-amber-500 via-orange-400 to-yellow-400",
  relatable:     "from-amber-500 via-orange-400 to-yellow-400",
}

const PLATFORM_EMOJI: Record<string, string> = {
  instagram: "📸",
  tiktok: "🎵",
  linkedin: "💼",
  twitter: "🐦",
  facebook: "👤",
  youtube: "▶️",
}

const TYPE_EMOJI: Record<string, string> = {
  hook: "🪝",
  caption: "📝",
  carousel: "🎠",
  story: "📱",
  meme: "😂",
  reel_script: "🎬",
  ad_copy: "📣",
}

// ─── Score badge ──────────────────────────────────────────────────────────────

function ScoreBadge({ text }: { text: string }) {
  const score = scoreHook(text)
  const color = scoreColor(score)
  const label = scoreLabel(score)
  const dot = score >= 8 ? "🟢" : score >= 6 ? "🟡" : score >= 4 ? "🟠" : "🔴"
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${color}`}>
      {dot} {label} {score}/10
    </span>
  )
}

// ─── Mini visual preview ──────────────────────────────────────────────────────

function MiniPreview({
  text,
  platform,
  brandName,
  hookType,
}: {
  text: string
  platform?: Platform | string
  brandName?: string
  hookType?: string
}) {
  const gradient = hookType
    ? (HOOK_TYPE_GRADIENTS[hookType] ?? PLATFORM_GRADIENT[platform ?? "instagram"] ?? PLATFORM_GRADIENT.instagram)
    : (PLATFORM_GRADIENT[platform ?? "instagram"] ?? PLATFORM_GRADIENT.instagram)
  const preview = text.slice(0, 60) + (text.length > 60 ? "…" : "")

  return (
    <div className={`relative flex h-32 w-full items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br ${gradient} p-3`}>
      <p className="text-center text-xs font-bold leading-snug text-white drop-shadow-sm line-clamp-3">
        {preview}
      </p>
      {brandName && (
        <p className="absolute bottom-1.5 right-2 text-[9px] font-medium text-white/60">
          {brandName}
        </p>
      )}
    </div>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface PostCardProps {
  type?: "hook" | "caption" | "carousel" | "story" | "meme" | "reel_script" | "ad_copy"
  content: string
  platform?: Platform | string
  hookType?: string
  number?: number
  date?: string
  status?: string
  brandName?: string
  showScore?: boolean
  onCopy?: () => void
  onEdit?: () => void
  onUnsave?: () => void
  onUse?: () => void
  size?: "sm" | "md" | "lg"
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PostCard({
  type = "hook",
  content,
  platform,
  hookType,
  number,
  date,
  status,
  brandName,
  showScore = true,
  onCopy,
  onEdit,
  onUnsave,
  onUse,
  size = "md",
}: PostCardProps) {
  const [copied, setCopied] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
    onCopy?.()
  }, [content, onCopy])

  const isSmall = size === "sm"

  return (
    <div className={`group relative rounded-xl border bg-card shadow-sm transition-all hover:shadow-md ${isSmall ? "p-2" : "p-3"}`}>
      {/* Header row */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {number !== undefined && (
            <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
              {number}
            </span>
          )}
          <span className="text-xs">{TYPE_EMOJI[type] ?? "📝"}</span>
          {platform && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {PLATFORM_EMOJI[platform] ?? "📸"} {!isSmall ? platform : ""}
            </span>
          )}
          {hookType && !isSmall && (
            <span className="truncate rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium capitalize text-secondary-foreground">
              {hookType.replace("_", " ")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {date && !isSmall && <span className="text-[10px] text-muted-foreground">{date}</span>}
          {status && !isSmall && (
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              status === "published" ? "bg-green-100 text-green-700" :
              status === "scheduled" ? "bg-blue-100 text-blue-700" :
              status === "content_ready" ? "bg-violet-100 text-violet-700" :
              "bg-gray-100 text-gray-600"
            }`}>
              {status}
            </span>
          )}
        </div>
      </div>

      {/* Mini visual preview */}
      {!isSmall && <MiniPreview text={content} platform={platform} brandName={brandName} hookType={hookType} />}

      {/* Content text */}
      <p className={`mt-2 leading-relaxed text-foreground ${isSmall ? "line-clamp-2 text-xs" : "line-clamp-3 text-sm"}`}>
        {content}
      </p>

      {/* Score */}
      {showScore && !isSmall && type === "hook" && (
        <div className="mt-2">
          <ScoreBadge text={content} />
        </div>
      )}

      {/* Action bar */}
      <div className={`mt-3 flex items-center gap-1 border-t pt-2 ${isSmall ? "justify-end" : "justify-between"}`}>
        {!isSmall && (
          <div className="flex items-center gap-1">
            {onUse && (
              <button
                onClick={onUse}
                className="rounded-full bg-violet-600 px-3 py-1 text-[10px] font-semibold text-white hover:bg-violet-700"
              >
                Use
              </button>
            )}
          </div>
        )}
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleCopy}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            title="Copy"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          {onEdit && !isSmall && (
            <button
              onClick={onEdit}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
              title="Edit"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          )}
          {(onUnsave || menuOpen !== undefined) && (
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                title="More"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 bottom-full z-20 mb-1 w-36 rounded-lg border bg-popover shadow-lg">
                    {onUnsave && (
                      <button
                        onClick={() => { onUnsave(); setMenuOpen(false) }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Remove
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
