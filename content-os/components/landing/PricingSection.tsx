"use client"

import { useState } from "react"
import Link from "next/link"
import { Check } from "lucide-react"

type BillingCycle = "monthly" | "annual"

interface PricingTier {
  id: string
  name: string
  tagline: string
  monthlyPrice: string
  annualMonthlyPrice: string
  annualBilledLabel: string | null
  features: string[]
  highlighted?: boolean
}

const TIERS: PricingTier[] = [
  {
    id: "free",
    name: "Free",
    tagline: "Try it out",
    monthlyPrice: "₹0",
    annualMonthlyPrice: "₹0",
    annualBilledLabel: null,
    features: [
      "1 brand",
      "15 AI generations / month",
      "Post manually to Instagram, Facebook",
      "1 free AI video reel, on us",
    ],
  },
  {
    id: "starter",
    name: "Starter",
    tagline: "For getting serious",
    monthlyPrice: "₹699",
    annualMonthlyPrice: "₹583",
    annualBilledLabel: "Billed ₹6,999/year",
    features: [
      "2 brands",
      "500 AI generations / month",
      "Auto-post & schedule to Instagram, Facebook, Threads, Pinterest",
      "Autopilot: generate a month of content in one click",
      "Influencer outreach tools",
      "Basic analytics & ROI tracking",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For brands ready to grow",
    monthlyPrice: "₹2,499",
    annualMonthlyPrice: "₹2,083",
    annualBilledLabel: "Billed ₹24,999/year",
    highlighted: true,
    features: [
      "3 brands",
      "1,200 AI generations / month",
      "+ LinkedIn, YouTube, Twitter/X",
      "1 real AI video reel every week",
      "Competitor tracking (5 competitors)",
      "Full analytics — demographics, best-time-to-post",
      "Monthly PDF reports",
    ],
  },
  {
    id: "agency",
    name: "Agency",
    tagline: "For managing multiple brands",
    monthlyPrice: "₹6,999",
    annualMonthlyPrice: "₹5,833",
    annualBilledLabel: "Billed ₹69,999/year",
    features: [
      "5 brands",
      "2,000 AI generations / month",
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

      {/* Monthly / Annual toggle — display only, no annual billing wired up yet */}
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
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Save ~17%</span>
        )}
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {TIERS.map((tier) => {
          const price = cycle === "annual" ? tier.annualMonthlyPrice : tier.monthlyPrice
          const subtitle = cycle === "annual" && tier.annualBilledLabel ? tier.annualBilledLabel : tier.tagline

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
