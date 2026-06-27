"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import posthog from "posthog-js"
import { POSTHOG_KEY, POSTHOG_HOST } from "@/lib/analytics/posthog"

let initialized = false

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  useEffect(() => {
    if (!POSTHOG_KEY || initialized) return
    initialized = true
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      loaded: (ph) => {
        if (process.env.NODE_ENV === "development") ph.debug()
      },
    })
  }, [])

  useEffect(() => {
    if (!POSTHOG_KEY) return
    try {
      posthog.capture("$pageview", { path: pathname })
    } catch {
      // analytics must never break the app
    }
  }, [pathname])

  return <>{children}</>
}
