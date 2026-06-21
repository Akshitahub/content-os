"use client"

import Link from "next/link"
import { ArrowRight, Globe, AtSign } from "lucide-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { useBrandStore } from "@/stores/brandStore"
import type { BrandRow } from "@/types/database"
import { cn } from "@/lib/utils"

interface BrandCardProps {
  brand: BrandRow
}

export function BrandCard({ brand }: BrandCardProps) {
  const { activeBrandId, setActiveBrand } = useBrandStore()
  const isActive = activeBrandId === brand.id

  return (
    <Link
      href={`/brands/${brand.id}`}
      onClick={() => setActiveBrand(brand)}
      className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
    >
      <Card
        className={cn(
          "h-full transition-all duration-150 hover:shadow-md hover:-translate-y-0.5",
          isActive && "border-primary ring-1 ring-primary"
        )}
      >
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            {/* Brand avatar */}
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">
              {brand.name.slice(0, 2).toUpperCase()}
            </div>
            {isActive && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                Active
              </span>
            )}
          </div>
          <h3 className="mt-2 font-semibold leading-tight">{brand.name}</h3>
          {brand.niche && (
            <p className="text-xs text-muted-foreground">{brand.niche}</p>
          )}
        </CardHeader>

        <CardContent className="space-y-3">
          {brand.description && (
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {brand.description}
            </p>
          )}

          {/* Links row */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {brand.instagram_handle && (
              <span className="flex items-center gap-1">
                <AtSign className="h-3 w-3" />@{brand.instagram_handle}
              </span>
            )}
            {brand.website_url && (
              <span className="flex items-center gap-1">
                <Globe className="h-3 w-3" />
                {new URL(brand.website_url).hostname.replace("www.", "")}
              </span>
            )}
          </div>

          {/* Brand values */}
          {brand.brand_values.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {brand.brand_values.slice(0, 3).map((value) => (
                <span
                  key={value}
                  className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {value}
                </span>
              ))}
              {brand.brand_values.length > 3 && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  +{brand.brand_values.length - 3}
                </span>
              )}
            </div>
          )}

          <div className="flex items-center justify-end text-xs font-medium text-primary">
            Open brand <ArrowRight className="ml-1 h-3 w-3" />
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
