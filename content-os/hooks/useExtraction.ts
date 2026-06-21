import { useMutation } from "@tanstack/react-query"
import { isApiError } from "@/types/api"
import type { ExtractedBrandData, ExtractedProductData } from "@/lib/ai/url-extractor"

async function postExtract<T>(endpoint: string, url: string): Promise<T> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  })
  const json = await res.json()
  if (!res.ok || isApiError(json)) {
    throw new Error(isApiError(json) ? json.error.message : "Couldn't read that page.")
  }
  return json.data
}

export function useExtractBrandFromUrl() {
  return useMutation({
    mutationFn: (url: string) => postExtract<ExtractedBrandData>("/api/v1/ai/extract/brand", url),
  })
}

export function useExtractProductFromUrl() {
  return useMutation({
    mutationFn: (url: string) => postExtract<ExtractedProductData>("/api/v1/ai/extract/product", url),
  })
}
