// Server-side "what date/time is it in India" helpers. The server process
// itself may run in any timezone (UTC in most hosting environments), so
// plain `new Date()` day-boundary math (toISOString().split("T")[0],
// setHours(0,0,0,0), etc.) silently computes the wrong calendar day for a
// meaningful chunk of the day around the IST/UTC offset boundary. These two
// helpers centralize the fix via Intl's own IANA timezone support rather
// than hand-rolled +05:30 offset arithmetic (which also gets DST-in-other-
// zones and leap-second edge cases wrong in ways Intl doesn't).

const IST_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" })

const IST_PARTS_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
})

/**
 * Returns `d` (defaults to now) as a YYYY-MM-DD string in the Asia/Kolkata
 * timezone -- the correct "what calendar day is it in India" for server-side
 * code, unlike `new Date().toISOString().split("T")[0]` which reflects UTC.
 */
export function getISTDateString(d: Date = new Date()): string {
  // "en-CA" formats as YYYY-MM-DD natively -- no manual padding/joining.
  return IST_DATE_FORMATTER.format(d)
}

/**
 * Returns a Date object whose local year/month/day/hour/min/sec match the
 * current wall-clock time in Asia/Kolkata, for callers that need to do
 * day-arithmetic (setDate, addDays, etc.) against IST rather than the
 * server's own local timezone. Note this Date's *instant* (its UTC value)
 * is not "now" -- only its local-calendar fields are meaningful, which is
 * exactly what setDate()-style arithmetic operates on.
 */
export function getISTNow(): Date {
  const parts = IST_PARTS_FORMATTER.formatToParts(new Date())
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0)

  return new Date(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  )
}
