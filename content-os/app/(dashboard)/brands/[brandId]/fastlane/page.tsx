"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { Loader2, CheckCircle2, XCircle, Calendar, BarChart2, AlertTriangle, Trash2, Plane } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import posthog from "posthog-js"
import { POSTHOG_KEY } from "@/lib/analytics/posthog"
import type { FastlaneResult } from "@/types/app"

type AutopilotState = "SETUP" | "RUNNING" | "DONE" | "ERROR" | "WARNING" | "UPSELL"

interface WarningData {
  message: string
  existing_count: number
}

interface UpsellData {
  remainingCredits: number
  plan: string
  creditsNeeded: number
}

const FREQUENCY_OPTIONS = [
  { id: "3x_week", label: "3×/week", sub: "~13 posts" },
  { id: "5x_week", label: "5×/week", sub: "~22 posts" },
  { id: "daily", label: "Daily", sub: "30 posts" },
] as const

const PLATFORM_OPTIONS = [
  { id: "instagram", label: "Instagram", emoji: "📸" },
  { id: "tiktok", label: "TikTok", emoji: "🎵" },
  { id: "linkedin", label: "LinkedIn", emoji: "💼" },
  { id: "facebook", label: "Facebook", emoji: "👥" },
  { id: "youtube", label: "YouTube", emoji: "▶️" },
  { id: "twitter", label: "Twitter / X", emoji: "🐦" },
]

const VIBE_OPTIONS = [
  { id: "educational", label: "Educational", emoji: "📚" },
  { id: "entertaining", label: "Entertaining", emoji: "🎭" },
  { id: "inspirational", label: "Inspirational", emoji: "✨" },
  { id: "sales", label: "Sales-focused", emoji: "💰" },
  { id: "community", label: "Community", emoji: "🤝" },
]

const FOCUS_AREAS = [
  { id: "product", label: "Product showcase" },
  { id: "behind_scenes", label: "Behind the scenes" },
  { id: "educational", label: "Tips & education" },
  { id: "humor_meme", label: "Humor & memes" },
  { id: "occasion", label: "Occasions & trends" },
  { id: "testimonial", label: "Customer stories" },
  { id: "announcement", label: "Announcements" },
  { id: "inspiration", label: "Inspiration" },
  { id: "founder_story", label: "Founder story" },
]

