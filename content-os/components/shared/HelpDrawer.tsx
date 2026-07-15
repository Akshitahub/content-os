"use client"

import { useState } from "react"
import Link from "next/link"
import { X, Search, ChevronDown, Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface FaqEntry {
  q: string
  a: string
  link?: { href: string; label: string }
}

interface FaqCategory {
  title: string
  items: FaqEntry[]
}

const FAQ_CATEGORIES: FaqCategory[] = [
  {
    title: "Getting Started",
    items: [
      {
        q: "How do I set up my first brand?",
        a: "During onboarding, enter your website URL and SocioPosts analyzes it to pre-fill your brand profile — audience, tone, products, and more. You can edit anything afterward from your brand's settings.",
      },
      {
        q: "What is Autopilot / Fastlane?",
        a: "Autopilot generates a full 30 days of content in one click — hooks, captions, and visuals — based on your brand profile. You still review everything before it goes out.",
      },
      {
        q: "How do I connect my social accounts?",
        a: "Open your brand page and go to the Connections tab. Instagram, Facebook, Threads, and Pinterest connect directly; LinkedIn and YouTube route through a partner integration and are available on Pro and Agency plans.",
      },
    ],
  },
  {
    title: "Content & Generation",
    items: [
      {
        q: "Why did my generation fail or come back empty?",
        a: "Most failures are either a generation-credit limit for your plan, or a temporary rate limit from the AI provider. Wait a moment and try again — if it keeps failing, check your remaining credits in Settings.",
      },
      {
        q: "What's the difference between a Reel, Story, and Carousel?",
        a: "A Reel is a scripted short video with AI voiceover. A Story is 3–5 connected full-screen slides. A Carousel is a multi-slide post with its own AI-written copy per slide.",
      },
      {
        q: "How does the Meme Maker work?",
        a: "You pick a topic or template, and SocioPosts generates an AI image with a real, on-image meme caption baked in — not just a caption placed under a stock photo.",
      },
    ],
  },
  {
    title: "Publishing & Scheduling",
    items: [
      {
        q: "Why can't I connect LinkedIn or YouTube?",
        a: "These two route through a third-party publishing partner that bills per connected account, so they're available on Pro and Agency plans only. Instagram, Facebook, Threads, and Pinterest stay free to connect on every plan.",
      },
      {
        q: "How does scheduling work?",
        a: "Pick a date, time, and platform when you schedule a post — SocioPosts publishes it automatically at that time. Check upcoming and published posts from your Calendar.",
      },
      {
        q: "My post didn't publish — what happened?",
        a: "First check your connection status in the brand's Connections tab — a token may have expired. Some platforms also have quirks, like brief processing delays for video; a failed post is retried automatically a few times before being marked missed.",
      },
    ],
  },
  {
    title: "Analytics & Reports",
    items: [
      {
        q: "Why does my Analytics Dashboard say \"not enough data\"?",
        a: "Instagram's own Insights API requires 100+ followers and a few days of history before it returns real numbers — we show that honestly instead of a fake zero. It fills in automatically once your account qualifies.",
      },
      {
        q: "How is ROI / time saved calculated?",
        a: "It's an estimate based on assumed industry-standard benchmarks for how long each content type typically takes to write by hand — not measured from your actual workflow, so actual time saved will vary.",
      },
      {
        q: "What's in the monthly PDF report?",
        a: "Reach, follower change, engagement, your best-performing posts, audience demographics (if available), AI insights, and your estimated time-saved breakdown for the month.",
      },
    ],
  },
  {
    title: "Billing & Plans",
    items: [
      {
        q: "What's included in each plan?",
        a: "Generations, brands, products, and platform access all scale with plan — see the full breakdown on the pricing page.",
        link: { href: "/#pricing", label: "View pricing →" },
      },
      {
        q: "How do I upgrade my plan?",
        a: "Go to Settings → Billing to see your current plan and upgrade options.",
        link: { href: "/settings?tab=billing", label: "Go to billing →" },
      },
    ],
  },
]

// TODO: confirm a dedicated support inbox if support@contentos.in (used
// today on the Terms/Privacy pages) shouldn't be the one surfaced here.
const SUPPORT_EMAIL = "support@contentos.in"

function FaqItem({ entry }: { entry: FaqEntry }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium"
      >
        <span>{entry.q}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && (
        <div className="px-3 pb-2.5 space-y-1.5">
          <p className="text-xs leading-relaxed text-muted-foreground">{entry.a}</p>
          {entry.link && (
            <Link href={entry.link.href} className="inline-block text-xs font-medium text-primary underline underline-offset-2">
              {entry.link.label}
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

interface HelpDrawerProps {
  open: boolean
  onClose: () => void
}

export function HelpDrawer({ open, onClose }: HelpDrawerProps) {
  const [query, setQuery] = useState("")

  const normalizedQuery = query.trim().toLowerCase()
  const filteredCategories = normalizedQuery
    ? FAQ_CATEGORIES.map((category) => ({
        ...category,
        items: category.items.filter(
          (item) => item.q.toLowerCase().includes(normalizedQuery) || item.a.toLowerCase().includes(normalizedQuery)
        ),
      })).filter((category) => category.items.length > 0)
    : FAQ_CATEGORIES

  return (
    <>
      {/* Backdrop — mobile only, matches CalendarEntryPanel's convention */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Slide-out panel */}
      <div
        className={cn(
          "fixed right-0 top-0 z-50 h-full w-full max-w-[420px] overflow-hidden border-l bg-card shadow-2xl transition-transform duration-300 ease-in-out",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        {open && (
          <div className="flex h-full flex-col">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b p-5 shrink-0">
              <h3 className="text-lg font-semibold">Help &amp; FAQ</h3>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Search */}
            <div className="border-b p-4 shrink-0">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search FAQs…"
                  className="pl-8"
                />
              </div>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {filteredCategories.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No matching questions. Try a different search, or contact us below.
                </p>
              ) : (
                filteredCategories.map((category) => (
                  <div key={category.title} className="space-y-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{category.title}</p>
                    <div className="space-y-1">
                      {category.items.map((item) => (
                        <FaqItem key={item.q} entry={item} />
                      ))}
                    </div>
                  </div>
                ))
              )}

              <div className="rounded-md border bg-muted/30 p-3 text-center">
                <p className="text-xs text-muted-foreground">Still stuck?</p>
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline underline-offset-2"
                >
                  <Mail className="h-3.5 w-3.5" /> Contact us
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
