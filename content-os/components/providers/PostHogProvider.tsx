"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import posthog from "posthog-js"
import { POSTHOG_KEY, POSTHOG_HOST } from "@/lib/analytics/posthog"

let initialized = false

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  useEffect(() => {
    try {
      if (!POSTHOG_KEY || initialized) return
      initialized = true
      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        loaded: (ph) => {
          if (process.env.NODE_ENV === "development") ph.opt_out_capturing()
        },
      })
    } catch {
      // analytics blocked (e.g. Brave), ignore silently
    }
  }, [])

  useEffect(() => {
    try {
      if (POSTHOG_KEY) posthog.capture("$pageview", { path: pathname })
    } catch {
      // ignore
    }
  }, [pathname])

  return <>{children}</>
}
