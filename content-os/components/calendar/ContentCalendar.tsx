"use client"

import { useState, useEffect, useCallback } from "react"
import { ChevronLeft, ChevronRight, Plus, X, Loader2, LayoutGrid, List } from "lucide-react"
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isToday, startOfWeek, endOfWeek, addWeeks, subWeeks } from "date-fns"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CalendarEntryPanel } from "@/components/calendar/CalendarEntryPanel"
import { PostCard } from "@/components/shared/PostCard"
import type { CalendarEntryRow } from "@/types/database"

const STATUS_COLORS: Record<string, string> = {
  planned: "bg-slate-100 text-slate-700 border-slate-200",
  content_ready: "bg-blue-100 text-blue-700 border-blue-200",
  scheduled: "bg-purple-100 text-purple-700 border-purple-200",
  published: "bg-green-100 text-green-700 border-green-200",
  missed: "bg-red-100 text-red-700 border-red-200",
}

const PLATFORM_GRADIENTS: Record<string, string> = {
  instagram: "from-purple-500 to-pink-500",
  tiktok: "from-gray-900 to-black",
  facebook: "from-blue-600 to-indigo-700",
  youtube: "from-red-500 to-red-700",
  linkedin: "from-blue-700 to-blue-500",
  twitter: "from-sky-400 to-blue-500",
}

