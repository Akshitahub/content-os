import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { BrandRow } from "@/types/database"
import type { CreateBrandInput, UpdateBrandInput } from "@/lib/validations/brand"
import { isApiError } from "@/types/api"

// Query key factory — keeps keys consistent across the app
export const brandKeys = {
  all: ["brands"] as const,
  lists: () => [...brandKeys.all, "list"] as const,
  detail: (id: string) => [...brandKeys.all, "detail", id] as const,
}

async function fetchBrands(): Promise<BrandRow[]> {
  const res = await fetch("/api/v1/brands")
  const json = await res.json()
  if (!res.ok || isApiError(json)) {
    throw new Error(isApiError(json) ? json.error.message : "Failed to fetch brands")
  }
  return json.data
}

async function fetchBrand(brandId: string): Promise<BrandRow> {
  const res = await fetch(`/api/v1/brands/${brandId}`)
  const json = await res.json()
  if (!res.ok || isApiError(json)) {
    throw new Error(isApiError(json) ? json.error.message : "Failed to fetch brand")
  }
  return json.data
}

async function createBrand(input: CreateBrandInput): Promise<BrandRow> {
  const res = await fetch("/api/v1/brands", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  const json = await res.json()
  if (!res.ok || isApiError(json)) {
    throw new Error(isApiError(json) ? json.error.message : "Failed to create brand")
  }
  return json.data
}

async function updateBrand(brandId: string, input: UpdateBrandInput): Promise<BrandRow> {
  const res = await fetch(`/api/v1/brands/${brandId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  const json = await res.json()
  if (!res.ok || isApiError(json)) {
    throw new Error(isApiError(json) ? json.error.message : "Failed to update brand")
  }
  return json.data
}

async function deleteBrand(brandId: string): Promise<void> {
  const res = await fetch(`/api/v1/brands/${brandId}`, { method: "DELETE" })
  const json = await res.json()
  if (!res.ok || isApiError(json)) {
    throw new Error(isApiError(json) ? json.error.message : "Failed to delete brand")
  }
}

// ─── Hooks ───────────────────────────────────────────────

export function useBrands() {
  return useQuery({
    queryKey: brandKeys.lists(),
    queryFn: fetchBrands,
  })
}

export function useBrand(brandId: string) {
  return useQuery({
    queryKey: brandKeys.detail(brandId),
    queryFn: () => fetchBrand(brandId),
    enabled: !!brandId,
  })
}

export function useCreateBrand() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createBrand,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: brandKeys.lists() })
    },
  })
}

export function useUpdateBrand(brandId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateBrandInput) => updateBrand(brandId, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(brandKeys.detail(brandId), updated)
      queryClient.invalidateQueries({ queryKey: brandKeys.lists() })
    },
  })
}

export function useDeleteBrand() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteBrand,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: brandKeys.lists() })
    },
  })
}
