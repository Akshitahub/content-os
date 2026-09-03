"use client"

import { usePathname } from "next/navigation"
import { MessageCircle } from "lucide-react"
import { WHATSAPP_LINK } from "@/lib/constants"

// Route groups (like app/(dashboard)) add no URL segment of their own, so
// there's no single shared prefix Next.js exposes for "is this a dashboard
// route" -- this is exactly app/(dashboard)'s three top-level folders
// (brands, dashboard, settings). Logged-in users on these routes already
// have HelpDrawer (components/shared/HelpDrawer.tsx, opened from
// Sidebar.tsx) for support, so this button hides itself there instead of
// doubling up.
const DASHBOARD_ROUTE_PREFIXES = ["/dashboard", "/brands", "/settings"]

function isDashboardRoute(pathname: string): boolean {
  return DASHBOARD_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

/**
 * Fixed-position WhatsApp support button -- rendered from the root layout
 * (app/layout.tsx) so it shows on the landing page and legal/auth/
 * onboarding pages, but hides itself on dashboard routes (see
 * isDashboardRoute above).
 */
export function WhatsappButton() {
  const pathname = usePathname()
  if (isDashboardRoute(pathname)) return null

  return (
    <a
      href={WHATSAPP_LINK}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with us on WhatsApp"
      className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105"
      style={{ backgroundColor: "#25D366" }}
    >
      <MessageCircle className="h-7 w-7 text-white" />
    </a>
  )
}
