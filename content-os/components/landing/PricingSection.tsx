"use client"

import { useState } from "react"
import Link from "next/link"
import { Check } from "lucide-react"
import { PLAN_LIMITS } from "@/types/app"
import { REELS_ENABLED, ENABLED_SOCIAL_PLATFORMS } from "@/lib/constants"

type BillingCycle = "monthly" | "annual"

interface PricingTier {
  id: "starter" | "pro" | "agency"
  name: string
  tagline: string
  features: string[]
  highlighted?: boolean
}

function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`
}

// Credits, not "generations" — different content types now cost different
// amounts (a Post costs more than a Hook), so a flat generation count
// would be misleading on its own. `credits`/`brands`/`autopilot` are read
// from PLAN_LIMITS directly (not hand-typed) so those parts can never
// drift out of sync with the real pool size or run cap. The manual-posts
// figures below are hand-tuned copy targets (a final, approved business
// decision — see the pricing revision this pairs with in types/app.ts),
// not re-derived by dividing the whole pool by POST, since that would
// overstate what's left after also budgeting for Autopilot.
// Free tier removed (2026-08-26 pricing revision) — Starter/Pro signups
// get a 7-day no-card trial; Agency has none and goes straight to
// checkout (see app/api/auth/callback/route.ts's isAgencyCheckout
// handling, and the banner above the tier grid below).
// Starter's target dropped from 40 to 13 to match its resized 150-credit
// pool at roughly the same credits-per-post ratio the old 450-credit/40-post
// figure implied (450/40 ≈ 11.25 credits/post; 150/13 ≈ 11.5).
const MANUAL_POSTS_TARGET: Record<"starter" | "pro" | "agency", number> = {
  starter: 13,
  pro: 75,
  agency: 100,
}

// Reels are fully parked behind REELS_ENABLED (lib/constants.ts) — not
// reachable anywhere in the app right now (see CreatePicker.tsx's Reel
// card and the landing page's own Features grid, both "Coming soon").
// This note used to describe reels as an already-included Pro/Agency
// benefit; it now says the same "coming soon" thing this copy claims
// everywhere else, rather than promising something nobody can use yet.
// Once REELS_ENABLED flips on, reels draw from this same shared credit
// pool (see lib/usage/credit-costs.ts's REEL weight) rather than the old
// fixed weekly allowance ("1 reel/week", "3-4 reels/week") this copy used
// to promise — that promise is gone because the real per-reel cost isn't
// confirmed yet (REEL there is still a placeholder). Starter isn't
// mentioned, matching PLAN_LIMITS.starter.reelsPerWeek staying 0.
function reelNote(planId: "starter" | "pro" | "agency"): string {
  if (REELS_ENABLED) {
    if (planId === "pro") return ", plus AI video reels from the same credit pool"
    if (planId === "agency") return ", with generous room for AI video reels too"
  }
  return ""
}

function creditsLine(planId: "starter" | "pro" | "agency"): string {
  const { generations: credits, brands, autopilot } = PLAN_LIMITS[planId]
  const posts = MANUAL_POSTS_TARGET[planId]
  const runs = autopilot.maxRunsPerMonth
  // Autopilot is capped at a fixed number of runs/month, independent of
  // brand count (see AutopilotTier.maxRunsPerMonth in types/app.ts) —
  // Agency's 4 runs against its 5 brands is intentional, not a typo, so
  // this can't say "all N brands" the way old unlimited-style copy did.
  const autopilotNote = `${runs} Autopilot run${runs === 1 ? "" : "s"} across your ${brands} brand${brands === 1 ? "" : "s"}`
  return `${credits.toLocaleString("en-IN")} credits / month: ~${posts} posts + ${autopilotNote}${reelNote(planId)}`
}

// Derived from ENABLED_SOCIAL_PLATFORMS (lib/constants.ts) rather than
// hand-typed, so this can't drift from the actual cost-control gate —
// only ever "Instagram" today, but reads as a list once that array grows.
const ENABLED_PLATFORMS_LABEL = ENABLED_SOCIAL_PLATFORMS.map((p) => p[0].toUpperCase() + p.slice(1)).join(", ")

// Real annual price from PLAN_LIMITS[id].annualPrice (the same value
// actually charged at checkout — see create-checkout-session/route.ts) —
// not a display-only formula, since annual billing is now wired up for
// real. Per-month equivalent shown so the discount is legible at a glance.
function annualPricing(annualPrice: number): { monthlyEquivalent: string; billedLabel: string } {
  return { monthlyEquivalent: formatRupees(Math.floor(annualPrice / 12)), billedLabel: `Billed ${formatRupees(annualPrice)}/year` }
}

const TIERS: PricingTier[] = [
  {
    id: "starter",
    name: "Starter",
    tagline: "For getting serious",
    features: [
      "2 brands",
      creditsLine("starter"),
      "Download-ready posts — publish manually",
      "Autopilot: generate weeks of content in one click",
      "Basic analytics & ROI tracking",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For brands ready to grow",
    highlighted: true,
    features: [
      "3 brands",
      creditsLine("pro"),
      `Auto-post & schedule to ${ENABLED_PLATFORMS_LABEL} (more platforms coming soon)`,
      "Autopilot: generate a month of content in one click",
      "Full analytics: demographics, best-time-to-post",
      "Monthly PDF reports",
    ],
  },
  {
    id: "agency",
    name: "Agency",
    tagline: "For managing multiple brands",
    features: [
      "5 brands",
      creditsLine("agency"),
      `Auto-post & schedule to ${ENABLED_PLATFORMS_LABEL} (more platforms coming soon)`,
      "Dedicated support",
    ],
  },
]

export function PricingSection() {
  const [cycle, setCycle] = useState<BillingCycle>("monthly")

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 text-center">
        <span className="mb-3 inline-block rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-violet-600">Pricing</span>
        <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">Simple, honest pricing</h2>
        <p className="mt-2 text-sm font-semibold text-emerald-600">Starter and Pro start with a 7-day free trial — no card required. Agency goes straight to checkout.</p>
      </div>

      {/* Monthly / Annual toggle */}
      <div className="mb-10 flex flex-col items-center gap-2">
        <div className="inline-flex rounded-full border border-gray-200 bg-gray-50 p-1">
          <button
            type="button"
            onClick={() => setCycle("monthly")}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
              cycle === "monthly" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setCycle("annual")}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
              cycle === "annual" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Annual
          </button>
        </div>
        {cycle === "annual" && (
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Save 10%</span>
        )}
      </div>

      <div className="grid gap-6 sm:grid-cols-3">
        {TIERS.map((tier) => {
          const monthlyPrice = PLAN_LIMITS[tier.id].price
          const annual = annualPricing(PLAN_LIMITS[tier.id].annualPrice)
          const price = cycle === "annual" ? annual.monthlyEquivalent : formatRupees(monthlyPrice)
          const subtitle = cycle === "annual" ? annual.billedLabel : tier.tagline

          return (
            <div
              key={tier.id}
              className={`relative flex flex-col rounded-2xl p-6 sm:p-7 ${
                tier.highlighted
                  ? "border-2 border-violet-600 shadow-lg shadow-violet-100"
                  : "border border-gray-200"
              }`}
            >
              {tier.highlighted && (
                <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-violet-600 px-4 py-1 text-xs font-bold text-white">
                  Most popular
                </span>
              )}
              <div className="mb-6">
                <h3 className="text-lg font-bold text-gray-900">{tier.name}</h3>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-gray-900">{price}</span>
                  <span className="text-gray-400">/mo</span>
                </div>
                <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
              </div>
              <ul className="mb-8 flex-1 space-y-3">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
                    <Check className={`mt-0.5 h-4 w-4 shrink-0 ${tier.highlighted ? "text-violet-500" : "text-emerald-500"}`} /> {f}
                  </li>
                ))}
              </ul>
              <Link
                href={tier.id === "agency" ? "/signup?plan=agency" : "/signup"}
                className={`rounded-full px-5 py-2.5 text-center text-sm font-semibold transition ${
                  tier.highlighted
                    ? "bg-violet-600 text-white hover:bg-violet-700"
                    : "border border-gray-200 text-gray-700 hover:bg-gray-50"
                }`}
              >
                {tier.id === "agency" ? "Subscribe now" : "Start free trial"}
              </Link>
            </div>
          )
        })}
      </div>
    </div>
  )
}