export default function AutopilotPage() {
  const params = useParams()
  const brandId = params.brandId as string

  const [state, setState] = useState<AutopilotState>("SETUP")
  const [result, setResult] = useState<FastlaneResult | null>(null)
  const [errorMsg, setErrorMsg] = useState<string>("")
  const [warning, setWarning] = useState<WarningData | null>(null)
  const [upsellData, setUpsellData] = useState<UpsellData | null>(null)
  const [userCredits, setUserCredits] = useState<number | null>(null)
  const [progress, setProgress] = useState(0)

  // Fetch remaining credits for the indicator
  useEffect(() => {
    fetch("/api/v1/user/profile")
      .then(r => r.json())
      .then((json: { data?: { remaining: number } }) => {
        if (json.data?.remaining !== undefined) setUserCredits(json.data.remaining)
      })
      .catch(() => {})
  }, [])

  // Setup form state
  const [frequency, setFrequency] = useState<"3x_week" | "5x_week" | "daily">("daily")
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(["instagram"])
  const [vibe, setVibe] = useState<string>("educational")
  const [focusAreas, setFocusAreas] = useState<string[]>([])

  useEffect(() => {
    if (state === "RUNNING") {
      setProgress(0)
      const interval = setInterval(() => {
        setProgress((p) => p < 92 ? p + 3 : p)
      }, 2000)
      return () => clearInterval(interval)
    }
    if (state === "DONE") setProgress(100)
  }, [state])

  function togglePlatform(id: string) {
    setSelectedPlatforms(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    )
  }

  function toggleFocusArea(id: string) {
    setFocusAreas(prev =>
      prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
    )
  }

  async function runAutopilot(opts: { force?: boolean; clearAndRegenerate?: boolean } = {}) {
    if (selectedPlatforms.length === 0) {
      setSelectedPlatforms(["instagram"])
    }

    setState("RUNNING")
    setResult(null)
    setErrorMsg("")
    setWarning(null)

    try {
      const res = await fetch("/api/v1/brands/fastlane", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          frequency,
          platforms: selectedPlatforms.length > 0 ? selectedPlatforms : ["instagram"],
          vibe,
          focusAreas,
          ...opts,
        }),
      })

      const json = await res.json() as {
        data?: FastlaneResult
        error?: { message?: string; code?: string }
        warning?: boolean
        message?: string
        existing_count?: number
        remaining_credits?: number
        plan?: string
        credits_needed?: number
      }

      // Credits insufficient — show upsell instead of generic error
      if (json.remaining_credits !== undefined) {
        setUpsellData({
          remainingCredits: json.remaining_credits,
          plan: json.plan ?? "free",
          creditsNeeded: json.credits_needed ?? 30,
        })
        setState("UPSELL")
        return
      }

      if (json.warning) {
        setWarning({ message: json.message ?? "", existing_count: json.existing_count ?? 0 })
        setState("WARNING")
        return
      }

      if (!res.ok) {
        throw new Error(json.error?.message ?? "Autopilot failed")
      }

      setResult(json.data ?? null)
      setState("DONE")
      try {
        if (POSTHOG_KEY) posthog.capture("autopilot_completed", {
          brand_id: brandId,
          calendar_entries: json.data?.calendar_entries_created ?? 0,
          frequency,
          vibe,
        })
      } catch {}
    } catch (err) {
      const msg = err instanceof Error ? err.message : "An unexpected error occurred"
      setErrorMsg(msg)
      setState("ERROR")
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-6 md:p-8">

      {/* SETUP */}
      {state === "SETUP" && (
        <div className="w-full max-w-2xl">
          <div className="text-center mb-8">
            <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 shadow-lg shadow-violet-200">
              <Plane className="h-10 w-10 text-white" />
            </div>
            <h1 className="text-4xl font-bold tracking-tight">Autopilot</h1>
            <p className="mt-3 text-muted-foreground max-w-md mx-auto">
              Generate a complete 30-day content calendar tailored to how you create. Set your preferences and let AI do the rest.
            </p>
          </div>

          <div className="space-y-6">
            {/* Frequency */}
            <div>
              <p className="mb-2 text-sm font-semibold">How often do you post?</p>
              <div className="flex gap-3">
                {FREQUENCY_OPTIONS.map(f => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFrequency(f.id)}
                    className={`flex-1 rounded-xl border-2 px-4 py-3 text-center transition-all duration-150 ${
                      frequency === f.id
                        ? "border-violet-500 bg-violet-50 text-violet-700"
                        : "border-border bg-card hover:border-violet-300"
                    }`}
                  >
                    <p className="font-semibold">{f.label}</p>
                    <p className="text-xs text-muted-foreground">{f.sub}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Platforms */}
            <div>
              <p className="mb-2 text-sm font-semibold">Which platforms do you post on?</p>
              <div className="flex flex-wrap gap-2">
                {PLATFORM_OPTIONS.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => togglePlatform(p.id)}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-all duration-150 ${
                      selectedPlatforms.includes(p.id)
                        ? "border-violet-500 bg-violet-50 text-violet-700 font-medium"
                        : "border-border hover:border-violet-300"
                    }`}
                  >
                    <span>{p.emoji}</span>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Vibe */}
            <div>
              <p className="mb-2 text-sm font-semibold">What&apos;s your content vibe?</p>
              <div className="flex flex-wrap gap-2">
                {VIBE_OPTIONS.map(v => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setVibe(v.id)}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-all duration-150 ${
                      vibe === v.id
                        ? "border-violet-500 bg-violet-50 text-violet-700 font-medium"
                        : "border-border hover:border-violet-300"
                    }`}
                  >
                    <span>{v.emoji}</span>
                    {v.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Focus areas */}
            <div>
              <p className="mb-1 text-sm font-semibold">Focus areas <span className="text-muted-foreground font-normal">(optional — select what you want more of)</span></p>
              <div className="flex flex-wrap gap-2">
                {FOCUS_AREAS.map(fa => (
                  <button
                    key={fa.id}
                    type="button"
                    onClick={() => toggleFocusArea(fa.id)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition-all duration-150 ${
                      focusAreas.includes(fa.id)
                        ? "border-violet-500 bg-violet-50 text-violet-700 font-medium"
                        : "border-border hover:border-violet-300"
                    }`}
                  >
                    {fa.label}
                  </button>
                ))}
              </div>
            </div>

            {/* CTA */}
            <div className="pt-2 space-y-3">
              {/* Credit indicator */}
              {userCredits !== null && (
                <div className={`rounded-lg px-4 py-2.5 text-sm ${userCredits >= 30 ? "bg-green-50 text-green-700 border border-green-200" : "bg-amber-50 text-amber-700 border border-amber-200"}`}>
                  ⚡ Autopilot uses 30 credits. You have <strong>{userCredits}</strong> remaining.
                </div>
              )}
              <Button
                size="lg"
                className="w-full gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700 shadow-md"
                onClick={() => runAutopilot()}
              >
                <Plane className="h-5 w-5" />
                Launch Autopilot
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Uses 30 generation credits · Adds 30 entries to your content calendar
              </p>
            </div>
          </div>
        </div>
      )}

      {/* WARNING — existing content detected */}
      {state === "WARNING" && warning && (
        <div className="w-full max-w-lg">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-amber-100 shadow-lg">
            <AlertTriangle className="h-10 w-10 text-amber-600" />
          </div>
          <h2 className="text-center text-2xl font-bold">You already have content planned</h2>
          <p className="mt-2 text-center text-muted-foreground">
            You have <strong>{warning.existing_count} posts</strong> scheduled for the next 30 days.
            Running Autopilot again will add more entries on top.
          </p>

          <div className="mt-8 space-y-3">
            <Button className="w-full gap-2" onClick={() => runAutopilot({ force: true })}>
              <Plane className="h-4 w-4" />
              Add more anyway →
            </Button>

            <Button
              variant="outline"
              className="w-full gap-2 border-destructive/30 text-destructive hover:bg-destructive/5"
              onClick={() => runAutopilot({ clearAndRegenerate: true })}
            >
              <Trash2 className="h-4 w-4" />
              Clear calendar and regenerate fresh
            </Button>

            <Button variant="ghost" className="w-full" onClick={() => setState("SETUP")}>
              Cancel
            </Button>
          </div>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            "Clear and regenerate" deletes all upcoming calendar entries and creates a fresh 30-day plan.
          </p>
        </div>
      )}

      {/* RUNNING */}
      {state === "RUNNING" && (
        <div className="w-full max-w-lg text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 shadow-lg shadow-violet-200">
            <Loader2 className="h-10 w-10 text-white animate-spin" />
          </div>
          <h2 className="text-2xl font-bold">Building your 30-day plan…</h2>
          <p className="mt-2 text-muted-foreground">
            AI is crafting your content strategy and generating all 30 slots. This takes 1–3 minutes.
          </p>

          {/* Animated gradient progress bar */}
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">
                {progress < 10
                  ? "Analysing your brand…"
                  : progress < 20
                  ? "Building content strategy…"
                  : progress < 92
                  ? `Generating slot ${Math.ceil(((progress - 20) / 72) * 30)} of 30…`
                  : "Saving to calendar…"}
              </span>
              <span className="text-xs font-medium text-violet-600">{progress}%</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-500 via-indigo-500 to-violet-600 transition-all duration-1000 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">Powered by Groq AI</p>
          </div>

          <div className="mt-6 space-y-2 text-left">
            {[
              { text: "Analysing your brand and products", done: progress >= 10 },
              { text: "Generating personalised content strategy", done: progress >= 20 },
              { text: `Creating 30 content slots (${Math.min(30, Math.ceil(((progress - 20) / 72) * 30))} / 30)`, done: progress >= 92 },
              { text: "Saving to your calendar", done: progress >= 100 },
            ].map(({ text, done }, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
                {done
                  ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                  : <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-500" />}
                <p className={`text-sm ${done ? "text-foreground font-medium" : "text-muted-foreground"}`}>{text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* DONE */}
      {state === "DONE" && result && (
        <div className="w-full max-w-lg text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 shadow-lg">
            <CheckCircle2 className="h-10 w-10 text-white" />
          </div>
          <h2 className="text-3xl font-bold">You&apos;re on Autopilot!</h2>
          <p className="mt-2 text-muted-foreground">Your 30-day content plan is ready and waiting in your calendar.</p>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              { label: "Slots planned", value: result.slots_planned },
              { label: "Content generated", value: result.slots_generated },
              { label: "Calendar entries", value: result.calendar_entries_created },
            ].map(({ label, value }) => (
              <Card key={label}>
                <CardContent className="pt-4 text-center">
                  <p className="text-3xl font-bold text-violet-600">{value}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Content breakdown summary */}
          <Card className="mt-4 text-left">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Your content mix</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: "Product posts", count: 5, color: "bg-violet-100 text-violet-700" },
                  { label: "Behind scenes", count: 4, color: "bg-indigo-100 text-indigo-700" },
                  { label: "Education", count: 4, color: "bg-blue-100 text-blue-700" },
                  { label: "Occasions", count: 4, color: "bg-orange-100 text-orange-700" },
                  { label: "Testimonials", count: 3, color: "bg-green-100 text-green-700" },
                  { label: "Humor", count: 3, color: "bg-yellow-100 text-yellow-700" },
                  { label: "Announcements", count: 3, color: "bg-pink-100 text-pink-700" },
                  { label: "Founder story", count: 2, color: "bg-purple-100 text-purple-700" },
                  { label: "Inspiration", count: 2, color: "bg-teal-100 text-teal-700" },
                ].map(({ label, count, color }) => (
                  <span key={label} className={`rounded-full px-2.5 py-1 text-xs font-medium ${color}`}>
                    {label} ×{count}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>

          {result.strategy_summary && (
            <Card className="mt-4 text-left">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Strategy overview</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{result.strategy_summary}</p>
              </CardContent>
            </Card>
          )}

          {result.errors.length > 0 && (
            <Card className="mt-4 text-left border-yellow-200 bg-yellow-50">
              <CardHeader><CardTitle className="text-sm text-yellow-800">{result.errors.length} slot(s) failed</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-1">
                  {result.errors.map((e, i) => (
                    <li key={i} className="text-xs text-yellow-700">{e}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button asChild className="flex-1">
              <Link href={`/brands/${brandId}/calendar`}>
                <Calendar className="mr-2 h-4 w-4" />
                View calendar
              </Link>
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => setState("SETUP")}>
              <BarChart2 className="mr-2 h-4 w-4" />
              Run again
            </Button>
          </div>
        </div>
      )}

      {/* ERROR */}
      {state === "ERROR" && (
        <div className="w-full max-w-lg text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-destructive shadow-lg">
            <XCircle className="h-10 w-10 text-destructive-foreground" />
          </div>
          <h2 className="text-2xl font-bold">Something went wrong</h2>
          <p className="mt-2 text-muted-foreground">{errorMsg || "Autopilot failed. Please try again."}</p>

          <Button className="mt-8 w-full" variant="outline" onClick={() => setState("SETUP")}>
            Try again
          </Button>
        </div>
      )}

      {/* UPSELL — not enough credits */}
      {state === "UPSELL" && upsellData && (
        <div className="w-full max-w-lg text-center space-y-4">
          <div className="text-5xl">⚡</div>
          <h2 className="text-xl font-bold">Unlock Autopilot</h2>
          <p className="text-muted-foreground text-sm max-w-sm mx-auto">
            Autopilot generates 30 days of content in one click.
            You have <strong>{upsellData.remainingCredits}</strong> credits left on your{" "}
            <strong>{upsellData.plan}</strong> plan.
          </p>
          <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-left space-y-2">
            <p className="font-semibold text-violet-900">Starter Plan — ₹999/month</p>
            <ul className="text-sm text-violet-700 space-y-1">
              <li>✓ 200 generations/month</li>
              <li>✓ Autopilot (30-day calendar)</li>
              <li>✓ All content types</li>
              <li>✓ Ad Maker</li>
            </ul>
          </div>
          <Link
            href="/settings"
            className="flex w-full items-center justify-center rounded-full bg-violet-600 py-3 text-sm font-semibold text-white hover:bg-violet-700 transition-colors"
          >
            Upgrade to Starter →
          </Link>
          <p className="text-xs text-muted-foreground">
            Or generate content individually on the free plan
          </p>
          <Button variant="ghost" className="w-full text-xs text-muted-foreground" onClick={() => setState("SETUP")}>
            ← Go back
          </Button>
        </div>
      )}
    </div>
  )
}
