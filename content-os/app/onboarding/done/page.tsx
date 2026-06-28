"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowRight, Loader2, CheckCircle2 } from "lucide-react"

export default function DonePage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const brandId = searchParams.get("brandId") ?? ""

  const [done, setDone] = useState(false)

  useEffect(() => {
    fetch("/api/v1/onboarding/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brandId }) })
      .catch(() => {})
      .finally(() => setDone(true))
  }, [brandId])

  function goToDashboard() {
    router.push(brandId ? `/brands/${brandId}/generate` : "/dashboard")
  }

  return (
    <div className="text-center py-8">
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/20 border border-emerald-500/30">
        <CheckCircle2 className="h-8 w-8 text-emerald-400" />
      </div>

      <h1 className="text-3xl font-bold text-white sm:text-4xl">You&apos;re all set!</h1>
      <p className="mt-3 text-gray-400 text-base max-w-md mx-auto">
        Your brand is ready. Start generating hooks, captions, reels, and 30-day content plans — all in your exact brand voice.
      </p>

      <div className="mt-10 grid gap-3 sm:grid-cols-3 text-left">
        {[
          { emoji: "⚡", label: "Generate hooks", desc: "Scroll-stopping openers for any post" },
          { emoji: "✈️", label: "Run Autopilot", desc: "Get 30 days of content in one click" },
          { emoji: "🎬", label: "Write reel scripts", desc: "Full voiceover scripts, ready to record" },
        ].map(({ emoji, label, desc }) => (
          <div key={label} className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="mb-2 text-2xl">{emoji}</div>
            <p className="text-sm font-semibold text-white">{label}</p>
            <p className="mt-0.5 text-xs text-gray-500">{desc}</p>
          </div>
        ))}
      </div>

      <div className="mt-10">
        {done ? (
          <button onClick={goToDashboard}
            className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-8 py-3.5 text-sm font-semibold text-white transition-all hover:bg-violet-700 hover:scale-[1.02]">
            Start creating content <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Finishing setup…
          </div>
        )}
      </div>
    </div>
  )
}
