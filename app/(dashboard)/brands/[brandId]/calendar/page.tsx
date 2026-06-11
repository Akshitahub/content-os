"use client"

import { useParams } from "next/navigation"
import { ContentCalendar } from "@/components/calendar/ContentCalendar"
import { useBrand } from "@/hooks/useBrand"
import { useBrandStore } from "@/stores/brandStore"
import { useEffect } from "react"

export default function CalendarPage() {
  const params = useParams()
  const brandId = params.brandId as string
  const { data: brand } = useBrand(brandId)
  const { setActiveBrand } = useBrandStore()

  useEffect(() => {
    if (brand) setActiveBrand(brand)
  }, [brand, setActiveBrand])

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Content Calendar</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Plan and track your content schedule. Click any date to add an entry.
        </p>
      </div>
      <ContentCalendar brandId={brandId} />
    </div>
  )
}
