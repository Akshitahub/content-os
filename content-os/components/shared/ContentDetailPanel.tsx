"use client"

import { X, Copy, Check } from "lucide-react"
import { useState } from "react"
import { ScheduleAction } from "@/components/shared/ScheduleAction"

// Modeled on components/calendar/CalendarEntryPanel.tsx's slide-in panel --
// same backdrop/fixed-panel/header/scrollable-body pattern, generalized to
// any saved Library item rather than a calendar entry. Caption/Carousel/
// Story cards (library/page.tsx) now open into this instead of being dead
// ends with only star-rating + copy.
export interface DetailBlock {
  /** e.g. "Slide 1", "Story 3 (hook)" -- omitted for a caption's single block. */
  label?: string
  text: string
  imageUrl?: string | null
}

export interface DetailItem {
  kind: "caption" | "carousel" | "story" | "ad_copy"
  title: string
  /** Rendered above the blocks, e.g. a carousel's own title or a story's topic. */
  subtitle?: string | null
  blocks: DetailBlock[]
  hashtags: string[]
  createdAt: string
  /** Full-caption text handed to ScheduleAction and the "Copy all" button --
   * usually blocks joined together, but callers can pass something more
   * curated (e.g. a carousel's cover_hook instead of every slide's text). */
  scheduleCaption: string
  /** Schedulable image(s), already hosted -- omitted (or empty) for content
   * with nothing to schedule (ad_copy, or a caption with no linked image
   * yet). A caption schedules its single most recent image; a carousel/
   * story schedules all of its persisted slide images together. */
  scheduleImageUrl?: string | null
  scheduleImageUrls?: string[]
}

interface ContentDetailPanelProps {
  item: DetailItem | null
  onClose: () => void
  brandId: string
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

const KIND_LABEL: Record<DetailItem["kind"], string> = {
  caption: "Caption",
  carousel: "Carousel",
  story: "Story sequence",
  ad_copy: "Ad copy",
}

export function ContentDetailPanel({ item, onClose, brandId }: ContentDetailPanelProps) {
  return (
    <>
      {item && (
        <div
          className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <div
        className={`fixed right-0 top-0 z-50 h-full w-full max-w-[440px] overflow-hidden border-l bg-card shadow-2xl transition-transform duration-300 ease-in-out ${
          item ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {item && (
          <div className="flex h-full flex-col">
            <div className="flex items-start justify-between gap-3 border-b p-5 shrink-0">
              <div className="min-w-0 flex-1">
                <span className="mb-1 inline-block rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {KIND_LABEL[item.kind]}
                </span>
                <h3 className="font-semibold leading-snug">{item.title}</h3>
                {item.subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{item.subtitle}</p>}
                <p className="mt-0.5 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleDateString()}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {item.blocks.map((block, i) => (
                <div key={i} className="space-y-2">
                  {block.label && (
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{block.label}</p>
                  )}
                  {block.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={block.imageUrl}
                      alt=""
                      className="w-full rounded-lg border object-cover"
                      style={{ maxHeight: 320 }}
                    />
                  )}
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{block.text}</p>
                </div>
              ))}

              {item.hashtags.length > 0 && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hashtags</p>
                    <CopyButton
                      getText={() => item.hashtags.map((h) => `#${h.replace(/^#+/, "")}`).join(" ")}
                      label="Copy all"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {item.hashtags.map((tag) => (
                      <span key={tag} className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-foreground/80">
                        #{tag.replace(/^#+/, "")}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="shrink-0 border-t p-5 space-y-3">
              <CopyButton
                getText={() => [item.scheduleCaption, item.hashtags.map((h) => `#${h.replace(/^#+/, "")}`).join(" ")].filter(Boolean).join("\n\n")}
                label="Copy full content"
              />
              {item.scheduleImageUrl && (
                <ScheduleAction
                  brandId={brandId}
                  imageUrl={item.scheduleImageUrl}
                  caption={item.scheduleCaption}
                  hashtags={item.hashtags}
                />
              )}
              {!item.scheduleImageUrl && item.scheduleImageUrls && item.scheduleImageUrls.length > 0 && (
                <ScheduleAction
                  brandId={brandId}
                  imageUrls={item.scheduleImageUrls}
                  contentFormat={item.kind === "story" ? "story" : "carousel"}
                  itemLabel={item.kind === "story" ? "story" : "slide"}
                  caption={item.scheduleCaption}
                  hashtags={item.hashtags}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
