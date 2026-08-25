"use client"

import { Heart, MessageCircle, Send, Bookmark, ThumbsUp, Repeat2, MoreHorizontal, ImageIcon } from "lucide-react"
import { useBrand } from "@/hooks/useBrand"

// Every platform value this app actually schedules/publishes to today
// (CalendarEntryPanel.tsx's AUTO_PUBLISH_PLATFORMS, ScheduleAction's
// platform picker) -- only instagram and linkedin have a real frame built
// so far; everything else deliberately falls through to the plain,
// unframed preview (today's exact behavior) rather than blocking on all
// seven being built at once. facebook/threads/pinterest/twitter/youtube
// are the clear, scoped follow-up.
type FramedPlatform = "instagram" | "linkedin"

const FRAMED_PLATFORMS = new Set<string>(["instagram", "linkedin"])

function isFramedPlatform(platform: string | null | undefined): platform is FramedPlatform {
  return !!platform && FRAMED_PLATFORMS.has(platform)
}

function BrandAvatar({ logoUrl, name }: { logoUrl: string | null | undefined; name: string }) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logoUrl} alt={name} className="h-8 w-8 shrink-0 rounded-full object-cover" />
    )
  }
  // Neutral placeholder -- not an initial-based avatar, which would read
  // as a real (if generic) brand mark rather than "no logo set."
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <ImageIcon className="h-4 w-4" />
    </div>
  )
}

interface PlatformPreviewFrameProps {
  brandId: string
  platform: string | null | undefined
  /** The generated image, or the scaled carousel iframe wrapper -- passed
   * through unchanged; this component only wraps it in chrome. */
  children: React.ReactNode
  /** Shown under the image in the Instagram frame only, with the brand
   * name bolded at the start (Instagram's real post layout convention).
   * Omitted entirely (no empty line) when not provided. */
  caption?: string | null
}

/**
 * Wraps a generated image or carousel preview in platform-appropriate mock
 * app chrome -- purely decorative/read-only, so a preview reads as "this is
 * roughly what this will look like on Instagram/LinkedIn" instead of just
 * a bare image with no app context. No real interactivity, no fake
 * engagement counts on any icon -- nothing here should look like real data
 * that isn't real.
 */
export function PlatformPreviewFrame({ brandId, platform, children, caption }: PlatformPreviewFrameProps) {
  const { data: brand } = useBrand(brandId)
  const brandName = brand?.name ?? "Your brand"

  if (!isFramedPlatform(platform)) {
    // "Today's exact behavior" -- every caller used to put its own
    // rounded-lg + border directly on the image/iframe wrapper; that
    // styling was moved here (both branches need to own it consistently,
    // since the framed branches below apply it to the outer card instead
    // of the bare image) rather than each caller re-declaring it.
    return <div className="overflow-hidden rounded-lg border">{children}</div>
  }

  if (platform === "instagram") {
    return (
      <div className="w-full max-w-[300px] overflow-hidden rounded-lg border bg-card">
        <div className="flex items-center gap-2 p-2.5">
          <BrandAvatar logoUrl={brand?.logo_url} name={brandName} />
          <span className="flex-1 truncate text-xs font-semibold">{brandName}</span>
          <MoreHorizontal className="h-4 w-4 shrink-0 text-foreground/70" />
        </div>
        <div className="bg-black/5">{children}</div>
        <div className="flex items-center gap-3 px-2.5 pt-2">
          <Heart className="h-5 w-5 text-foreground/80" />
          <MessageCircle className="h-5 w-5 text-foreground/80" />
          <Send className="h-5 w-5 text-foreground/80" />
          <Bookmark className="ml-auto h-5 w-5 text-foreground/80" />
        </div>
        {caption && (
          <p className="px-2.5 pb-2.5 pt-1.5 text-xs leading-snug text-foreground/90">
            <span className="font-semibold">{brandName}</span> {caption}
          </p>
        )}
      </div>
    )
  }

  // linkedin
  return (
    <div className="w-full max-w-[300px] overflow-hidden rounded-lg border bg-card">
      <div className="flex items-start gap-2 p-2.5">
        <BrandAvatar logoUrl={brand?.logo_url} name={brandName} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">{brandName}</p>
          {brand?.niche && <p className="truncate text-[11px] text-muted-foreground">{brand.niche}</p>}
          <p className="text-[11px] text-muted-foreground">Now</p>
        </div>
      </div>
      <div className="bg-black/5">{children}</div>
      <div className="flex items-center justify-between px-2.5 py-2">
        <ThumbsUp className="h-4 w-4 text-foreground/70" />
        <MessageCircle className="h-4 w-4 text-foreground/70" />
        <Repeat2 className="h-4 w-4 text-foreground/70" />
        <Send className="h-4 w-4 text-foreground/70" />
      </div>
    </div>
  )
}
