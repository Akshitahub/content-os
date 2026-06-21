import { OCCASIONS, type Occasion } from "./occasions-data"

export type UpcomingOccasion = Occasion & {
  daysUntil: number
  occurrenceDate: Date
}

export function getUpcomingOccasions(daysAhead = 14): UpcomingOccasion[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const results: UpcomingOccasion[] = []

  for (const occasion of OCCASIONS) {
    const [mm, dd] = occasion.date.split("-").map(Number)

    // Check this year first, then next year to handle the Dec→Jan wrap.
    for (const yearOffset of [0, 1]) {
      const year = today.getFullYear() + yearOffset
      const occDate = new Date(year, mm - 1, dd)
      occDate.setHours(0, 0, 0, 0)

      const diffMs = occDate.getTime() - today.getTime()
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

      if (diffDays >= 0 && diffDays <= daysAhead) {
        results.push({ ...occasion, daysUntil: diffDays, occurrenceDate: occDate })
        break
      }
    }
  }

  return results.sort((a, b) => a.daysUntil - b.daysUntil)
}
