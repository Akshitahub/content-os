import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { isApiError } from "@/types/api"
import { readJsonResponse } from "@/lib/utils/read-json-response"
import type { ArtDirection } from "@/lib/ai/brand-brain"
import { brandKeys } from "@/hooks/useBrand"

// The brand's art direction ("Brand look" on the brand page) --
// app/api/v1/brands/[brandId]/art-direction.
export const artDirectionKeys = {
  brand: (brandId: string) => ["art-direction", brandId] as const,
}

async function readArtDirection(res: Response, fallback: string): Promise<ArtDirection | null> {
  const json: unknown = await readJsonResponse(res)
  if (!res.ok || isApiError(json)) throw new Error(isApiError(json) ? json.error.message : fallback)
  return (json as { data: { art_direction: ArtDirection | null } }).data.art_direction
}

export function useArtDirection(brandId: string) {
  return useQuery({
    queryKey: artDirectionKeys.brand(brandId),
    queryFn: async () => readArtDirection(await fetch(`/api/v1/brands/${brandId}/art-direction`), "Couldn't load the brand look."),
    enabled: !!brandId,
  })
}

// Both mutations change brand_brain, which every builder reads its palette
// from (useBrand) -- refresh that too.
function useOnArtDirectionChange(brandId: string) {
  const queryClient = useQueryClient()
  return {
    onSuccess: (artDirection: ArtDirection | null) => queryClient.setQueryData(artDirectionKeys.brand(brandId), artDirection),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: artDirectionKeys.brand(brandId) })
      void queryClient.invalidateQueries({ queryKey: brandKeys.detail(brandId) })
    },
  }
}

/** Saves the owner's edits (marked edited_by_user -- never auto re-derived). */
export function useSaveArtDirection(brandId: string) {
  return useMutation({
    mutationFn: async (artDirection: ArtDirection) => readArtDirection(
      await fetch(`/api/v1/brands/${brandId}/art-direction`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ art_direction: artDirection }),
      }),
      "Couldn't save the brand look. Please try again.",
    ),
    ...useOnArtDirectionChange(brandId),
  })
}

/** Derives a fresh suggestion from the brand (replaces any edits). */
export function useRefreshArtDirection(brandId: string) {
  return useMutation({
    mutationFn: async () => readArtDirection(
      await fetch(`/api/v1/brands/${brandId}/art-direction`, { method: "POST" }),
      "Couldn't generate the brand look. Please try again.",
    ),
    ...useOnArtDirectionChange(brandId),
  })
}
