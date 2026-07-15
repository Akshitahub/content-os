"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"

const TOUR_KEY = "contentos_tour_completed"

interface TourStep {
  targetId: string
  title: string
  body: string
  emoji: string
}

const STEPS: TourStep[] = [
  {
    targetId: "tour-brand-selector",
    title: "This is your brand 👋",
    body: "SocioPosts creates all content in your brand's voice. Switch brands here anytime.",
    emoji: "🏷️",
  },
  {
    targetId: "tour-autopilot",
    title: "⚡ Run Autopilot",
    body: "One click generates 30 days of hooks, captions, reels, and carousels — tailored to your brand.",
    emoji: "✈️",
  },
  {
    targetId: "tour-calendar",
    title: "📅 Your content calendar",
    body: "All your planned content lives here. See what's ready, scheduled, or still needs work.",
    emoji: "📅",
  },
  {
    targetId: "tour-create",
    title: "✨ Create specific content",
    body: "Need a hook for tomorrow's post? A reel script? Go here to generate exactly what you need.",
    emoji: "✨",
  },
]

function getTargetRect(id: string): DOMRect | null {
  const el = document.getElementById(id)
  return el ? el.getBoundingClientRect() : null
}

function highlightTarget(id: string) {
  STEPS.forEach((s) => {
    const el = document.getElementById(s.targetId)
    if (el) el.style.outline = ""
  })
  const el = document.getElementById(id)
  if (el) {
    el.style.outline = "2px solid #6366f1"
    el.style.outlineOffset = "4px"
    el.style.borderRadius = "6px"
    el.style.transition = "outline 0.2s"
    el.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }
}

function clearHighlights() {
  STEPS.forEach((s) => {
    const el = document.getElementById(s.targetId)
    if (el) {
      el.style.outline = ""
      el.style.outlineOffset = ""
    }
  })
}

function TooltipCard({
  step,
  index,
  total,
  onBack,
  onNext,
  onSkip,
}: {
  step: TourStep
  index: number
  total: number
  onBack: () => void
  onNext: () => void
  onSkip: () => void
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    function compute() {
      const rect = getTargetRect(step.targetId)
      if (!rect) {
        setPos({ top: window.innerHeight / 2 - 80, left: window.innerWidth / 2 - 160 })
        return
      }
      const tooltipW = 320
      const tooltipH = 180
      const margin = 12
      let top = rect.bottom + margin
      let left = rect.left
      if (top + tooltipH > window.innerHeight - margin) top = rect.top - tooltipH - margin
      if (left + tooltipW > window.innerWidth - margin) left = window.innerWidth - tooltipW - margin
      if (left < margin) left = margin
      setPos({ top: top + window.scrollY, left })
    }
    compute()
    window.addEventListener("resize", compute)
    return () => window.removeEventListener("resize", compute)
  }, [step.targetId])

  if (!pos) return null

  return (
    <div
      className="fixed z-[9999] w-80 rounded-2xl border border-border bg-white shadow-2xl ring-1 ring-black/5 p-5"
      style={{ top: pos.top, left: pos.left }}
      role="dialog"
      aria-modal="false"
      aria-label={step.title}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">{step.emoji}</span>
          <h3 className="text-sm font-bold text-gray-900">{step.title}</h3>
        </div>
        <span className="shrink-0 text-[11px] font-medium text-muted-foreground">{index + 1} of {total}</span>
      </div>
      <p className="text-sm text-gray-600 leading-relaxed mb-4">{step.body}</p>
      <div className="flex items-center justify-between gap-2">
        <button onClick={onSkip} className="text-xs text-muted-foreground hover:text-foreground underline">
          Skip tour
        </button>
        <div className="flex items-center gap-2">
          {index > 0 && (
            <button onClick={onBack}
              className="rounded-full border border-input px-3 py-1.5 text-xs font-medium hover:bg-secondary">
              Back
            </button>
          )}
          <button onClick={onNext}
            className="rounded-full bg-violet-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-violet-700">
            {index === total - 1 ? "Done" : "Next →"}
          </button>
        </div>
      </div>
      {/* Step dots */}
      <div className="flex items-center justify-center gap-1 mt-3">
        {Array.from({ length: total }, (_, i) => (
          <div key={i} className={`h-1.5 rounded-full transition-all ${i === index ? "w-4 bg-violet-600" : "w-1.5 bg-muted"}`} />
        ))}
      </div>
    </div>
  )
}

function FinishedCard({ onRunAutopilot, brandId }: { onRunAutopilot: () => void; brandId?: string }) {
  return (
    <div
      className="fixed bottom-6 right-6 z-[9999] w-80 rounded-2xl border border-violet-200 bg-white shadow-2xl p-5"
      role="dialog"
      aria-modal="false"
    >
      <div className="text-center space-y-2 mb-4">
        <p className="text-2xl">🎉</p>
        <h3 className="font-bold text-gray-900">You&apos;re ready!</h3>
        <p className="text-sm text-gray-500">SocioPosts is set up and ready to go. The easiest first step is to run Autopilot.</p>
      </div>
      <button onClick={onRunAutopilot}
        className="w-full rounded-full bg-violet-600 py-2.5 text-sm font-semibold text-white hover:bg-violet-700">
        Run Autopilot now ✈️
      </button>
    </div>
  )
}

interface ProductTourProps {
  brandId?: string
}

export function ProductTour({ brandId }: ProductTourProps) {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [visible, setVisible] = useState(false)
  const [finished, setFinished] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem(TOUR_KEY) === "true") return
    } catch {
      return
    }
    // Small delay so sidebar elements have mounted
    const t = setTimeout(() => setVisible(true), 1200)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!visible || finished) return
    highlightTarget(STEPS[step].targetId)
  }, [visible, step, finished])

  const complete = useCallback(() => {
    clearHighlights()
    setVisible(false)
    setFinished(true)
    try { localStorage.setItem(TOUR_KEY, "true") } catch {}
  }, [])

  const skip = useCallback(() => {
    clearHighlights()
    setVisible(false)
    try { localStorage.setItem(TOUR_KEY, "true") } catch {}
  }, [])

  const next = useCallback(() => {
    if (step === STEPS.length - 1) {
      complete()
    } else {
      setStep((s) => s + 1)
    }
  }, [step, complete])

  const back = useCallback(() => {
    setStep((s) => Math.max(0, s - 1))
  }, [])

  if (!visible && !finished) return null

  if (finished) {
    return (
      <FinishedCard
        brandId={brandId}
        onRunAutopilot={() => {
          setFinished(false)
          if (brandId) router.push(`/brands/${brandId}/fastlane`)
          else router.push("/dashboard")
        }}
      />
    )
  }

  return (
    <>
      {/* Backdrop (subtle) */}
      <div className="fixed inset-0 z-[9998] bg-black/10 backdrop-blur-[1px]" onClick={skip} aria-hidden="true" />
      <TooltipCard
        step={STEPS[step]}
        index={step}
        total={STEPS.length}
        onBack={back}
        onNext={next}
        onSkip={skip}
      />
    </>
  )
}
