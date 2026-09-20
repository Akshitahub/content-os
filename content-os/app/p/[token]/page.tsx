import type { Metadata } from "next"
import { cache } from "react"
import Link from "next/link"
import { createAdminClient } from "@/lib/supabase/server"
import { resolveShareContent, type ResolvedShareContent } from "@/lib/share/resolve-content"
import { resolveCarouselBgStyle } from "@/lib/design/carousel-slide-styles"

// Public, read-only, no-login preview page a "Copy preview link" URL
// resolves to -- looked up by token via the service-role client
// (createAdminClient), since there is no logged-in user here at all. See
// supabase/migrations/054_share_links.sql for the table this reads and
// hooks/useCopyPreviewLink.ts / the library card menus for where these
// links are minted.
//
// Deliberately outside proxy.ts's auth gate (see lib/supabase/middleware.ts's
// isDashboardRoute -- /p isn't one of the gated prefixes), so this needs no
// middleware changes to be public.

type PageProps = { params: Promise<{ token: string }> }

const PUBLIC_SHARE_BASE_URL = "https://www.socioposts.com"

interface ShareLinkLookupRow {
  id: string
  content_type: ResolvedShareContent["contentType"]
  content_id: string
  expires_at: string | null
  revoked_at: string | null
  view_count: number
}

// React's cache() dedupes this to exactly one execution per request even
// though both generateMetadata and the page component below call it --
// meaning the view_count bump inside it also only ever fires once per real
// page load, not twice.
const getSharePreview = cache(async (token: string): Promise<ResolvedShareContent | null> => {
  const admin = await createAdminClient()

  // share_links isn't in the generated Database type yet (see
  // lib/dashboard/get-or-create-daily-draft.ts's identical note for
  // daily_draft_cache) -- same `as any` convention.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: link } = await (admin.from("share_links") as any)
    .select("id, content_type, content_id, expires_at, revoked_at, view_count")
    .eq("token", token)
    .maybeSingle() as { data: ShareLinkLookupRow | null }

  // Not found, expired, or revoked all resolve to the exact same null here
  // -- resolveShareContent returning null for genuinely deleted content
  // joins the same bucket -- so the page can show one identical message
  // for every case and never leak which one it was.
  if (!link) return null
  if (link.revoked_at) return null
  if (link.expires_at && new Date(link.expires_at).getTime() <= Date.now()) return null

  const content = await resolveShareContent(admin, link.content_type, link.content_id)
  if (!content) return null

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("share_links") as any).update({ view_count: link.view_count + 1 }).eq("id", link.id)
  } catch (err) {
    // Best-effort -- a failed view-count bump should never break the
    // preview itself.
    console.error("[p/token] view_count increment failed (non-fatal):", err)
  }

  return content
})

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params
  const content = await getSharePreview(token)

  // Never indexed either way -- these are one-off share links, not content
  // meant to accumulate its own search presence.
  const robots = { index: false, follow: false }

  if (!content) {
    return { title: "Preview not available — SocioPosts", robots }
  }

  const title = `${content.brandName} — ${content.hook}`.slice(0, 90)
  const description = content.captionText.trim().slice(0, 150)
  const firstImageUrl = content.slides.find((s) => s.imageUrl)?.imageUrl ?? undefined
  const url = `${PUBLIC_SHARE_BASE_URL}/p/${token}`

  return {
    title,
    description,
    robots,
    openGraph: {
      title,
      description,
      url,
      images: firstImageUrl ? [{ url: firstImageUrl, width: 1200 }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: firstImageUrl ? [firstImageUrl] : undefined,
    },
  }
}

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  twitter: "X (Twitter)",
  threads: "Threads",
  pinterest: "Pinterest",
}

