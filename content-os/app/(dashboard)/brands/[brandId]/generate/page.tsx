"use client"

import { Suspense, useEffect } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { GenerationPanel } from "@/components/generate/GenerationPanel"
import { useProducts } from "@/hooks/useProducts"
import { useBrand } from "@/hooks/useBrand"
import { useBrandStore } from "@/stores/brandStore"
import { useGenerationStore } from "@/stores/generationStore"
import { OCCASIONS } from "@/lib/occasions/occasions-data"
import { Archive } from "lucide-react"
import Link from "next/link"
import type { HookRow, CaptionRow } from "@/types/database"
import { PostCard } from "@/components/shared/PostCard"

function RecentGenerations({ brandId }: { brandId: string }) {
  const { data: hooks = [] } = useQuery({
    queryKey: ["recent-hooks", brandId],
    queryFn: async (): Promise<HookRow[]> => {
      const res = await fetch(`/api/v1/brands/${brandId}/hooks?saved=false&limit=5`)
      if (!res.ok) return []
      const json = await res.json() as { data: HookRow[] }
      return json.data ?? []
    },
    enabled: !!brandId,
  })

  const { data: captions = [] } = useQuery({
    queryKey: ["recent-captions", brandId],
    queryFn: async (): Promise<CaptionRow[]> => {
      const res = await fetch(`/api/v1/brands/${brandId}/captions?saved=false&limit=5`)
      if (!res.ok) return []
      const json = await res.json() as { data: CaptionRow[] }
      return json.data ?? []
    },
    enabled: !!brandId,
  })

  if (hooks.length === 0 && captions.length === 0) {
    return (
      <div className="mt-10 flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
        <Archive className="h-10 w-10 text-muted-foreground/30 mb-3" />
        <p className="text-sm font-medium text-muted-foreground">Your generated content will appear here</p>
        <p className="mt-1 text-xs text-muted-foreground">Use the panel above to generate your first hook or caption.</p>
      </div>
    )
  }

  return (
    <div className="mt-10">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">Recent generations</h2>
        <Link
          href={`/brands/${brandId}/library`}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <Archive className="h-3.5 w-3.5" />
          View My Content
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {hooks.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Hooks</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {hooks.map((hook, i) => (
                <PostCard
                  key={hook.id}
                  type="hook"
                  content={hook.hook_text}
                  platform="instagram"
                  hookType={hook.hook_type ?? undefined}
                  number={i + 1}
                  showScore
                  size="sm"
                />
              ))}
            </div>
          </div>
        )}

        {captions.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Captions</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {captions.map((caption, i) => (
                <PostCard
                  key={caption.id}
                  type="caption"
                  content={caption.caption_text}
                  platform={caption.platform ?? "instagram"}
                  number={i + 1}
                  showScore={false}
                  size="sm"
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function GenerateContent() {
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
    <>
      {productsLoading ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="h-64 animate-pulse rounded-lg bg-secondary" />
          <div className="h-64 animate-pulse rounded-lg bg-secondary" />
        </div>
      ) : (
        <GenerationPanel brandId={brandId} products={products} />
      )}

      <RecentGenerations brandId={brandId} />
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
