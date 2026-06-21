"use client"

import { useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import { ChevronDown, Plus } from "lucide-react"
import { useBrands } from "@/hooks/useBrand"
import { useBrandStore } from "@/stores/brandStore"

export function BrandSelector() {
  const router = useRouter()
  const params = useParams()
  const { data: brands = [] } = useBrands()
  const { activeBrand, activeBrandId, setActiveBrand } = useBrandStore()

  // Sync store with URL brand param
  useEffect(() => {
    const urlBrandId = params?.brandId as string | undefined
    if (urlBrandId && brands.length > 0) {
      const brand = brands.find((b) => b.id === urlBrandId)
      if (brand && brand.id !== activeBrandId) {
        setActiveBrand(brand)
      }
    }
  }, [params?.brandId, brands, activeBrandId, setActiveBrand])

  if (brands.length === 0) return null

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const brandId = e.target.value
    if (!brandId) {
      router.push("/brands")
      return
    }
    const brand = brands.find((b) => b.id === brandId)
    if (brand) {
      setActiveBrand(brand)
      router.push(`/brands/${brandId}`)
    }
  }

  return (
    <div className="relative flex items-center">
      <select
        className="h-8 appearance-none rounded-md border border-input bg-background pl-3 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        value={activeBrandId ?? ""}
        onChange={handleChange}
      >
        <option value="">Select brand…</option>
        {brands.map((b) => (
          <option key={b.id} value={b.id}>{b.name}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-muted-foreground" />
    </div>
  )
}
