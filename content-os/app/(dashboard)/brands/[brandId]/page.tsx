import { notFound } from "next/navigation"
import Link from "next/link"
import { Package, Sparkles, Calendar, ArrowRight, Globe, AtSign, Edit } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { Metadata } from "next"
import type { BrandRow } from "@/types/database"

type PageProps = { params: Promise<{ brandId: string }> }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { brandId } = await params
  const supabase = await createClient()
  const { data } = await supabase
    .from("brands")
    .select("name")
    .eq("id", brandId)
    .single<Pick<BrandRow, "name">>()
  return { title: data?.name ?? "Brand" }
}

export default async function BrandDetailPage({ params }: PageProps) {
  const { brandId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: brand } = await supabase
    .from("brands")
    .select("*")
    .eq("id", brandId)
    .eq("user_id", user!.id)
    .single<BrandRow>()

  if (!brand) notFound()

  const [{ count: productCount }, { count: hookCount }] = await Promise.all([
    supabase.from("products").select("*", { count: "exact", head: true }).eq("brand_id", brandId).eq("is_active", true),
    supabase.from("hooks").select("*", { count: "exact", head: true }).eq("brand_id", brandId).eq("is_saved", true),
  ])

  const quickActions = [
    { label: "Products", description: "Manage your product catalog", href: `/brands/${brandId}/products`, icon: Package, count: productCount ?? 0, countLabel: "products" },
    { label: "Generate", description: "Create AI hooks and captions", href: `/brands/${brandId}/generate`, icon: Sparkles, count: hookCount ?? 0, countLabel: "saved hooks" },
    { label: "Calendar", description: "Plan your content schedule", href: `/brands/${brandId}/calendar`, icon: Calendar, count: null, countLabel: null },
  ]

  return (
    <div className="p-8">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-lg font-bold text-primary">
            {brand.name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{brand.name}</h1>
            <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
              {brand.niche && <span>{brand.niche}</span>}
              {brand.instagram_handle && (
                <span className="flex items-center gap-1">
                  <AtSign className="h-3.5 w-3.5" />{brand.instagram_handle}
                </span>
              )}
              {brand.website_url && (
                <a
                  href={brand.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 hover:text-foreground"
                >
                  <Globe className="h-3.5 w-3.5" />
                  {new URL(brand.website_url).hostname.replace("www.", "")}
                </a>
              )}
            </div>
          </div>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/brands/${brandId}/edit`}>
            <Edit className="h-4 w-4" />
            Edit brand
          </Link>
        </Button>
      </div>

      {/* Quick actions */}
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        {quickActions.map((action) => {
          const Icon = action.icon
          return (
            <Link key={action.href} href={action.href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
              <Card className="h-full transition-all hover:shadow-md hover:-translate-y-0.5">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <CardTitle className="text-sm">{action.label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">{action.description}</p>
                  {action.count !== null && (
                    <p className="mt-2 text-lg font-bold">
                      {action.count}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        {action.countLabel}
                      </span>
                    </p>
                  )}
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>

      {/* Brand details */}
      <div className="grid gap-6 lg:grid-cols-2">
        {(brand.target_audience || brand.tone_of_voice) && (
          <Card>
            <CardHeader><CardTitle className="text-sm">Audience & tone</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {brand.target_audience && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Target audience</p>
                  <p>{brand.target_audience}</p>
                </div>
              )}
              {brand.tone_of_voice && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Tone of voice</p>
                  <p>{brand.tone_of_voice}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {brand.brand_values.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-sm">Brand values</CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {brand.brand_values.map((value: string) => (
                  <span key={value} className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                    {value}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {brand.ai_persona && (
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-sm">AI persona</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground leading-relaxed">{brand.ai_persona}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
