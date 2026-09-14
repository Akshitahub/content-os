"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

/**
 * Renders nothing -- fires a genuine independent browser-initiated
 * request to /api/v1/dashboard/generate-daily-draft AFTER the dashboard
 * page has already rendered and been sent to the browser, so it is never
 * subject to the server-render timeout. On success, router.refresh() lets
 * the hero pick up the real draft in place if the user is still on the
 * page; if they've navigated away or closed the tab, the fetch may get
 * cancelled by the browser, which is fine -- their next visit,
 * getCachedDailyDraft simply misses again and this retries. A full draft
 * may not appear until a second visit or a refresh -- that's the correct,
 * honest tradeoff for not blocking the page render on a 10-30s+
 * generation, not a bug.
 */
export function DailyDraftTrigger({ brandId, hasDraft }: { brandId: string; hasDraft: boolean }) {
  const router = useRouter()

  useEffect(() => {
    if (hasDraft) return
    fetch("/api/v1/dashboard/generate-daily-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brandId }),
    })
      .then((res) => { if (res.ok) router.refresh() })
      .catch(() => {})
  }, [brandId, hasDraft, router])

  return null
}
