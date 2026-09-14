"use client"

import Link from "next/link"
import { useUserCredits } from "@/hooks/useUserCredits"

/**
 * Quiet, always-on balance indicator for the redesigned dashboard hero --
 * distinct from CreditGiftBoxes' fuller low-balance promo card further
 * down the page (kept gated exactly as before). Reuses useUserCredits,
 * the same shared query Header/Settings already read from, rather than a
 * new one. "Add more" links to Settings' own "Buy more credits" card --
 * the same underlying top-up flow CreditGiftBoxes uses -- instead of
 * opening a second purchase instance here (Settings' card, unlike
 * CreditGiftBoxes, isn't gated by low balance, so it's always reachable
 * regardless of how much this pill shows).
 */
export function CreditBalancePill() {
  const { data: credits, isLoading } = useUserCredits()

  if (isLoading || !credits) {
    return <div className="h-8 w-32 animate-pulse rounded-full bg-secondary" />
  }

  const label = credits.trialing ? `Trial · ${credits.remaining} credits` : `${credits.remaining} credits`

  return (
    <div className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      <Link href="/settings#plan-usage" className="font-semibold text-violet-600 hover:text-violet-700 hover:underline">
        Add more
      </Link>
    </div>
  )
}
