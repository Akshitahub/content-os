"use client"

import { Loader2, X } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useBrandPhotos, useRemoveBrandPhoto } from "@/hooks/useBrandPhotos"

// "Your photos": the brand's own photos SocioPosts collected from its
// website and Instagram (lib/brand-photos.ts). Read-only apart from removing
// one -- never an upload prompt or a required step.

export function BrandPhotosStrip({ brandId }: { brandId: string }) {
  const { data: photos, isLoading } = useBrandPhotos(brandId)
  const remove = useRemoveBrandPhoto(brandId)

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="text-sm">Your photos</CardTitle>
        <CardDescription>Collected from your website and Instagram, and used in your posts and stories.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : !photos?.length ? (
          <p className="text-sm text-muted-foreground">We&apos;re collecting photos from your website and Instagram. They&apos;ll appear here.</p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {photos.map((p) => (
              <div key={p.id} className="group relative h-24 w-24 shrink-0 overflow-hidden rounded-md border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.kind ? `Brand photo (${p.kind.replace(/_/g, " ")})` : "Brand photo"} className="h-full w-full object-cover" loading="lazy" />
                <button
                  type="button"
                  aria-label="Remove this photo"
                  title="Remove -- it won't be used or collected again"
                  onClick={() => remove.mutate(p.id)}
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 focus:opacity-100 group-hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        {remove.error && <p className="mt-2 text-xs text-destructive">{remove.error.message}</p>}
      </CardContent>
    </Card>
  )
}
