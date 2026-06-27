"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { BrandForm } from "@/components/brands/BrandForm"
import { useCreateBrand } from "@/hooks/useBrand"
import { useBrandStore } from "@/stores/brandStore"
import type { CreateBrandInput } from "@/lib/validations/brand"

export default function NewBrandPage() {
  const router = useRouter()
  const createBrand = useCreateBrand()
  const setActiveBrand = useBrandStore((s) => s.setActiveBrand)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(data: CreateBrandInput) {
    setError(null)
    try {
      const brand = await createBrand.mutateAsync(data)
      // Auto-select the newly created brand
      setActiveBrand(brand)
      router.push(`/brands/${brand.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.")
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:p-8">
      <div className="mb-8">
        <Link
          href="/brands"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to brands
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Create a brand</h1>
        <p className="mt-1 text-muted-foreground">
          This is your AI&apos;s creative brief. The more detail you provide, the
          better your generated content will sound.
        </p>
      </div>

      <BrandForm
        onSubmit={handleSubmit}
        submitLabel="Create brand"
        isLoading={createBrand.isPending}
        error={error}
      />
    </div>
  )
}
