"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Briefcase,
  Package,
  Sparkles,
  Calendar,
  Settings,
  ChevronRight,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useBrandStore } from "@/stores/brandStore"

const topNavItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Brands", href: "/brands", icon: Briefcase },
]

function BrandNavItems({ brandId }: { brandId: string }) {
  const pathname = usePathname()

  const brandNav = [
    { label: "Products", href: `/brands/${brandId}/products`, icon: Package },
    { label: "Generate", href: `/brands/${brandId}/generate`, icon: Sparkles },
    { label: "Calendar", href: `/brands/${brandId}/calendar`, icon: Calendar },
  ]

  return (
    <div className="mt-1 space-y-0.5">
      {brandNav.map((item) => {
        const Icon = item.icon
        const isActive = pathname.startsWith(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        )
      })}
    </div>
  )
}

export function Sidebar() {
  const pathname = usePathname()
  const { activeBrandId, activeBrand } = useBrandStore()

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col bg-sidebar-background">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
          <svg
            className="h-4 w-4 text-primary-foreground"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <span className="text-sm font-semibold text-sidebar-foreground">ContentOS</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {/* Top-level nav */}
        <div className="space-y-0.5">
          {topNavItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            )
          })}
        </div>

        {/* Active brand sub-nav */}
        {activeBrandId && activeBrand && (
          <div className="mt-6">
            <div className="mb-1 flex items-center gap-2 px-3">
              <ChevronRight className="h-3 w-3 text-sidebar-foreground/40" />
              <span className="truncate text-xs font-medium uppercase tracking-wider text-sidebar-foreground/50">
                {activeBrand.name}
              </span>
            </div>
            <BrandNavItems brandId={activeBrandId} />
          </div>
        )}
      </nav>

      {/* Bottom — settings */}
      <div className="border-t border-sidebar-border px-3 py-4">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
            pathname.startsWith("/settings")
              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
          )}
        >
          <Settings className="h-4 w-4 shrink-0" />
          Settings
        </Link>
      </div>
    </aside>
  )
}
