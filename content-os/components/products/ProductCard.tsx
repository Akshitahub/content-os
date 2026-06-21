"use client"

import { Package, Trash2, IndianRupee } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { ProductRow } from "@/types/database"

interface ProductCardProps {
  product: ProductRow
  onDelete?: (id: string) => void
}

export function ProductCard({ product, onDelete }: ProductCardProps) {
  return (
    <Card className="group relative transition-all hover:shadow-md">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Package className="h-4 w-4 text-primary" />
            </div>
            <CardTitle className="text-sm leading-tight">{product.name}</CardTitle>
          </div>
          {onDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(product.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {product.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{product.description}</p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {product.price && (
            <span className="flex items-center gap-0.5 font-medium text-foreground">
              <IndianRupee className="h-3 w-3" />{product.price.toLocaleString("en-IN")}
            </span>
          )}
          {product.category && <span className="rounded-full bg-secondary px-2 py-0.5">{product.category}</span>}
        </div>
        {product.key_benefits?.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {product.key_benefits.slice(0, 3).map((benefit) => (
              <span key={benefit} className="rounded-full bg-primary/8 px-2 py-0.5 text-xs text-primary">
                {benefit}
              </span>
            ))}
            {product.key_benefits.length > 3 && (
              <span className="rounded-full bg-primary/8 px-2 py-0.5 text-xs text-primary">
                +{product.key_benefits.length - 3} more
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
