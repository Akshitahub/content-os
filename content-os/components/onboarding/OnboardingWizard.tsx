"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Globe, Loader2, CheckCircle2, ArrowRight, Zap, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import Link from "next/link"
import posthog from "posthog-js"
import { POSTHOG_KEY } from "@/lib/analytics/posthog"
import type { BrandRow } from "@/types/database"
import type { FastlaneResult } from "@/types/app"

type Step = 1 | 2 | 3

function ProgressDots({ step }: { step: Step }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {([1, 2, 3] as Step[]).map((s) => (
        <div
          key={s}
          className={`h-2 w-2 rounded-full transition-colors ${
            s <= step ? "bg-primary" : "bg-muted"
          }`}
        />
      ))}
    </div>
  )
}

// ─── Step 1: Welcome ──────────────────────────────────────────────────────────

function Step1Welcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="text-center">
      <ProgressDots step={1} />
      <div className="mb-6 text-5xl">👋</div>
      <h1 className="text-3xl font-bold tracking-tight">Welcome to ContentOS</h1>
      <p className="mt-3 text-muted-foreground max-w-md mx-auto">
        You&apos;re 3 steps away from your first AI-generated content calendar. Let&apos;s set up your brand.
      </p>
      <Button size="lg" className="mt-8 gap-2" onClick={onNext}>
        Let&apos;s go <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  )
}

// ─── Step 2: Brand import ─────────────────────────────────────────────────────

const IMPORT_STEPS = [
  "Visiting your website...",
  "Extracting brand identity...",
  "Finding your products...",
  "Building AI persona...",
]

interface Step2Props {
  onNext: (brand: BrandRow | null) => void
}