// Same "This preview link is no longer available" message for every
// failure case (not found, expired, revoked, or the underlying content
// having since been deleted) -- so nothing about which case it was ever
// leaks to the viewer.
function NotAvailable() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-gray-50 px-6 text-center">
      <p className="text-lg font-semibold text-gray-900">This preview link is no longer available.</p>
      <p className="max-w-sm text-sm text-gray-500">It may have expired, been disabled by its owner, or the content it pointed to may no longer exist.</p>
      <Link href={PUBLIC_SHARE_BASE_URL} className="mt-3 text-sm font-medium text-violet-600 hover:text-violet-700">
        Go to SocioPosts →
      </Link>
    </div>
  )
}

function SlideVisual({ slide, aspectRatio }: { slide: ResolvedShareContent["slides"][number]; aspectRatio: "4:5" | "9:16" }) {
  const aspectClass = aspectRatio === "9:16" ? "aspect-[9/16]" : "aspect-[4/5]"
  if (slide.imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={slide.imageUrl} alt="" className={`w-full ${aspectClass} shrink-0 rounded-xl object-cover`} />
    )
  }
  // No AI-generated photo for this slide (e.g. a carousel body slide, or a
  // custom-color background) -- a tasteful placeholder rather than a blank
  // box. The full text is already shown below as "full caption", so this
  // deliberately doesn't try to reconstruct per-slide headline/subtext
  // overlays -- keeps this public page simple, matching "mobile-first,
  // clean, minimal" over pixel-faithfully recreating the editor preview.
  const custom = slide.customBackgroundColors?.length
    ? { background: slide.customBackgroundColors.length === 1 ? slide.customBackgroundColors[0] : `linear-gradient(135deg, ${slide.customBackgroundColors.join(", ")})` }
    : undefined
  const fallback = resolveCarouselBgStyle(slide.backgroundStyle)
  return (
    <div
      className={`flex w-full ${aspectClass} shrink-0 items-center justify-center rounded-xl ${custom ? "" : fallback.bg}`}
      style={custom}
    />
  )
}

function PreviewBody({ content }: { content: ResolvedShareContent }) {
  const platformLabel = content.platform ? (PLATFORM_LABELS[content.platform] ?? content.platform) : null

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-md px-4 py-6 sm:py-10">
        <div className="mb-4 flex items-center gap-2.5">
          {content.brandLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={content.brandLogoUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-100 text-sm font-semibold text-violet-700">
              {content.brandName.charAt(0).toUpperCase()}
            </div>
          )}
          <p className="truncate text-sm font-semibold text-gray-900">{content.brandName}</p>
        </div>

        {content.slides.length > 0 && (
          <div className="mb-4 -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
            {content.slides.map((slide, i) => (
              <div key={i} className="w-[85%] shrink-0 sm:w-full">
                <SlideVisual slide={slide} aspectRatio={content.aspectRatio} />
              </div>
            ))}
          </div>
        )}

        <div className="mb-3 flex items-center gap-2">
          {platformLabel && (
            <span className="rounded-full bg-gray-900/5 px-2.5 py-1 text-xs font-medium text-gray-600">{platformLabel}</span>
          )}
          <span className="rounded-full bg-gray-900/5 px-2.5 py-1 text-xs font-medium text-gray-600">{content.aspectRatio}</span>
        </div>

        <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">{content.captionText}</p>

        {content.hashtags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {content.hashtags.map((tag) => (
              <span key={tag} className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs text-violet-700">
                #{tag.replace(/^#+/, "")}
              </span>
            ))}
          </div>
        )}

        <div className="mt-10 border-t pt-4 text-center">
          <Link href={PUBLIC_SHARE_BASE_URL} className="text-xs font-medium text-gray-400 hover:text-gray-600">
            Made with SocioPosts
          </Link>
        </div>
      </div>
    </div>
  )
}

export default async function SharePreviewPage({ params }: PageProps) {
  const { token } = await params
  const content = await getSharePreview(token)
  if (!content) return <NotAvailable />
  return <PreviewBody content={content} />
}
