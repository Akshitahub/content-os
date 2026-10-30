import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { isApiError } from "@/types/api"
import { readJsonResponse } from "@/lib/utils/read-json-response"

// The brand's automatically collected photos (lib/brand-photos.ts) --
// app/api/v1/brands/[brandId]/photos.
export const brandPhotoKeys = {
  brand: (brandId: string) => ["brand-photos", brandId] as const,
}

export interface BrandPhotoItem {
  id: string
  url: string
  kind: string | null
  source: "website" | "instagram" | "upload"
}

async function readData<T>(res: Response, fallback: string): Promise<T> {
  const json: unknown = await readJsonResponse(res)
  if (!res.ok || isApiError(json)) throw new Error(isApiError(json) ? json.error.message : fallback)
  return (json as { data: T }).data
}

export function useBrandPhotos(brandId: string) {
  return useQuery({
    queryKey: brandPhotoKeys.brand(brandId),
    queryFn: async () => (await readData<{ photos: BrandPhotoItem[] }>(await fetch(`/api/v1/brands/${brandId}/photos`), "Couldn't load photos.")).photos,
    enabled: !!brandId,
  })
}

export function useRemoveBrandPhoto(brandId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (photoId: string) => readData<{ id: string }>(
      await fetch(`/api/v1/brands/${brandId}/photos/${photoId}`, { method: "DELETE" }),
      "Couldn't remove the photo. Please try again.",
    ),
    // Optimistic: the photo disappears at once; the refetch settles it.
    onMutate: async (photoId) => {
      await queryClient.cancelQueries({ queryKey: brandPhotoKeys.brand(brandId) })
      const previous = queryClient.getQueryData<BrandPhotoItem[]>(brandPhotoKeys.brand(brandId))
      queryClient.setQueryData<BrandPhotoItem[]>(brandPhotoKeys.brand(brandId), (list) => list?.filter((p) => p.id !== photoId))
      return { previous }
    },
    onError: (_err, _photoId, context) => {
      if (context?.previous) queryClient.setQueryData(brandPhotoKeys.brand(brandId), context.previous)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: brandPhotoKeys.brand(brandId) })
    },
  })
}
