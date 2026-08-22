"use client"

import { useState } from "react"
import Link from "next/link"
import { Check } from "lucide-react"
import { PLAN_LIMITS } from "@/types/app"
import { POST } from "@/lib/usage/credit-costs"

type BillingCycle = "monthly" | "annual"

interface PricingTier {
  id: "free" | "starter" | "pro" | "agency"
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
// would be misleading on its own. Computed from PLAN_LIMITS/POST directly
// (not hand-typed) so this line can never drift out of sync with the real
// pool size or weight the way the old hardcoded per-tier strings did.
function creditsLine(planId: "free" | "starter" | "pro" | "agency"): string {
  const credits = PLAN_LIMITS[planId].generations
  const postsEquivalent = Math.round(credits / POST)
  return `${credits.toLocaleString("en-IN")} credits / month (~${postsEquivalent.toLocaleString("en-IN")} full posts)`
}

// Real annual price from PLAN_LIMITS[id].annualPrice (the same value
// actually charged at checkout — see create-checkout-session/route.ts) —
// not a display-only formula, since annual billing is now wired up for
// real. Per-month equivalent shown so the discount is legible at a glance.
function annualPricing(annualPrice: number): { monthlyEquivalent: string; billedLabel: string } {
  return { monthlyEquivalent: formatRupees(Math.floor(annualPrice / 12)), billedLabel: `Billed ${formatRupees(annualPrice)}/year` }
}

const TIERS: PricingTier[] = [
  {
    id: "free",
    name: "Free",
    tagline: "Try it out",
    features: [
      "1 brand",
      creditsLine("free"),
      "Post manually to Instagram, Facebook",
      "1 free AI video reel, on us",
    ],
  },
  {
    id: "starter",
    name: "Starter",
    tagline: "For getting serious",
    features: [
      "2 brands",
      creditsLine("starter"),
      "Auto-post & schedule to Instagram, Facebook, Threads, Pinterest",
      "Autopilot: generate a month of content in one click",
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
      "+ LinkedIn, YouTube, Twitter/X",
      "Autopilot: generate a month of content in one click",
      "1 real AI video reel every week",
      "Influencer outreach tools",
      "Competitor tracking (5 competitors)",
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
      "3-4 real AI video reels every week",
      "Competitor tracking across multiple brands",
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

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {TIERS.map((tier) => {
          const monthlyPrice = PLAN_LIMITS[tier.id].price
          const annual = tier.id !== "free" ? annualPricing(PLAN_LIMITS[tier.id].annualPrice) : null
          const price = cycle === "annual" && annual ? annual.monthlyEquivalent : formatRupees(monthlyPrice)
          const subtitle = cycle === "annual" && annual ? annual.billedLabel : tier.tagline

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
                href="/signup"
                className={`rounded-full px-5 py-2.5 text-center text-sm font-semibold transition ${
                  tier.highlighted
                    ? "bg-violet-600 text-white hover:bg-violet-700"
                    : "border border-gray-200 text-gray-700 hover:bg-gray-50"
                }`}
              >
                {tier.id === "free" ? "Get started free" : `Start ${tier.name} plan`}
              </Link>
            </div>
          )
        })}
      </div>
    </div>
  )
}
