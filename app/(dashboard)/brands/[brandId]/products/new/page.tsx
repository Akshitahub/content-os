"use client"

import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { ProductForm } from "@/components/products/ProductForm"
import { useCreateProduct } from "@/hooks/useProducts"
import type { CreateProductInput } from "@/lib/validations/product"

export default function NewProductPage() {
  const params = useParams()
  const router = useRouter()
  const brandId = params.brandId as string
  const { mutateAsync: createProduct, isPending } = useCreateProduct(brandId)

  async function handleSubmit(data: CreateProductInput) {
    await createProduct(data)
    router.push(`/brands/${brandId}/products`)
  }

  return (
    <div className="p-8 max-w-2xl">
      <Link
        href={`/brands/${brandId}/products`}
        className="mb-6 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to products
      </Link>
      <h1 className="text-2xl font-bold tracking-tight mb-1">Add a product</h1>
      <p className="text-sm text-muted-foreground mb-8">
        The more detail you add, the better the AI can tailor content around this product.
      </p>
      <div className="rounded-lg border bg-card p-6">
        <ProductForm
          onSubmit={handleSubmit}
          onCancel={() => router.push(`/brands/${brandId}/products`)}
          isLoading={isPending}
        />
      </div>
    </div>
  )
}
