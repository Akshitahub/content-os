"use client"

import { useState, useEffect } from "react"
import { ChevronLeft, ChevronRight, Plus, X, Loader2 } from "lucide-react"
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isToday, parseISO } from "date-fns"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { CalendarEntryRow } from "@/types/database"

const STATUS_COLORS: Record<string, string> = {
  planned: "bg-slate-100 text-slate-700 border-slate-200",
  content_ready: "bg-blue-100 text-blue-700 border-blue-200",
  scheduled: "bg-purple-100 text-purple-700 border-purple-200",
  published: "bg-green-100 text-green-700 border-green-200",
  missed: "bg-red-100 text-red-700 border-red-200",
}

const PLATFORM_EMOJIS: Record<string, string> = {
  instagram: "📸",
  tiktok: "🎵",
  facebook: "👤",
  youtube: "▶️",
  linkedin: "💼",
  twitter: "🐦",
}

interface ContentCalendarProps {
  brandId: string
}

interface NewEntryForm {
  title: string
  scheduled_date: string
  platform: string
  content_type: string
  notes: string
  status: string
}

export function ContentCalendar({ brandId }: ContentCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [entries, setEntries] = useState<CalendarEntryRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showNewEntryModal, setShowNewEntryModal] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [form, setForm] = useState<NewEntryForm>({
    title: "", scheduled_date: "", platform: "instagram",
    content_type: "reel", notes: "", status: "planned",
  })

  const month = format(currentDate, "yyyy-MM")

  async function fetchEntries() {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/v1/calendar?brandId=${brandId}&month=${month}`)
      const json = await res.json()
      if (json.data) setEntries(json.data)
    } catch {
      // silent
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { fetchEntries() }, [brandId, month]) // eslint-disable-line

  const days = eachDayOfInterval({ start: startOfMonth(currentDate), end: endOfMonth(currentDate) })
  const startDayOfWeek = startOfMonth(currentDate).getDay()

  function openNewEntry(dateStr?: string) {
    setForm({
      title: "", scheduled_date: dateStr ?? format(new Date(), "yyyy-MM-dd"),
      platform: "instagram", content_type: "reel", notes: "", status: "planned",
    })
    setSelectedDate(dateStr ?? null)
    setShowNewEntryModal(true)
  }

  async function handleSave() {
    if (!form.title || !form.scheduled_date) return
    setIsSaving(true)
    try {
      const res = await fetch("/api/v1/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, brand_id: brandId }),
      })
      const json = await res.json()
      if (json.data) {
        setEntries((prev) => [...prev, json.data])
        setShowNewEntryModal(false)
      }
    } catch {
      // silent
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete(entryId: string) {
    await fetch(`/api/v1/calendar?id=${entryId}`, { method: "DELETE" })
    setEntries((prev) => prev.filter((e) => e.id !== entryId))
  }

  function getEntriesForDay(date: Date): CalendarEntryRow[] {
    const dateStr = format(date, "yyyy-MM-dd")
    return entries.filter((e) => e.scheduled_date === dateStr)
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-semibold">{format(currentDate, "MMMM yyyy")}</h2>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button size="sm" onClick={() => openNewEntry()}>
          <Plus className="h-4 w-4 mr-1.5" /> Add entry
        </Button>
      </div>

      {/* Day labels */}
      <div className="mb-1 grid grid-cols-7 gap-px">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="py-2 text-center text-xs font-medium text-muted-foreground">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden border">
          {/* Empty cells before month starts */}
          {Array.from({ length: startDayOfWeek }).map((_, i) => (
            <div key={`empty-${i}`} className="bg-muted/30 min-h-[100px] p-1" />
          ))}

          {days.map((day) => {
            const dayEntries = getEntriesForDay(day)
            const dateStr = format(day, "yyyy-MM-dd")
            const isCurrentMonth = isSameMonth(day, currentDate)
            const today = isToday(day)

            return (
              <div
                key={dateStr}
                className={`bg-background min-h-[100px] p-1.5 cursor-pointer hover:bg-muted/30 transition-colors ${!isCurrentMonth ? "opacity-40" : ""}`}
                onClick={() => openNewEntry(dateStr)}
              >
                <div className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${today ? "bg-primary text-primary-foreground" : "text-foreground"}`}>
                  {format(day, "d")}
                </div>
                <div className="space-y-0.5">
                  {dayEntries.slice(0, 3).map((entry) => (
                    <div
                      key={entry.id}
                      className={`flex items-center gap-1 rounded px-1 py-0.5 text-xs border truncate ${STATUS_COLORS[entry.status] ?? STATUS_COLORS.planned}`}
                      onClick={(e) => { e.stopPropagation(); handleDelete(entry.id) }}
                      title={`${entry.title} — click to delete`}
                    >
                      {entry.platform && <span>{PLATFORM_EMOJIS[entry.platform]}</span>}
                      <span className="truncate">{entry.title}</span>
                    </div>
                  ))}
                  {dayEntries.length > 3 && (
                    <p className="text-xs text-muted-foreground pl-1">+{dayEntries.length - 3} more</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Legend */}
      <div className="mt-4 flex flex-wrap gap-3">
        {Object.entries(STATUS_COLORS).map(([status, classes]) => (
          <div key={status} className="flex items-center gap-1.5">
            <div className={`h-3 w-3 rounded border ${classes}`} />
            <span className="text-xs text-muted-foreground capitalize">{status.replace("_", " ")}</span>
          </div>
        ))}
      </div>

      {/* New entry modal */}
      {showNewEntryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border bg-card shadow-xl">
            <div className="flex items-center justify-between p-5 border-b">
              <h3 className="font-semibold">New calendar entry</h3>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowNewEntryModal(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-5 space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Title <span className="text-destructive">*</span></Label>
                <Input placeholder="e.g. Diwali product reel" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Date</Label>
                <Input type="date" value={form.scheduled_date} onChange={(e) => setForm({ ...form, scheduled_date: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Platform</Label>
                  <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
                    {["instagram","tiktok","facebook","youtube","linkedin","twitter"].map((p) => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Content type</Label>
                  <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" value={form.content_type} onChange={(e) => setForm({ ...form, content_type: e.target.value })}>
                    {["reel","post","story","carousel","thread"].map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {["planned","content_ready","scheduled","published","missed"].map((s) => <option key={s} value={s}>{s.replace("_"," ").replace(/\b\w/g, (c) => c.toUpperCase())}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Notes</Label>
                <textarea rows={2} placeholder="Any notes about this piece of content" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-2 p-5 border-t">
              <Button variant="outline" onClick={() => setShowNewEntryModal(false)} disabled={isSaving}>Cancel</Button>
              <Button onClick={handleSave} disabled={isSaving || !form.title}>
                {isSaving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : "Save entry"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
