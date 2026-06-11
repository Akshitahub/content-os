import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { ProductRow } from "@/types/database"
import type { CreateProductInput, UpdateProductInput } from "@/lib/validations/product"
import { isApiError } from "@/types/api"

export const productKeys = {
  all: (brandId: string) => ["products", brandId] as const,
  lists: (brandId: string) => [...productKeys.all(brandId), "list"] as const,
  detail: (brandId: string, productId: string) => [...productKeys.all(brandId), "detail", productId] as const,
}

async function fetchProducts(brandId: string): Promise<ProductRow[]> {
  const res = await fetch(`/api/v1/brands/${brandId}/products`)
  const json = await res.json()
  if (!res.ok || isApiError(json)) throw new Error(isApiError(json) ? json.error.message : "Failed to fetch products")
  return json.data
}

async function createProduct(brandId: string, input: CreateProductInput): Promise<ProductRow> {
  const res = await fetch(`/api/v1/brands/${brandId}/products`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  const json = await res.json()
  if (!res.ok || isApiError(json)) throw new Error(isApiError(json) ? json.error.message : "Failed to create product")
  return json.data
}

async function updateProduct(brandId: string, productId: string, input: UpdateProductInput): Promise<ProductRow> {
  const res = await fetch(`/api/v1/brands/${brandId}/products/${productId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  const json = await res.json()
  if (!res.ok || isApiError(json)) throw new Error(isApiError(json) ? json.error.message : "Failed to update product")
  return json.data
}

async function deleteProduct(brandId: string, productId: string): Promise<void> {
  const res = await fetch(`/api/v1/brands/${brandId}/products/${productId}`, { method: "DELETE" })
  const json = await res.json()
  if (!res.ok || isApiError(json)) throw new Error(isApiError(json) ? json.error.message : "Failed to delete product")
}

export function useProducts(brandId: string) {
  return useQuery({
    queryKey: productKeys.lists(brandId),
    queryFn: () => fetchProducts(brandId),
    enabled: !!brandId,
  })
}

export function useCreateProduct(brandId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateProductInput) => createProduct(brandId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: productKeys.lists(brandId) }),
  })
}

export function useUpdateProduct(brandId: string, productId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateProductInput) => updateProduct(brandId, productId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: productKeys.lists(brandId) }),
  })
}

export function useDeleteProduct(brandId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (productId: string) => deleteProduct(brandId, productId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: productKeys.lists(brandId) }),
  })
}
