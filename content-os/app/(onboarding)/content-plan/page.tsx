"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowRight, Loader2 } from "lucide-react"

const FREQUENCIES = [
  { id: "3x_week", label: "3× a week", desc: "Consistent without burnout" },
  { id: "5x_week", label: "5× a week", desc: "High-growth mode" },
  { id: "daily", label: "Daily", desc: "Maximum reach" },
]

const PLATFORMS = [
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "twitter", label: "X / Twitter" },
]

const GOALS = [
  { id: "brand_awareness", label: "Build brand awareness" },
  { id: "sales", label: "Drive sales & conversions" },
  { id: "community", label: "Grow community & followers" },
  { id: "engagement", label: "Boost engagement" },
]

export default function ContentPlanPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const brandId = searchParams.get("brandId") ?? ""

  const [frequency, setFrequency] = useState("3x_week")
  const [platforms, setPlatforms] = useState<string[]>(["instagram"])
  const [goal, setGoal] = useState("brand_awareness")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  function togglePlatform(id: string) {
    setPlatforms(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!brandId || platforms.length === 0) return
    setSaving(true)
    setError("")

    try {
      const res = await fetch(`/api/v1/brands/${brandId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          posting_frequency: frequency,
          target_platforms: platforms,
          onboarding_type: goal,
        }),
      })
      if (!res.ok) {
        const json = await res.json() as { error?: { message: string } }
        setError(json.error?.message ?? "Failed to save preferences.")
        setSaving(false)
        return
      }
      router.push(`/onboarding/done?brandId=${brandId}`)
    } catch {
      setError("Network error. Please try again.")
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="mb-8">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-violet-400">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-600 text-white text-[10px]">3</span>
          Step 3 of 4
        </div>
        <h1 className="text-2xl font-bold text-white sm:text-3xl">Your content plan</h1>
        <p className="mt-2 text-sm text-gray-400">Tell us how you want to post and we&apos;ll build your Autopilot strategy.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Frequency */}
        <div>
          <p className="mb-3 text-sm font-semibold text-white">How often do you want to post?</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {FREQUENCIES.map(f => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFrequency(f.id)}
                className={`rounded-xl border-2 p-4 text-left transition-all ${
                  frequency === f.id
                    ? "border-violet-500 bg-violet-950/40"
                    : "border-white/10 bg-white/5 hover:border-white/20"
                }`}
              >
                <p className="text-sm font-semibold text-white">{f.label}</p>
                <p className="mt-0.5 text-xs text-gray-400">{f.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Platforms */}
        <div>
          <p className="mb-3 text-sm font-semibold text-white">Which platforms?</p>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => togglePlatform(p.id)}
                className={`rounded-full border px-4 py-2 text-sm transition-all ${
                  platforms.includes(p.id)
                    ? "border-violet-500 bg-violet-600/20 text-violet-300"
                    : "border-white/10 bg-white/5 text-gray-400 hover:border-white/20"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {platforms.length === 0 && (
            <p className="mt-2 text-xs text-red-400">Select at least one platform.</p>
          )}
        </div>

        {/* Goal */}
        <div>
          <p className="mb-3 text-sm font-semibold text-white">Your main goal?</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {GOALS.map(g => (
              <button
                key={g.id}
                type="button"
                onClick={() => setGoal(g.id)}
                className={`rounded-xl border-2 p-3 text-left transition-all ${
                  goal === g.id
                    ? "border-violet-500 bg-violet-950/40"
                    : "border-white/10 bg-white/5 hover:border-white/20"
                }`}
              >
                <p className="text-sm text-white">{g.label}</p>
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={saving || platforms.length === 0}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-violet-600 py-3.5 text-sm font-semibold text-white transition-all hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
          ) : (
            <>Save and continue <ArrowRight className="h-4 w-4" /></>
          )}
        </button>
      </form>
    </div>
  )
}
