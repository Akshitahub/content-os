"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2, AlertCircle } from "lucide-react"

const MESSAGES = [
  "Fetching your website…",
  "Reading your brand story…",
  "Detecting your tone of voice…",
  "Understanding your audience…",
  "Building your brand profile…",
  "Identifying your content style…",
  "Almost there…",
]

export default function AnalyzingPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const url = searchParams.get("url") ?? ""

  const [msgIndex, setMsgIndex] = useState(0)
  const [error, setError] = useState("")
  const [progress, setProgress] = useState(5)

  useEffect(() => {
    if (!url) {
      router.replace("/onboarding/brand-setup")
      return
    }

    const msgTimer = setInterval(() => {
      setMsgIndex(i => Math.min(i + 1, MESSAGES.length - 1))
      setProgress(p => Math.min(p + 12, 90))
    }, 1800)

    let cancelled = false

    async function runImport() {
      try {
        const res = await fetch("/api/v1/brands/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        })
        const json = await res.json() as { data?: { id: string }; error?: { message: string }; scrape_failed?: boolean; message?: string }
        if (cancelled) return

        if (json.scrape_failed) {
          clearInterval(msgTimer)
          const msg = json.message ?? "We couldn't access this website automatically."
          router.replace(`/onboarding/brand-setup?scrape_failed=1&msg=${encodeURIComponent(msg)}`)
          return
        }

        if (!res.ok || !json.data?.id) {
          const msg = json.error?.message ?? "Couldn't analyse that URL. Try your homepage."
          setError(msg)
          clearInterval(msgTimer)
          return
        }

        setProgress(100)
        clearInterval(msgTimer)
        await new Promise(r => setTimeout(r, 600))
        router.push(`/onboarding/brand-profile?brandId=${json.data.id}`)
      } catch {
        if (!cancelled) {
          setError("Network error. Please check your connection and try again.")
          clearInterval(msgTimer)
        }
      }
    }

    runImport()
    return () => {
      cancelled = true
      clearInterval(msgTimer)
    }
  }, [url, router])

  if (error) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/20">
          <AlertCircle className="h-7 w-7 text-red-400" />
        </div>
        <h2 className="text-xl font-bold text-white">Couldn&apos;t read that URL</h2>
        <p className="mt-2 text-sm text-gray-400">{error}</p>
        <button
          onClick={() => router.back()}
          className="mt-6 rounded-full border border-white/20 px-6 py-2.5 text-sm font-semibold text-white hover:bg-white/5 transition-colors"
        >
          Try a different URL
        </button>
      </div>
    )
  }

  return (
    <div className="text-center">
      <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-600/20 border border-violet-500/30">
        <Loader2 className="h-7 w-7 text-violet-400 animate-spin" />
      </div>

      <h2 className="text-xl font-bold text-white">Analysing your brand…</h2>
      <p className="mt-2 text-sm text-gray-400 h-5 transition-all">{MESSAGES[msgIndex]}</p>

      <div className="mx-auto mt-8 max-w-sm">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-violet-500 via-indigo-500 to-violet-600 transition-all duration-700"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mt-3 text-xs text-gray-600 truncate">{url}</p>
      </div>
    </div>
  )
}
