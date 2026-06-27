"use client"

import { X, Zap, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import type { UserPlan } from "@/types/app"

const PLAN_UPGRADE_MAP: Record<UserPlan, { nextPlan: string; href: string } | null> = {
  free: { nextPlan: "Starter", href: "/settings?tab=billing" },
  starter: { nextPlan: "Pro", href: "/settings?tab=billing" },
  pro: { nextPlan: "Agency", href: "/settings?tab=billing" },
  agency: null,
}

interface UsageLimitModalProps {
  isOpen: boolean
  onClose: () => void
  currentPlan?: UserPlan
  message?: string
}

export function UsageLimitModal({ isOpen, onClose, currentPlan = "free", message }: UsageLimitModalProps) {
  if (!isOpen) return null

  const upgrade = PLAN_UPGRADE_MAP[currentPlan]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-sm rounded-2xl border bg-card shadow-2xl p-6 text-center">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100">
          <Zap className="h-7 w-7 text-amber-600" />
        </div>

        <h2 className="text-xl font-bold">Usage limit reached</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {message ?? "You've used all your generation credits for this month."}
        </p>

        <div className="mt-4 rounded-lg bg-secondary/50 px-4 py-3 text-left">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Current plan</p>
          <p className="text-sm font-medium capitalize">{currentPlan}</p>
        </div>

        <div className="mt-5 space-y-2">
          {upgrade ? (
            <>
              <Button asChild className="w-full gap-2">
                <Link href={upgrade.href}>
                  Upgrade to {upgrade.nextPlan} <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button variant="ghost" className="w-full" onClick={onClose}>
                Remind me later
              </Button>
            </>
          ) : (
            <Button className="w-full" onClick={onClose}>
              Got it
            </Button>
          )}
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Credits reset at the start of each month.
        </p>
      </div>
    </div>
  )
}
