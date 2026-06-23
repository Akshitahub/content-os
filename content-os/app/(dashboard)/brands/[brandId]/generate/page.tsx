"use client"

import { useParams } from "next/navigation"
import { GenerationPanel } from "@/components/generate/GenerationPanel"
import { useProducts } from "@/hooks/useProducts"
import { useBrand } from "@/hooks/useBrand"
import { useBrandStore } from "@/stores/brandStore"
import { useEffect } from "react"

export default function GeneratePage() {
  const params = useParams()
  const brandId = params.brandId as string

  const { data: brand } = useBrand(brandId)
  const { data: products = [], isLoading: productsLoading } = useProducts(brandId)
  const { setActiveBrand } = useBrandStore()

  useEffect(() => {
    if (brand) setActiveBrand(brand)
  }, [brand, setActiveBrand])

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Generate content</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Generate hooks, captions, reel scripts, ad copy, blog posts and images — all in your brand voice.
        </p>
      </div>

      {productsLoading ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="h-64 animate-pulse rounded-lg bg-secondary" />
          <div className="h-64 animate-pulse rounded-lg bg-secondary" />
        </div>
      ) : (
        <GenerationPanel brandId={brandId} products={products} />
      )}
    </div>
  )
}
