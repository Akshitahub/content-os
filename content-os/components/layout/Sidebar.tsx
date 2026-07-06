"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Home, Sparkles, Bookmark, Calendar, Zap, Users, Package,
  Briefcase, Settings, HelpCircle, ChevronDown, X, Plus,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useBrandStore } from "@/stores/brandStore"
import { HelpDrawer } from "@/components/shared/HelpDrawer"

interface SidebarProps {
  isOpen?: boolean
  onClose?: () => void
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">
      {children}
    </p>
  )
}

function NavItem({
  href,
  label,
  icon: Icon,
  isActive,
  onClose,
  dotColor = "bg-muted-foreground/30",
  faded = false,
  id,
}: {
  href: string
  label: string
  icon: React.ElementType
  isActive: boolean
  onClose?: () => void
  dotColor?: string
  faded?: boolean
  id?: string
}) {
  return (
    <Link
      id={id}
      href={href}
      onClick={onClose}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-all duration-150",
        isActive
          ? "bg-violet-500/10 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300 font-medium"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
        faded && "opacity-40"
      )}
    >
      <div
        className={cn(
          "h-1.5 w-1.5 rounded-full shrink-0 transition-colors",
          isActive ? "bg-violet-500" : dotColor
        )}
      />
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  )
}

/** Same visual language as NavItem, but for actions that open a panel instead of navigating. */
function NavButton({
  label,
  icon: Icon,
  onClick,
  dotColor = "bg-muted-foreground/30",
}: {
  label: string
  icon: React.ElementType
  onClick: () => void
  dotColor?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-sidebar-foreground/70 transition-all duration-150 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
    >
      <div className={cn("h-1.5 w-1.5 rounded-full shrink-0 transition-colors", dotColor)} />
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  )
}

export function Sidebar({ isOpen = false, onClose }: SidebarProps) {
  const pathname = usePathname()
  const { activeBrandId, activeBrand } = useBrandStore()
  const [helpOpen, setHelpOpen] = useState(false)

  const brandHref = (path: string) =>
    activeBrandId ? `/brands/${activeBrandId}${path}` : "/brands"
  const brandActive = (path: string) =>
    !!activeBrandId && pathname.startsWith(`/brands/${activeBrandId}${path}`)

  return (
    <>
    <aside
      className={cn(
        "flex h-full w-[220px] shrink-0 flex-col bg-sidebar-background",
        "fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out",
        "lg:relative lg:translate-x-0 lg:z-auto lg:transition-none",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
            <svg
              className="h-4 w-4 text-primary-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-sm font-semibold text-sidebar-foreground">
              ContentOS
            </span>
            <span className="text-[10px] text-sidebar-foreground/40 mt-0.5">
              for creators
            </span>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-sidebar-foreground/60 hover:text-sidebar-foreground lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-3">
        {/* Brand selector pill */}
        <Link
          id="tour-brand-selector"
          href="/brands"
          onClick={onClose}
          className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-2 mb-3 transition-colors",
            activeBrand
              ? "border-sidebar-border bg-sidebar-accent/40 hover:bg-sidebar-accent/60"
              : "border-dashed border-sidebar-border/60 hover:bg-sidebar-accent/30"
          )}
        >
          {activeBrand ? (
            <>
              <div className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
              <span className="truncate text-xs font-medium text-sidebar-foreground flex-1">
                {activeBrand.name}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-sidebar-foreground/40 shrink-0" />
            </>
          ) : (
            <>
              <Plus className="h-3.5 w-3.5 text-sidebar-foreground/40 shrink-0" />
              <span className="text-xs text-sidebar-foreground/50">
                Select a brand
              </span>
            </>
          )}
        </Link>

        {/* WORKSPACE */}
        <div className="mb-2">
          <SectionLabel>Workspace</SectionLabel>
          <div className="space-y-0.5">
            <NavItem
              href="/dashboard"
              label="Home"
              icon={Home}
              isActive={pathname === "/dashboard"}
              onClose={onClose}
              dotColor="bg-blue-400/60"
            />
            <NavItem
              id="tour-create"
              href={brandHref("/generate")}
              label="Create"
              icon={Sparkles}
              isActive={brandActive("/generate")}
              onClose={onClose}
              dotColor="bg-violet-400/60"
              faded={!activeBrandId}
            />
            <NavItem
              href={brandHref("/library")}
              label="My Content"
              icon={Bookmark}
              isActive={brandActive("/library")}
              onClose={onClose}
              dotColor="bg-pink-400/60"
              faded={!activeBrandId}
            />
            <NavItem
              id="tour-calendar"
              href={brandHref("/calendar")}
              label="Calendar"
              icon={Calendar}
              isActive={brandActive("/calendar")}
              onClose={onClose}
              dotColor="bg-green-400/60"
              faded={!activeBrandId}
            />
          </div>
        </div>

        {/* GROWTH */}
        <div className="mb-2">
          <SectionLabel>Growth</SectionLabel>
          <div className="space-y-0.5">
            <NavItem
              id="tour-autopilot"
              href={brandHref("/fastlane")}
              label="Autopilot ✈️"
              icon={Zap}
              isActive={brandActive("/fastlane")}
              onClose={onClose}
              dotColor="bg-amber-400/60"
              faded={!activeBrandId}
            />
            <NavItem
              href={brandHref("/influencers")}
              label="Creators"
              icon={Users}
              isActive={brandActive("/influencers")}
              onClose={onClose}
              dotColor="bg-teal-400/60"
              faded={!activeBrandId}
            />
            <NavItem
              href={brandHref("/products")}
              label="Products"
              icon={Package}
              isActive={brandActive("/products")}
              onClose={onClose}
              dotColor="bg-orange-400/60"
              faded={!activeBrandId}
            />
          </div>
        </div>

        {/* ACCOUNT */}
        <div>
          <SectionLabel>Account</SectionLabel>
          <div className="space-y-0.5">
            <NavItem
              href="/brands"
              label="My Brands"
              icon={Briefcase}
              isActive={
                pathname === "/brands" || pathname.startsWith("/brands/new")
              }
              onClose={onClose}
              dotColor="bg-indigo-400/60"
            />
          </div>
        </div>
      </nav>

      {/* Bottom — settings */}
      <div className="border-t border-sidebar-border px-3 py-3 space-y-0.5">
        <NavButton
          label="Help"
          icon={HelpCircle}
          onClick={() => setHelpOpen(true)}
          dotColor="bg-sky-400/60"
        />
        <NavItem
          href="/settings"
          label="Settings"
          icon={Settings}
          isActive={pathname.startsWith("/settings")}
          onClose={onClose}
        />
      </div>
    </aside>
    <HelpDrawer open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  )
}
