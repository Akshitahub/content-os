"use client"

import Link from "next/link"
import { ArrowRight, Sparkles, Zap, CalendarDays } from "lucide-react"

export default function WelcomePage() {
  return (
    <div className="text-center">
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-600/20 border border-violet-500/30">
        <Sparkles className="h-8 w-8 text-violet-400" />
      </div>

      <h1 className="text-3xl font-bold text-white sm:text-4xl">Welcome to ContentOS</h1>
      <p className="mt-3 text-gray-400 text-base">
        Let&apos;s set up your brand in 2 minutes. Paste your website URL and we&apos;ll build your entire content strategy.
      </p>

      <div className="mt-10 grid gap-4 text-left sm:grid-cols-3">
        {[
          { icon: Sparkles, title: "AI learns your brand", desc: "We read your site and extract your voice, tone, and audience." },
          { icon: Zap, title: "Content in seconds", desc: "Hooks, captions, reels — generated in your exact brand style." },
          { icon: CalendarDays, title: "30 days planned", desc: "Autopilot builds a full month of ready-to-post content." },
        ].map(({ icon: Icon, title, desc }) => (
          <div key={title} className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600/20">
              <Icon className="h-4 w-4 text-violet-400" />
            </div>
            <p className="text-sm font-semibold text-white">{title}</p>
            <p className="mt-1 text-xs leading-relaxed text-gray-400">{desc}</p>
          </div>
        ))}
      </div>

      <div className="mt-10">
        <Link
          href="/onboarding/brand-setup"
          className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-8 py-3.5 text-sm font-semibold text-white transition-all hover:bg-violet-700 hover:scale-[1.02]"
        >
          Set up my brand <ArrowRight className="h-4 w-4" />
        </Link>
        <p className="mt-3 text-xs text-gray-600">Takes about 2 minutes · Free to start</p>
      </div>
    </div>
  )
}
