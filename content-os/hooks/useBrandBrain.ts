import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { isApiError } from "@/types/api"
import { readJsonResponse } from "@/lib/utils/read-json-response"
import type { BrandBrain } from "@/types/app"
import { brandKeys } from "@/hooks/useBrand"

// The self-filling Brand Brain (lib/ai/brand-brain-derive.ts) --
// app/api/v1/brands/[brandId]/brand-brain.
export const brandBrainKeys = {
  brand: (brandId: string) => ["brand-brain", brandId] as const,
}

export interface BrandBrainState {
  brain: BrandBrain
  field_meta: Record<string, { auto?: boolean }>
  status: { status: "running" | "done" | "failed"; started_at: string; finished_at?: string; error?: string }
}

export type BrandBrainEdits = Partial<{
  facts: { differentiators?: string[] }
  voice: { phrases_to_avoid?: string[]; claims_never_to_make?: string[] }
  strategy: { objections?: string[] }
  visual: { avoid_visuals?: string[]; photography_style?: string; heading_font?: string; body_font?: string }
}>

async function readData<T>(res: Response, fallback: string): Promise<T> {
  const json: unknown = await readJsonResponse(res)
  if (!res.ok || isApiError(json)) throw new Error(isApiError(json) ? json.error.message : fallback)
  return (json as { data: T }).data
}

export function useBrandBrain(brandId: string) {
  return useQuery({
    queryKey: brandBrainKeys.brand(brandId),
    queryFn: async () => readData<BrandBrainState>(await fetch(`/api/v1/brands/${brandId}/brand-brain`), "Couldn't load your Brand Brain."),
    enabled: !!brandId,
    // While it sets itself up, check back until it's done.
    refetchInterval: (query) => (query.state.data?.status.status === "running" ? 5000 : false),
  })
}

export function useSaveBrandBrain(brandId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (fields: BrandBrainEdits) => readData<{ saved: boolean }>(
      await fetch(`/api/v1/brands/${brandId}/brand-brain`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      }),
      "Couldn't save. Please try again.",
    ),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: brandBrainKeys.brand(brandId) })
      void queryClient.invalidateQueries({ queryKey: brandKeys.detail(brandId) })
    },
  })
}
