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
    <div className="px-4 py-6 md:p-8">
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Content Calendar</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your 30-day content plan. Click any date to edit or add a post.
          </p>
        </div>
        <a
          href={`/brands/${brandId}/fastlane`}
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700 transition-colors shrink-0"
        >
          ✈️ Run Autopilot
        </a>
      </div>
      <ContentCalendar brandId={brandId} />
    </div>
  )
}
