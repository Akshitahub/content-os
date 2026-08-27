import { useQuery } from "@tanstack/react-query"
import { isApiError } from "@/types/api"

export interface CreditsBreakdownEntry {
  label: string
  credits: number
  count: number
}

export interface CreditsBreakdown {
  breakdown: CreditsBreakdownEntry[]
  periodStart: string
}

async function fetchCreditsBreakdown(): Promise<CreditsBreakdown> {
  const res = await fetch("/api/v1/user/credits-breakdown")
  const json = await res.json()
  if (!res.ok || isApiError(json)) {
    throw new Error(isApiError(json) ? json.error.message : "Failed to fetch credits breakdown")
  }
  return json.data
}

// Lazy (enabled: false by default) -- this is a click-to-expand panel off
// the Header credit indicator, not something every page load needs to pay
// for. Callers pass `enabled` tied to whether the panel is actually open.
export function useCreditsBreakdown(enabled: boolean) {
  return useQuery({
    queryKey: ["credits-breakdown"],
    queryFn: fetchCreditsBreakdown,
    enabled,
  })
}
