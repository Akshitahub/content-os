"use client"

import { Suspense, useEffect } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { GenerationPanel } from "@/components/generate/GenerationPanel"
import { useProducts } from "@/hooks/useProducts"
import { useBrand } from "@/hooks/useBrand"
import { useBrandStore } from "@/stores/brandStore"
import { useGenerationStore } from "@/stores/generationStore"
import { FESTIVAL_CATALOG } from "@/lib/occasions/festival-catalog"

function GenerateContent() {
  const params = useParams()
  const brandId = params.brandId as string
  const searchParams = useSearchParams()

  const { data: brand } = useBrand(brandId)
  const { data: products = [], isLoading: productsLoading } = useProducts(brandId)
  const { setActiveBrand } = useBrandStore()
  const { setOccasionContext, setContentAdditionalContext, setPendingTopic } = useGenerationStore()

  useEffect(() => {
    if (brand) setActiveBrand(brand)
  }, [brand, setActiveBrand])

  useEffect(() => {
    const occasionId = searchParams.get("occasion")
    if (!occasionId) {
      setOccasionContext(null)
      return
    }
    const occasion = FESTIVAL_CATALOG.find((o) => o.id === occasionId)
    if (!occasion || !occasion.suggestedAngle) {
      setOccasionContext(null)
      return
    }
    setOccasionContext({ id: occasion.id, name: occasion.name, angle: occasion.suggestedAngle })
    setContentAdditionalContext(occasion.suggestedAngle)
    setPendingTopic(occasion.suggestedAngle)
  }, [searchParams, setOccasionContext, setContentAdditionalContext, setPendingTopic])

  return (
    <>
      {productsLoading ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="h-64 animate-pulse rounded-lg bg-secondary" />
          <div className="h-64 animate-pulse rounded-lg bg-secondary" />
        </div>
      ) : (
        <GenerationPanel brandId={brandId} products={products} />
      )}
    </>
  )
}

export default function GeneratePage() {
  return (
    <div className="px-4 py-6 md:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Create content</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Generate scroll-stopping content in your brand voice.
        </p>
      </div>

      <Suspense
        fallback={
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="h-64 animate-pulse rounded-lg bg-secondary" />
            <div className="h-64 animate-pulse rounded-lg bg-secondary" />
          </div>
        }
      >
        <GenerateContent />
      </Suspense>
    </div>
  )
}
