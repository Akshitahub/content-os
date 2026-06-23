"use client"

import { useParams, useSearchParams } from "next/navigation"
import { GenerationPanel } from "@/components/generate/GenerationPanel"
import { useProducts } from "@/hooks/useProducts"
import { useBrand } from "@/hooks/useBrand"
import { useBrandStore } from "@/stores/brandStore"
import { useGenerationStore } from "@/stores/generationStore"
import { useEffect } from "react"
import { OCCASIONS } from "@/lib/occasions/occasions-data"

export default function GeneratePage() {
  const params = useParams()
  const brandId = params.brandId as string
  const searchParams = useSearchParams()

  const { data: brand } = useBrand(brandId)
  const { data: products = [], isLoading: productsLoading } = useProducts(brandId)
  const { setActiveBrand } = useBrandStore()
  const { setOccasionContext, setHookAdditionalContext, setContentAdditionalContext } = useGenerationStore()

  useEffect(() => {
    if (brand) setActiveBrand(brand)
  }, [brand, setActiveBrand])

  useEffect(() => {
    const occasionId = searchParams.get("occasion")
    if (!occasionId) {
      setOccasionContext(null)
      return
    }
    const occasion = OCCASIONS.find((o) => o.id === occasionId)
    if (!occasion) {
      setOccasionContext(null)
      return
    }
    setOccasionContext({ id: occasion.id, name: occasion.name, angle: occasion.suggestedAngle })
    setHookAdditionalContext(occasion.suggestedAngle)
    setContentAdditionalContext(occasion.suggestedAngle)
  }, [searchParams, setOccasionContext, setHookAdditionalContext, setContentAdditionalContext])

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