function Step2Import({ onNext }: Step2Props) {
  const [url, setUrl] = useState("")
  const [loading, setLoading] = useState(false)
  const [loadingStep, setLoadingStep] = useState(0)
  const [brand, setBrand] = useState<BrandRow | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleAnalyze = useCallback(async () => {
    setError(null)
    setLoading(true)
    setLoadingStep(0)

    // Advance loading steps for UX
    const stepInterval = setInterval(() => {
      setLoadingStep(prev => Math.min(prev + 1, IMPORT_STEPS.length - 1))
    }, 2200)

    try {
      let importUrl = url.trim()
      if (importUrl && !importUrl.startsWith("http")) importUrl = `https://${importUrl}`

      const res = await fetch("/api/v1/brands/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: importUrl }),
      })

      const json = await res.json() as { data?: BrandRow; error?: { message?: string } }

      if (!res.ok) {
        throw new Error(json.error?.message ?? "Failed to import brand")
      }

      setBrand(json.data ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      clearInterval(stepInterval)
      setLoading(false)
    }
  }, [url])

  return (
    <div>
      <ProgressDots step={2} />
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Import your brand</h1>
        <p className="mt-2 text-muted-foreground max-w-md mx-auto">
          Paste your website URL — we&apos;ll learn your brand voice, products, and audience automatically. No forms.
        </p>
      </div>

      {!brand && !loading && (
        <div className="space-y-4">
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="url"
              placeholder="yourbrand.com"
              value={url}
              onChange={e => setUrl(e.target.value)}
              className="pl-9"
              onKeyDown={e => e.key === "Enter" && url.trim() && handleAnalyze()}
            />
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
              <p className="text-sm text-destructive">{error}</p>
              <div className="mt-2 flex gap-3 text-sm">
                <button onClick={() => setError(null)} className="text-primary underline">Try again</button>
                <Link href="/brands/new" className="text-muted-foreground underline">Set up manually instead</Link>
              </div>
            </div>
          )}

          <Button
            className="w-full gap-2"
            disabled={!url.trim()}
            onClick={handleAnalyze}
          >
            Analyse my brand <ArrowRight className="h-4 w-4" />
          </Button>

          <div className="text-center">
            <button
              onClick={() => onNext(null)}
              className="text-sm text-muted-foreground hover:text-foreground underline"
            >
              Skip for now →
            </button>
          </div>
        </div>
      )}

      {loading && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-3">
              {IMPORT_STEPS.map((step, i) => (
                <div key={step} className="flex items-center gap-3">
                  {i < loadingStep ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                  ) : i === loadingStep ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                  ) : (
                    <div className="h-4 w-4 shrink-0 rounded-full border-2 border-muted" />
                  )}
                  <span className={`text-sm ${i > loadingStep ? "text-muted-foreground" : ""}`}>
                    {step}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {brand && (
        <div className="space-y-4">
          <Card className="border-green-200 bg-green-50">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <CardTitle className="text-sm text-green-800">Brand imported!</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div>
                <p className="text-lg font-bold">{brand.name}</p>
                {brand.niche && <p className="text-sm text-muted-foreground">{brand.niche}</p>}
              </div>
              {brand.tone_of_voice && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">Tone:</span> {brand.tone_of_voice}
                </p>
              )}
              {brand.brand_values.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {brand.brand_values.map((v: string) => (
                    <span key={v} className="rounded-full bg-white px-2 py-0.5 text-xs text-green-700 border border-green-200">
                      {v}
                    </span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Button className="w-full gap-2" onClick={() => onNext(brand)}>
            Looks good! Continue <ArrowRight className="h-4 w-4" />
          </Button>
          <div className="text-center">
            <button
              onClick={() => { setBrand(null); setUrl(""); setError(null) }}
              className="text-sm text-muted-foreground hover:text-foreground underline"
            >
              Start over
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Step 3: Fastlane ─────────────────────────────────────────────────────────

const FASTLANE_STEPS = [
  "Building content strategy...",
  "Generating hooks and captions...",
  "Scheduling calendar slots...",
  "Finalising your content plan...",
]

interface Step3Props {
  brand: BrandRow | null
}

function Step3Fastlane({ brand }: Step3Props) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [runStep, setRunStep] = useState(0)
  const [result, setResult] = useState<FastlaneResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleRunFastlane = useCallback(async () => {
    if (!brand) return
    setError(null)
    setRunning(true)
    setRunStep(0)

    const stepInterval = setInterval(() => {
      setRunStep(prev => Math.min(prev + 1, FASTLANE_STEPS.length - 1))
    }, 18000)

    try {
      const res = await fetch("/api/v1/brands/fastlane", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId: brand.id }),
      })
      const json = await res.json() as { data?: FastlaneResult; error?: { message?: string } }
      if (!res.ok) throw new Error(json.error?.message ?? "Fastlane failed")
      setResult(json.data ?? null)
      try {
        if (POSTHOG_KEY) posthog.capture("onboarding_completed", {
          fastlane: true,
          calendar_entries: json.data?.calendar_entries_created ?? 0,
        })
      } catch {}
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      clearInterval(stepInterval)
      setRunning(false)
    }
  }, [brand])

  const handleSkip = useCallback(() => {
    try { if (POSTHOG_KEY) posthog.capture("onboarding_completed", { fastlane: false }) } catch {}
    router.refresh()
  }, [router])

  if (!brand) {
    return (
      <div className="text-center">
        <ProgressDots step={3} />
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted mx-auto">
          <Zap className="h-8 w-8 text-muted-foreground" />
        </div>
        <h1 className="text-2xl font-bold">One more step</h1>
        <p className="mt-2 text-muted-foreground">You&apos;ll need to add a brand before running Fastlane.</p>
        <Button asChild className="mt-6">
          <Link href="/brands/new">Create your first brand</Link>
        </Button>
        <div className="mt-4">
          <button onClick={handleSkip} className="text-sm text-muted-foreground hover:text-foreground underline">
            Skip — I&apos;ll do this later
          </button>
        </div>
      </div>
    )
  }

  if (result) {
    return (
      <div className="text-center">
        <ProgressDots step={3} />
        <div className="mb-4 text-5xl">🎉</div>
        <h1 className="text-2xl font-bold">Your calendar is ready!</h1>
        <p className="mt-2 text-muted-foreground">
          {result.calendar_entries_created} content slots added to your calendar.
        </p>
        <Button asChild size="lg" className="mt-6">
          <Link href={`/brands/${brand.id}/calendar`}>View calendar →</Link>
        </Button>
      </div>
    )
  }

  return (
    <div>
      <ProgressDots step={3} />
      <div className="text-center mb-8">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 mx-auto">
          <Zap className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-2xl font-bold">Generate your first 30 days of content</h1>
        <p className="mt-2 text-muted-foreground">
          Fastlane will build a complete content strategy and populate your calendar — in about 2 minutes.
        </p>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-4">
          <XCircle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {running ? (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-3">
              {FASTLANE_STEPS.map((step, i) => (
                <div key={step} className="flex items-center gap-3">
                  {i < runStep ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                  ) : i === runStep ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                  ) : (
                    <div className="h-4 w-4 shrink-0 rounded-full border-2 border-muted" />
                  )}
                  <span className={`text-sm ${i > runStep ? "text-muted-foreground" : ""}`}>
                    {step}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-muted-foreground text-center">This takes 1–3 minutes. Please keep this tab open.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <Button size="lg" className="w-full gap-2" onClick={handleRunFastlane}>
            <Zap className="h-4 w-4" />
            Run Fastlane for {brand.name} →
          </Button>
          <p className="text-center text-xs text-muted-foreground">Uses 30 of your monthly generation credits.</p>
          <div className="text-center">
            <button onClick={handleSkip} className="text-sm text-muted-foreground hover:text-foreground underline">
              Skip — I&apos;ll do this later
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

export function OnboardingWizard() {
  const [step, setStep] = useState<Step>(1)
  const [importedBrand, setImportedBrand] = useState<BrandRow | null>(null)

  const handleStep1Next = useCallback(() => {
    try { if (POSTHOG_KEY) posthog.capture("onboarding_step_completed", { step: 1 }) } catch {}
    setStep(2)
  }, [])
  const handleStep2Next = useCallback((brand: BrandRow | null) => {
    try {
      if (POSTHOG_KEY) {
        if (brand) posthog.capture("brand_imported", { brand_id: brand.id, brand_name: brand.name })
        posthog.capture("onboarding_step_completed", { step: 2, skipped: !brand })
      }
    } catch {}
    setImportedBrand(brand)
    setStep(3)
  }, [])

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        {step === 1 && <Step1Welcome onNext={handleStep1Next} />}
        {step === 2 && <Step2Import onNext={handleStep2Next} />}
        {step === 3 && <Step3Fastlane brand={importedBrand} />}
      </div>
    </div>
  )
}
