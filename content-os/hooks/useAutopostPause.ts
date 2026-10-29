import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { isApiError } from "@/types/api"
import { readJsonResponse } from "@/lib/utils/read-json-response"

// Calendar entry queries (components/calendar/ContentCalendar.tsx) -- keyed
// by brand so anything that changes a brand's entries can refresh them all.
export const calendarKeys = {
  all: ["calendar"] as const,
  brand: (brandId: string) => ["calendar", brandId] as const,
  month: (brandId: string, month: string) => ["calendar", brandId, month] as const,
}

export const autopostPauseKeys = {
  brand: (brandId: string) => ["autopost-pause", brandId] as const,
}

export interface AutopostPauseState {
  paused: boolean
  paused_at: string | null
  /** Scheduled entries a pause would hold. */
  scheduled_count: number
}

async function readData<T>(res: Response, fallback: string): Promise<T> {
  const json: unknown = await readJsonResponse(res)
  if (!res.ok || isApiError(json)) throw new Error(isApiError(json) ? json.error.message : fallback)
  return (json as { data: T }).data
}

/** The brand's "pause autoposting" kill switch (app/api/v1/brands/[brandId]/autopost-pause). */
export function useAutopostPause(brandId: string) {
  return useQuery({
    queryKey: autopostPauseKeys.brand(brandId),
    queryFn: async () => readData<AutopostPauseState>(await fetch(`/api/v1/brands/${brandId}/autopost-pause`), "Couldn't load autoposting state."),
    enabled: !!brandId,
  })
}

/** Pause / resume. Resolves to how many overdue entries resuming marked missed. */
export function useSetAutopostPause(brandId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (paused: boolean) => readData<{ paused: boolean; missed_count: number }>(
      await fetch(`/api/v1/brands/${brandId}/autopost-pause`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused }),
      }),
      paused ? "Couldn't pause autoposting. Please try again." : "Couldn't resume autoposting. Please try again.",
    ),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: autopostPauseKeys.brand(brandId) })
      // Resuming can mark entries missed -- refresh every calendar view of this brand.
      void queryClient.invalidateQueries({ queryKey: calendarKeys.brand(brandId) })
    },
  })
}
