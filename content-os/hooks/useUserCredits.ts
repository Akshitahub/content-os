import { useQuery } from "@tanstack/react-query"
import { isApiError } from "@/types/api"
import type { UserPlan } from "@/types/app"

// Single source of truth for the user's credit balance — every place that
// displays it (Header, the Autopilot page, Settings) reads from this same
// cached query instead of each computing/fetching its own copy. Previously
// Header received a server-layout-rendered generation_count as a static
// prop (never re-fetched on client-side navigation between dashboard
// pages, and computed without the monthly-reset check /api/v1/user/profile
// itself applies), while other pages fetched fresh independently — the two
// could genuinely disagree, not just look stale.
export const userCreditsKeys = {
  all: ["user-credits"] as const,
}

export interface UserCredits {
  plan: UserPlan
  limit: number
  used: number
  remaining: number
}

async function fetchUserCredits(): Promise<UserCredits> {
  const res = await fetch("/api/v1/user/profile")
  const json = await res.json()
  if (!res.ok || isApiError(json)) {
    throw new Error(isApiError(json) ? json.error.message : "Failed to fetch credit balance")
  }
  return json.data
}

export function useUserCredits() {
  return useQuery({
    queryKey: userCreditsKeys.all,
    queryFn: fetchUserCredits,
  })
}
