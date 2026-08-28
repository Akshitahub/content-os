"use client"

import { X, Copy, Check } from "lucide-react"
import { useState } from "react"
import { ScheduleAction } from "@/components/shared/ScheduleAction"
import type { StoryExportSlide } from "@/lib/utils/story-export"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { PlatformPreviewFrame } from "@/components/shared/PlatformPreviewFrame"
import { resolveCarouselBgStyle } from "@/lib/design/carousel-slide-styles"
import { cssBackgroundFromColors } from "@/components/shared/ColorWheelPicker"

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
  /** Carousel body slides only -- only the hook/cta slides of a carousel
   * ever get a real AI-generated imageUrl (lib/ai/carousel-slide-background.ts
   * is never called for body slides by original design); everything else
   * gets a flat color/gradient background_style instead, which
   * CarouselBuilder.tsx renders live during editing but was previously
   * lost entirely once viewed again here (imageUrl falsy meant no visual
   * at all -- bare floating text). When imageUrl is absent and this is
   * set, the same flat treatment is reconstructed via
   * lib/design/carousel-slide-styles.ts's shared mapping. */
  backgroundStyle?: string | null
  /** Carousel or story slides using the "Custom color" mode (see
   * VibePicker/ColorWheelPicker) -- an exact user-picked flat/gradient,
   * genuinely different from backgroundStyle's named enum. Takes priority
   * over backgroundStyle when both happen to be present (only backgroundStyle
   * ever gets a real value automatically at generation time; this is only
   * ever set by an explicit user choice, so it wins). */
  customBackgroundColors?: string[] | null
}

export interface DetailItem {
  kind: "caption" | "carousel" | "story" | "ad_copy"
  title: string
  /** Rendered above the blocks, e.g. a carousel's own title or a story's topic. */
  subtitle?: string | null
  blocks: DetailBlock[]
  hashtags: string[]
  createdAt: string
  /** Threaded from the underlying row's own platform column (captions/
   * carousels/ad_copies all have one) so block image previews can wrap in
   * the right app chrome -- stories has no platform column of its own
   * (Instagram-only feature today), so callers pass "instagram" for it
   * directly rather than this being optional-and-usually-missing. */
  platform?: string | null
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
  /** Story-only: real slide data, rendered server-side via
   * lib/image/story-compositor.ts at schedule-confirm time instead of
   * scheduling the bare AI background photo (scheduleImageUrls' old
   * behavior for stories — no headline/subtext/CTA text at all). Takes
   * priority over scheduleImageUrls when both are present. */
  scheduleStorySlides?: StoryExportSlide[]
  /** Present only when this item can actually be deleted (every kind
   * today) -- throw to signal failure, DeleteConfirmButton shows the
   * error inline and lets the user retry. On success the panel closes
   * itself; the caller's own mutation is responsible for making the item
   * disappear from whatever list opened this panel (query invalidation). */
  onDelete?: () => Promise<void>
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

// Reconstructs the flat color/gradient a carousel body slide shows live
// during editing (CarouselBuilder.tsx's SlidePreview) for the case that
// component never has to handle itself: no real AI-generated image at
// all. Fixed height (not aspect-ratio) matches the effective rendered
// height of a real slide image right below (w-full + max-height: 320,
// object-cover) so blocks with and without a real image sit at the same
// size in the same list.
function CarouselFlatSlidePreview({
  text,
  backgroundStyle,
  customColors,
}: {
  text: string
  backgroundStyle: string | null | undefined
  /** "Custom color" mode (see ColorWheelPicker) -- an exact user pick,
   * takes priority over backgroundStyle's named enum when present. */
  customColors?: string[] | null
}) {
  const customBg = cssBackgroundFromColors(customColors)
  const s = resolveCarouselBgStyle(backgroundStyle)
  const [headline, ...rest] = text.split("\n")
  const body = rest.join("\n").trim()
  return (
    <div
      className={`flex w-full flex-col justify-center overflow-hidden p-6 ${customBg ? "" : s.bg}`}
      style={{ height: 320, background: customBg }}
    >
      {headline && <p className={`text-lg font-bold leading-snug line-clamp-3 ${customBg ? "text-white" : s.text}`}>{headline}</p>}
      {body && <p className={`mt-2 text-sm leading-relaxed line-clamp-4 ${customBg ? "text-white/70" : s.subtext}`}>{body}</p>}
    </div>
  )
}

const KIND_LABEL: Record<DetailItem["kind"], string> = {
  caption: "Caption",
  carousel: "Carousel",
  story: "Story sequence",
  ad_copy: "Ad copy",
}

export function ContentDetailPanel({ item, onClose, brandId }: ContentDetailPanelProps) {
  async function handleDelete() {
    if (!item?.onDelete) return
    await item.onDelete()
    onClose()
  }

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
                  {block.imageUrl ? (
                    <PlatformPreviewFrame brandId={brandId} platform={item.platform} caption={item.scheduleCaption}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={block.imageUrl}
                        alt=""
                        className="w-full object-cover"
                        style={{ maxHeight: 320 }}
                      />
                    </PlatformPreviewFrame>
                  ) : block.backgroundStyle || (block.customBackgroundColors && block.customBackgroundColors.length > 0) ? (
                    <PlatformPreviewFrame brandId={brandId} platform={item.platform} caption={item.scheduleCaption}>
                      <CarouselFlatSlidePreview text={block.text} backgroundStyle={block.backgroundStyle} customColors={block.customBackgroundColors} />
                    </PlatformPreviewFrame>
                  ) : null}
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
              {!item.scheduleImageUrl && item.scheduleStorySlides && item.scheduleStorySlides.length > 0 && (
                <ScheduleAction
                  brandId={brandId}
                  storySlides={item.scheduleStorySlides}
                  contentFormat="story"
                  itemLabel="story"
                  caption={item.scheduleCaption}
                  hashtags={item.hashtags}
                />
              )}
              {!item.scheduleImageUrl && !item.scheduleStorySlides && item.scheduleImageUrls && item.scheduleImageUrls.length > 0 && (
                <ScheduleAction
                  brandId={brandId}
                  imageUrls={item.scheduleImageUrls}
                  contentFormat={item.kind === "story" ? "story" : "carousel"}
                  itemLabel={item.kind === "story" ? "story" : "slide"}
                  caption={item.scheduleCaption}
                  hashtags={item.hashtags}
                />
              )}
              {item.onDelete && (
                <div className="border-t pt-3">
                  <DeleteConfirmButton onDelete={handleDelete} variant="text" />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
