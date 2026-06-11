import Link from "next/link"
import { Plus } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { BrandCard } from "@/components/brands/BrandCard"
import { Button } from "@/components/ui/button"
import type { Metadata } from "next"
import type { BrandRow } from "@/types/database"

export const metadata: Metadata = { title: "Brands" }

export default async function BrandsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: brands } = await supabase
    .from("brands")
    .select("*")
    .eq("user_id", user!.id)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .returns<BrandRow[]>()

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Brands</h1>
          <p className="mt-1 text-muted-foreground">
            Manage your brand identities and AI personas.
          </p>
        </div>
        <Button asChild>
          <Link href="/brands/new">
            <Plus className="h-4 w-4" />
            New brand
          </Link>
        </Button>
      </div>

      {!brands || brands.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-16 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Plus className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-lg font-semibold">No brands yet</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Create your first brand to start generating AI content tailored to
            your identity, audience, and tone.
          </p>
          <Button asChild className="mt-6">
            <Link href="/brands/new">Create your first brand</Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {brands.map((brand) => (
            <BrandCard key={brand.id} brand={brand} />
          ))}
        </div>
      )}
    </div>
  )
}
