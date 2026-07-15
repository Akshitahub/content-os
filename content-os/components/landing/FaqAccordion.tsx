"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"

const FAQS = [
  {
    q: "Do I need any design skills?",
    a: "No. SocioPosts creates everything automatically — hooks, captions, carousels, ad copy. You just paste your brand URL and hit generate.",
  },
  {
    q: "Will the content sound like my brand?",
    a: "Yes. We analyse your website, product pages, and copy to extract your tone of voice, target audience, and brand personality. Every piece of content is generated using this profile.",
  },
  {
    q: "What platforms does it support?",
    a: "Instagram, LinkedIn, Twitter/X, TikTok, Facebook, and YouTube. You can specify the platform for each generation to get tone and format that matches.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Cancel anytime from your settings page with no questions asked. Your generated content stays with you.",
  },
  {
    q: "Is my data safe?",
    a: "Yes. We use Supabase with row-level security — your brand data and content are only accessible to your account. We never use your data to train AI models.",
  },
  {
    q: "How many credits does one generation use?",
    a: "Each AI generation (hook, caption, carousel, etc.) uses one credit. Batch operations like Autopilot (30-day calendar) use multiple credits. Your monthly count is shown in Settings.",
  },
]

export function FaqAccordion() {
  const [open, setOpen] = useState<number | null>(null)

  return (
    <div className="divide-y divide-gray-100 rounded-2xl border border-gray-100 overflow-hidden">
      {FAQS.map((faq, i) => (
        <div key={i}>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left hover:bg-gray-50 transition-colors"
            onClick={() => setOpen(open === i ? null : i)}
          >
            <span className="text-sm font-semibold text-gray-900">{faq.q}</span>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 ${open === i ? "rotate-180" : ""}`}
            />
          </button>
          {open === i && (
            <div className="px-6 pb-5">
              <p className="text-sm leading-relaxed text-gray-500">{faq.a}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