const STATUS_DOT: Record<string, string> = {
  planned: "bg-gray-400",
  content_ready: "bg-blue-500",
  scheduled: "bg-violet-500",
  published: "bg-emerald-500",
  missed: "bg-red-500",
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
  const [selectedEntry, setSelectedEntry] = useState<CalendarEntryRow | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [viewMode, setViewMode] = useState<"month" | "week">("month")
  const [form, setForm] = useState<NewEntryForm>({
    title: "", scheduled_date: "", platform: "instagram",
    content_type: "reel", notes: "", status: "planned",
  })

  const month = format(currentDate, "yyyy-MM")

  const fetchEntries = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/v1/calendar?brandId=${brandId}&month=${month}`)
      const json = await res.json() as { data?: CalendarEntryRow[] }
      if (json.data) setEntries(json.data)
    } catch {
      // silent
    } finally {
      setIsLoading(false)
    }
  }, [brandId, month])

  useEffect(() => { fetchEntries() }, [fetchEntries])

  const days = eachDayOfInterval({ start: startOfMonth(currentDate), end: endOfMonth(currentDate) })
  const startDayOfWeek = startOfMonth(currentDate).getDay()

  const weekStart = startOfWeek(currentDate)
  const weekEnd = endOfWeek(weekStart)
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd })

  function navigatePrev() {
    if (viewMode === "week") setCurrentDate(d => subWeeks(d, 1))
    else setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))
  }
  function navigateNext() {
    if (viewMode === "week") setCurrentDate(d => addWeeks(d, 1))
    else setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))
  }
  const headerLabel = viewMode === "week"
    ? `${format(weekStart, "MMM d")} – ${format(weekEnd, "MMM d, yyyy")}`
    : format(currentDate, "MMMM yyyy")

  function openNewEntry(dateStr?: string) {
    setSelectedEntry(null)
    setForm({
      title: "", scheduled_date: dateStr ?? format(new Date(), "yyyy-MM-dd"),
      platform: "instagram", content_type: "reel", notes: "", status: "planned",
    })
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
      const json = await res.json() as { data?: CalendarEntryRow }
      if (json.data) {
        setEntries(prev => [...prev, json.data!])
        setShowNewEntryModal(false)
      }
    } catch {
      // silent
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete(entryId: string, e: React.MouseEvent) {
    e.stopPropagation()
    await fetch(`/api/v1/calendar?id=${entryId}`, { method: "DELETE" })
    setEntries(prev => prev.filter(e => e.id !== entryId))
    if (selectedEntry?.id === entryId) setSelectedEntry(null)
  }

  function handleEntryUpdate(updated: CalendarEntryRow) {
    setEntries(prev => prev.map(e => e.id === updated.id ? updated : e))
    setSelectedEntry(updated)
  }

  function getEntriesForDay(date: Date): CalendarEntryRow[] {
    const dateStr = format(date, "yyyy-MM-dd")
    return entries.filter(e => e.scheduled_date === dateStr)
  }

  return (
    <div className="relative">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={navigatePrev}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-semibold min-w-[160px] text-center">{headerLabel}</h2>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={navigateNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex rounded-lg border overflow-hidden">
            <button
              type="button"
              onClick={() => setViewMode("month")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "month" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Month
            </button>
            <button
              type="button"
              onClick={() => setViewMode("week")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors border-l ${viewMode === "week" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              <List className="h-3.5 w-3.5" /> Week
            </button>
          </div>
          <Button size="sm" onClick={() => openNewEntry()}>
            <Plus className="h-4 w-4 mr-1.5" /> Add entry
          </Button>
        </div>
      </div>

      {/* Day labels */}
      <div className="mb-1 grid grid-cols-7 gap-px">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
          <div key={d} className="py-2 text-center text-xs font-medium text-muted-foreground">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : viewMode === "week" ? (
        /* ── WEEK VIEW ── */
        <div className="grid grid-cols-7 gap-2">
          {weekDays.map(day => {
            const dayEntries = getEntriesForDay(day)
            const dateStr = format(day, "yyyy-MM-dd")
            const today = isToday(day)
            return (
              <div key={dateStr} className="min-h-[200px] rounded-lg border bg-background p-2">
                {/* Day header */}
                <div
                  className={`mb-2 flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold cursor-pointer hover:bg-muted ${today ? "bg-primary text-primary-foreground" : "text-foreground"}`}
                  onClick={() => openNewEntry(dateStr)}
                >
                  {format(day, "d")}
                </div>
                {/* Entries as PostCard sm */}
                <div className="space-y-2">
                  {dayEntries.slice(0, 4).map((entry) => (
                    <div
                      key={entry.id}
                      className="cursor-pointer"
                      onClick={() => setSelectedEntry(entry)}
                    >
                      <PostCard
                        type={entry.content_type === "carousel" ? "carousel" : entry.content_type === "story" ? "story" : "caption"}
                        content={entry.title}
                        platform={(entry.platform as "instagram" | "tiktok" | "linkedin" | "twitter" | "facebook" | "youtube") ?? "instagram"}
                        showScore={false}
                        size="sm"
                      />
                    </div>
                  ))}
                  {dayEntries.length > 4 && (
                    <p className="text-[10px] text-muted-foreground text-center">+{dayEntries.length - 4} more</p>
                  )}
                  {dayEntries.length === 0 && (
                    <button
                      type="button"
                      onClick={() => openNewEntry(dateStr)}
                      className="w-full rounded border border-dashed py-2 text-[10px] text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
                    >
                      + Add
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        /* ── MONTH VIEW ── */
        <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden border">
          {Array.from({ length: startDayOfWeek }).map((_, i) => (
            <div key={`empty-${i}`} className="bg-muted/30 min-h-[100px] p-1" />
          ))}

          {days.map(day => {
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
                <div className={`mb-1.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${today ? "bg-primary text-primary-foreground" : "text-foreground"}`}>
                  {format(day, "d")}
                </div>
                <div className="space-y-1">
                  {dayEntries.slice(0, 3).map(entry => {
                    const grad = PLATFORM_GRADIENTS[entry.platform ?? "instagram"] ?? "from-violet-500 to-indigo-500"
                    const dot = STATUS_DOT[entry.status] ?? "bg-gray-400"
                    return (
                      <div
                        key={entry.id}
                        className="group relative rounded-md overflow-hidden cursor-pointer"
                        onClick={e => { e.stopPropagation(); setSelectedEntry(entry) }}
                        title={entry.title}
                      >
                        {/* Mini gradient card */}
                        <div className={`bg-gradient-to-r ${grad} px-1.5 py-1 flex items-center gap-1`}>
                          <span className={`shrink-0 h-1.5 w-1.5 rounded-full ${dot} ring-1 ring-white/50`} />
                          <span className="truncate text-[10px] font-medium text-white leading-tight flex-1">
                            {entry.title}
                          </span>
                          <span className="shrink-0 text-[9px] text-white/70">{PLATFORM_EMOJIS[entry.platform ?? ""] ?? ""}</span>
                          <button
                            className="shrink-0 hidden group-hover:flex items-center justify-center h-3 w-3 rounded-full bg-black/20 hover:bg-black/40"
                            onClick={e => handleDelete(entry.id, e)}
                            title="Delete"
                          >
                            <X className="h-2 w-2 text-white" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                  {dayEntries.length > 3 && (
                    <p className="text-[10px] text-muted-foreground pl-0.5">+{dayEntries.length - 3} more</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && entries.length === 0 && (
        <div className="mt-6 rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm font-medium text-muted-foreground">
            Your calendar is empty — use Fastlane to generate 30 days of content with full captions, hooks, and hashtags.
          </p>
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
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded border bg-blue-100 border-blue-200 ring-1 ring-inset ring-blue-500/20" />
          <span className="text-xs text-muted-foreground">Content ready</span>
        </div>
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
                <Input
                  placeholder="e.g. Diwali product reel"
                  value={form.title}
                  onChange={e => setForm({ ...form, title: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Date</Label>
                <Input
                  type="date"
                  value={form.scheduled_date}
                  onChange={e => setForm({ ...form, scheduled_date: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Platform</Label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={form.platform}
                    onChange={e => setForm({ ...form, platform: e.target.value })}
                  >
                    {["instagram", "tiktok", "facebook", "youtube", "linkedin", "twitter"].map(p => (
                      <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Content type</Label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={form.content_type}
                    onChange={e => setForm({ ...form, content_type: e.target.value })}
                  >
                    {["reel", "post", "story", "carousel", "thread"].map(t => (
                      <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={form.status}
                  onChange={e => setForm({ ...form, status: e.target.value })}
                >
                  {["planned", "content_ready", "scheduled", "published", "missed"].map(s => (
                    <option key={s} value={s}>{s.replace("_", " ").replace(/\b\w/g, c => c.toUpperCase())}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Notes</Label>
                <textarea
                  rows={2}
                  placeholder="Any notes about this piece of content"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 p-5 border-t">
              <Button variant="outline" onClick={() => setShowNewEntryModal(false)} disabled={isSaving}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={isSaving || !form.title}>
                {isSaving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : "Save entry"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Entry detail panel */}
      <CalendarEntryPanel
        entry={selectedEntry}
        onClose={() => setSelectedEntry(null)}
        onUpdate={handleEntryUpdate}
      />
    </div>
  )
}
