"use client"

import { useState } from "react"
import { useParams } from "next/navigation"
import { Plus, Package } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ProductCard } from "@/components/products/ProductCard"
import { ProductForm } from "@/components/products/ProductForm"
import { useProducts, useCreateProduct, useDeleteProduct } from "@/hooks/useProducts"
import type { CreateProductInput } from "@/lib/validations/product"

export default function ProductsPage() {
  const params = useParams()
  const brandId = params.brandId as string
  const [showForm, setShowForm] = useState(false)

  const { data: products = [], isLoading } = useProducts(brandId)
  const { mutateAsync: createProduct, isPending: isCreating } = useCreateProduct(brandId)
  const { mutate: deleteProduct } = useDeleteProduct(brandId)

  async function handleCreate(data: CreateProductInput) {
    await createProduct(data)
    setShowForm(false)
  }

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Products</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your product catalog — the AI uses these to generate targeted content.
          </p>
        </div>
        <Button onClick={() => setShowForm(true)} size="sm">
          <Plus className="h-4 w-4 mr-1.5" /> Add product
        </Button>
      </div>

      {showForm && (
        <div className="mb-8 rounded-lg border bg-card p-6">
          <h2 className="mb-4 text-sm font-semibold">New product</h2>
          <ProductForm
            onSubmit={handleCreate}
            onCancel={() => setShowForm(false)}
            isLoading={isCreating}
          />
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1,2,3].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-lg bg-secondary" />
          ))}
        </div>
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-16 text-center">
          <Package className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <h2 className="text-base font-semibold">No products yet</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            No products yet — add your first product so the AI can generate content specifically about what you sell.
          </p>
          <Button className="mt-6" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> Add your first product
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onDelete={(id) => deleteProduct(id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
