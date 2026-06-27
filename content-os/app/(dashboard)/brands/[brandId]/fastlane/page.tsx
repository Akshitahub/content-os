"use client"

import { useState } from "react"
import { useParams } from "next/navigation"
import { Zap, Loader2, CheckCircle2, XCircle, Calendar, BarChart2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import posthog from "posthog-js"
import { POSTHOG_KEY } from "@/lib/analytics/posthog"
import type { FastlaneResult } from "@/types/app"

type FastlaneState = "IDLE" | "RUNNING" | "DONE" | "ERROR"

export default function FastlanePage() {
  const params = useParams()
  const brandId = params.brandId as string
  const [state, setState] = useState<FastlaneState>("IDLE")
  const [result, setResult] = useState<FastlaneResult | null>(null)
  const [errorMsg, setErrorMsg] = useState<string>("")

  async function runFastlane() {
    setState("RUNNING")
    setResult(null)
    setErrorMsg("")

    try {
      const res = await fetch("/api/v1/brands/fastlane", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId }),
      })

      const json = await res.json() as { data?: FastlaneResult; error?: { message?: string } }

      if (!res.ok) {
        throw new Error(json.error?.message ?? "Fastlane failed")
      }

      setResult(json.data ?? null)
      setState("DONE")
      try {
        if (POSTHOG_KEY) posthog.capture("fastlane_completed", {
          brand_id: brandId,
          calendar_entries: json.data?.calendar_entries_created ?? 0,
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
      {/* IDLE */}
      {state === "IDLE" && (
        <div className="w-full max-w-lg text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/60 shadow-lg">
            <Zap className="h-10 w-10 text-primary-foreground" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight">Fastlane</h1>
          <p className="mt-3 text-muted-foreground">
            Generate a complete 30-day content calendar in one click. Our AI will analyse your brand,
            build a strategy, and create tailored content for every slot.
          </p>

          <div className="mt-8 grid gap-3 text-left">
            {[
              { icon: BarChart2, text: "AI builds a platform-specific content strategy" },
              { icon: Calendar, text: "30 content slots generated and added to your calendar" },
              { icon: Zap, text: "Uses 30 of your monthly generation credits" },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <p className="text-sm">{text}</p>
              </div>
            ))}
          </div>

          <Button size="lg" className="mt-8 w-full gap-2" onClick={runFastlane}>
            <Zap className="h-5 w-5" />
            Run Fastlane
          </Button>

          <p className="mt-4 text-xs text-muted-foreground">
            This will use 30 generation credits and add entries to your content calendar.
          </p>
        </div>
      )}

      {/* RUNNING */}
      {state === "RUNNING" && (
        <div className="w-full max-w-lg text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/60 shadow-lg">
            <Loader2 className="h-10 w-10 text-primary-foreground animate-spin" />
          </div>
          <h2 className="text-2xl font-bold">Building your 30-day plan…</h2>
          <p className="mt-2 text-muted-foreground">
            The AI is crafting your content strategy and generating all 30 slots. This takes 1–3 minutes.
          </p>
          <div className="mt-8 space-y-2 text-left">
            {[
              "Analysing your brand and products",
              "Generating content strategy",
              "Creating 30 content slots",
              "Adding to your calendar",
            ].map((step, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
                <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                <p className="text-sm text-muted-foreground">{step}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* DONE */}
      {state === "DONE" && result && (
        <div className="w-full max-w-lg text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-green-500 shadow-lg">
            <CheckCircle2 className="h-10 w-10 text-white" />
          </div>
          <h2 className="text-3xl font-bold">Done!</h2>
          <p className="mt-2 text-muted-foreground">Your 30-day content plan is ready.</p>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              { label: "Slots planned", value: result.slots_planned },
              { label: "Content generated", value: result.slots_generated },
              { label: "Calendar entries", value: result.calendar_entries_created },
            ].map(({ label, value }) => (
              <Card key={label}>
                <CardContent className="pt-4 text-center">
                  <p className="text-3xl font-bold text-primary">{value}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {result.strategy_summary && (
            <Card className="mt-4 text-left">
              <CardHeader><CardTitle className="text-sm">Strategy overview</CardTitle></CardHeader>
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

          <div className="mt-6 flex gap-3">
            <Button asChild className="flex-1">
              <Link href={`/brands/${brandId}/calendar`}>
                <Calendar className="mr-2 h-4 w-4" />
                View calendar
              </Link>
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => setState("IDLE")}>
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
          <p className="mt-2 text-muted-foreground">{errorMsg || "Fastlane failed. Please try again."}</p>

          <Button className="mt-8 w-full" variant="outline" onClick={() => setState("IDLE")}>
            Try again
          </Button>
        </div>
      )}
    </div>
  )
}
