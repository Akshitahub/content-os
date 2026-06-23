import Link from "next/link"
import { Calendar } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { getUpcomingOccasions } from "@/lib/occasions/get-upcoming-occasions"
import type { OccasionCategory } from "@/lib/occasions/occasions-data"

const CATEGORY_STYLES: Record<OccasionCategory, string> = {
  festival: "bg-orange-100 text-orange-700",
  awareness: "bg-teal-100 text-teal-700",
  shopping: "bg-violet-100 text-violet-700",
}

const CATEGORY_LABELS: Record<OccasionCategory, string> = {
  festival: "Festival",
  awareness: "Awareness",
  shopping: "Shopping",
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" })
}

function daysLabel(daysUntil: number): string {
  if (daysUntil === 0) return "Today"
  if (daysUntil === 1) return "Tomorrow"
  return `In ${daysUntil} days`
}

interface Props {
  brandId?: string | null
}

export function UpcomingOccasions({ brandId }: Props) {
  const occasions = getUpcomingOccasions(14).slice(0, 3)

  if (occasions.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Upcoming occasions</CardTitle>
        </div>
        <CardDescription>Content angles for the next 2 weeks</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {occasions.map((occasion) => (
          <div
            key={occasion.id}
            className="flex items-start justify-between gap-4 rounded-lg border p-4"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{occasion.name}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_STYLES[occasion.category]}`}
                >
                  {CATEGORY_LABELS[occasion.category]}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDate(occasion.occurrenceDate)} · {daysLabel(occasion.daysUntil)}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                {occasion.suggestedAngle}
              </p>
            </div>
            <Button asChild size="sm" variant="outline" className="shrink-0">
              <Link
                href={
                  brandId
                    ? `/brands/${brandId}/generate?occasion=${occasion.id}`
                    : "/brands/new"
                }
              >
                Create post →
              </Link>
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
