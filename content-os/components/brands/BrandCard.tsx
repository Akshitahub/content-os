"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowRight, Globe, AtSign, MoreVertical, CreditCard, Trash2 } from "lucide-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { useBrandStore } from "@/stores/brandStore"
import { useDeleteBrand } from "@/hooks/useBrand"
import type { BrandRow } from "@/types/database"
import { cn } from "@/lib/utils"

interface BrandCardProps {
  brand: BrandRow
}

export function BrandCard({ brand }: BrandCardProps) {
  const router = useRouter()
  const { activeBrandId, setActiveBrand } = useBrandStore()
  const isActive = activeBrandId === brand.id
  const deleteBrand = useDeleteBrand()
  const [deleteConfirming, setDeleteConfirming] = useState(false)

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
            <div className="flex shrink-0 items-center gap-1.5">
              {isActive && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  Active
                </span>
              )}
              {/* This whole card is a real <Link>, not a click-handler div
               * like the Library cards this dropdown pattern is borrowed
               * from -- a click anywhere inside a native <a> triggers the
               * browser's own navigation unless prevented, not just
               * React's synthetic bubbling, so this trigger (and the
               * delete-confirm buttons below) need preventDefault() too,
               * not just stopPropagation(). */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label="Brand actions"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44" onClick={(e) => e.stopPropagation()}>
                  {/* Plain callbacks, no preventDefault -- Radix's
                   * DropdownMenuItem treats onSelect's preventDefault() as
                   * "keep the menu open," which isn't wanted for either of
                   * these (the menu should close normally either way). */}
                  <DropdownMenuItem onSelect={() => router.push("/settings#plan-usage")}>
                    <CreditCard className="h-3.5 w-3.5" /> Change plan
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => setDeleteConfirming(true)}
                    className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete brand
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <h3 className="mt-2 font-semibold leading-tight">{brand.name}</h3>
          {brand.niche && (
            <p className="text-xs text-muted-foreground">{brand.niche}</p>
          )}
          {deleteConfirming && (
            <div onClick={(e) => { e.preventDefault(); e.stopPropagation() }} className="pt-1">
              <DeleteConfirmButton
                confirming={deleteConfirming}
                onConfirmingChange={setDeleteConfirming}
                onDelete={async () => {
                  await deleteBrand.mutateAsync(brand.id)
                  // This page (app/(dashboard)/brands/page.tsx) is a
                  // Server Component that fetches the brand list directly
                  // via Supabase, not through useBrands() -- invalidating
                  // the React Query cache alone (useDeleteBrand's own
                  // onSuccess) does nothing here, so the deleted card
                  // would keep showing until a manual reload without this.
                  router.refresh()
                }}
              />
            </div>
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
