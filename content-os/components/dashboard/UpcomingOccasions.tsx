"use client"

import { useState } from "react"
import Link from "next/link"
import { Calendar, Loader2, Copy, Check, Sparkles } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { getUpcomingOccasions } from "@/lib/occasions/get-upcoming-occasions"
import type { OccasionCategory } from "@/lib/occasions/occasions-data"

const CATEGORY_STYLES: Record<OccasionCategory, string> = {
  festival: "bg-orange-100 text-orange-700",
  awareness: "bg-teal-100 text-teal-700",
  shopping: "bg-violet-100 text-violet-700",
}

const CATEGORY_LABELS: Record<OccasionCategory, string> = {
  festival: "Festival",
  awareness: "Awareness",
  shopping: "Shopping",
}

type GeneratedContent = {
  hook: string
  caption: string
  hashtags: string[]
  visual_direction: string
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" })
}

function daysLabel(daysUntil: number): string {
  if (daysUntil === 0) return "Today"
  if (daysUntil === 1) return "Tomorrow"
  return `In ${daysUntil} days`
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {}
      }}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
      {label ?? "Copy"}
    </button>
  )
}

interface Props {
  brandId?: string | null
}

export function UpcomingOccasions({ brandId }: Props) {
  const occasions = getUpcomingOccasions(14).slice(0, 3)

  const [generating, setGenerating] = useState<Record<string, boolean>>({})
  const [generated, setGenerated] = useState<Record<string, GeneratedContent | null>>({})
  const [genErrors, setGenErrors] = useState<Record<string, string | null>>({})

  async function handleAutoGenerate(occasionId: string, occasionName: string, suggestedAngle: string) {
    if (!brandId) return
    setGenerating(prev => ({ ...prev, [occasionId]: true }))
    setGenErrors(prev => ({ ...prev, [occasionId]: null }))
    try {
      const res = await fetch(`/api/v1/brands/${brandId}/generate-occasion-content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ occasionName, occasionAngle: suggestedAngle }),
      })
      const json = await res.json() as { data?: GeneratedContent; error?: { message: string } }
      if (res.ok && json.data) {
        setGenerated(prev => ({ ...prev, [occasionId]: json.data ?? null }))
      } else {
        setGenErrors(prev => ({ ...prev, [occasionId]: json.error?.message ?? "Failed to generate. Please try again." }))
      }
    } catch {
      setGenErrors(prev => ({ ...prev, [occasionId]: "Network error. Please try again." }))
    } finally {
      setGenerating(prev => ({ ...prev, [occasionId]: false }))
    }
  }

  if (occasions.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Upcoming occasions</CardTitle>
        </div>
        <CardDescription>Content angles for the next 2 weeks</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {occasions.map((occasion) => {
          const isGenerating = generating[occasion.id] ?? false
          const generatedContent = generated[occasion.id] ?? null
          const genError = genErrors[occasion.id] ?? null

          return (
            <div key={occasion.id} className="rounded-lg border p-4 space-y-3">
              {/* Occasion info row */}
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{occasion.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_STYLES[occasion.category]}`}>
                      {CATEGORY_LABELS[occasion.category]}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(occasion.occurrenceDate)} · {daysLabel(occasion.daysUntil)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                    {occasion.suggestedAngle}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-1.5 items-end">
                  <Button asChild size="sm" variant="outline">
                    <Link href={brandId ? `/brands/${brandId}/generate?occasion=${occasion.id}` : "/brands/new"}>
                      Create post →
                    </Link>
                  </Button>
                  {brandId && !generatedContent && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1.5 text-xs h-7 px-2"
                      onClick={() => handleAutoGenerate(occasion.id, occasion.name, occasion.suggestedAngle)}
                      disabled={isGenerating}
                    >
                      {isGenerating ? (
                        <><Loader2 className="h-3 w-3 animate-spin" /> Generating…</>
                      ) : (
                        <><Sparkles className="h-3 w-3" /> Auto-generate</>
                      )}
                    </Button>
                  )}
                </div>
              </div>

              {/* Error */}
              {genError && (
                <p className="text-xs text-destructive">{genError}</p>
              )}

              {/* Generated content */}
              {generatedContent && (
                <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Generated content</p>
                    <button
                      onClick={() => setGenerated(prev => ({ ...prev, [occasion.id]: null }))}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Clear
                    </button>
                  </div>

                  {/* Hook */}
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <p className="text-xs font-medium text-muted-foreground">Hook</p>
                      <CopyButton text={generatedContent.hook} />
                    </div>
                    <p className="text-sm font-semibold">{generatedContent.hook}</p>
                  </div>

                  {/* Caption */}
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <p className="text-xs font-medium text-muted-foreground">Caption</p>
                      <CopyButton text={generatedContent.caption} />
                    </div>
                    <p className="text-sm leading-relaxed">{generatedContent.caption}</p>
                  </div>

                  {/* Hashtags */}
                  {generatedContent.hashtags.length > 0 && (
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <p className="text-xs font-medium text-muted-foreground">Hashtags</p>
                        <CopyButton
                          text={generatedContent.hashtags.map(h => `#${h.replace(/^#+/, "")}`).join(" ")}
                          label="Copy all"
                        />
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {generatedContent.hashtags.map(tag => (
                          <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-xs">#{tag.replace(/^#+/, "")}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Visual direction */}
                  {generatedContent.visual_direction && (
                    <div>
                      <p className="mb-1 text-xs font-medium text-muted-foreground">Visual direction</p>
                      <p className="text-xs text-foreground/70">{generatedContent.visual_direction}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
