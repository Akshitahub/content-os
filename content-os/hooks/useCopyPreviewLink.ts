"use client"

import { useCallback, useRef, useState } from "react"
import type { ShareContentType } from "@/lib/share/resolve-content"

export interface CopyPreviewLinkFeedback {
  type: "success" | "error"
  message: string
}

interface ShareApiSuccess {
  data: { url: string; expiresAt: string | null }
}

/**
 * The one place "Copy preview link" logic lives -- every menu that used to
 * have its own "Share to WhatsApp" wa.me link (library card menus for
 * caption/carousel/story/ad_copy, the dashboard's daily-draft card) calls
 * this instead of duplicating the fetch + clipboard + feedback dance.
 * POST /api/v1/share is idempotent (reuses an existing non-expired,
 * non-revoked link for the same content), so calling this repeatedly for
 * the same content is safe and cheap.
 */
export function useCopyPreviewLink() {
  const [isPending, setIsPending] = useState(false)
  const [feedback, setFeedback] = useState<CopyPreviewLinkFeedback | null>(null)
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showFeedback = useCallback((next: CopyPreviewLinkFeedback) => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    setFeedback(next)
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 3000)
  }, [])

  const copyPreviewLink = useCallback(async (brandId: string, contentType: ShareContentType, contentId: string) => {
    setIsPending(true)
    try {
      const res = await fetch("/api/v1/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, contentType, contentId }),
      })
      const json = await res.json()
      if (!res.ok || !json?.data?.url) {
        throw new Error(json?.error?.message || "Couldn't create the preview link. Please try again.")
      }
      const { url } = (json as ShareApiSuccess).data

      try {
        await navigator.clipboard.writeText(url)
        showFeedback({ type: "success", message: "Preview link copied" })
      } catch {
        // Clipboard API unavailable or permission denied (e.g. insecure
        // context, some in-app browsers) -- fall back to a manual-copy
        // prompt instead of silently failing with no way to get the link.
        window.prompt("Copy this preview link:", url)
        showFeedback({ type: "success", message: "Preview link ready — copy it above" })
      }
    } catch (err) {
      showFeedback({ type: "error", message: err instanceof Error ? err.message : "Couldn't create the preview link." })
    } finally {
      setIsPending(false)
    }
  }, [showFeedback])

  return { copyPreviewLink, isPending, feedback }
}
