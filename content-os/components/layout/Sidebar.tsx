"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Home, Sparkles, Bookmark, Calendar, Zap, Package,
  Briefcase, Settings, HelpCircle, ChevronDown, X, Plus,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useBrandStore } from "@/stores/brandStore"
import { HelpDrawer } from "@/components/shared/HelpDrawer"
import { LogoIcon } from "@/components/shared/LogoIcon"

interface SidebarProps {
  isOpen?: boolean
  onClose?: () => void
}

function SectionLabel({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return (
    <p className={cn(
      "mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40",
      // A hairline divider reads as real section separation instead of
      // just a label change floating in the same continuous list --
      // skipped on the first section since the brand-selector pill
      // above it already provides that break.
      !first && "mt-4 border-t border-sidebar-border/60 pt-3"
    )}>
      {children}
    </p>
  )
}

/**
 * Icon chip + left accent bar replaces the old small dot indicator --
 * matching the icon-in-a-tinted-rounded-box language already established
 * across Home/Create/Influencers, rather than a separate, quieter style
 * unique to the sidebar. `chipBg`/`chipColor` give each item its own
 * resting accent (same per-item hues the old dotColor prop used); the
 * active item's chip fills solid violet with a white icon and gains the
 * accent bar, so "where am I" reads unambiguously at a glance.
 */
function NavItem({
  href,
  label,
  icon: Icon,
  isActive,
  onClose,
  chipBg = "bg-muted-foreground/10",
  chipColor = "text-muted-foreground",
  faded = false,
  id,
}: {
  href: string
  label: string
  icon: React.ElementType
  isActive: boolean
  onClose?: () => void
  chipBg?: string
  chipColor?: string
  faded?: boolean
  id?: string
}) {
  return (
    <Link
      id={id}
      href={href}
      onClick={onClose}
      className={cn(
        "relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-all duration-150",
        isActive
          ? "bg-violet-500/10 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300 font-semibold"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
        faded && "opacity-40"
      )}
    >
      {isActive && (
        <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-violet-600" />
      )}
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors",
          isActive ? "bg-violet-600 text-white" : `${chipBg} ${chipColor}`
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="truncate">{label}</span>
    </Link>
  )
}

/** Same visual language as NavItem, but for actions that open a panel instead of navigating. */
function NavButton({
  label,
  icon: Icon,
  onClick,
  chipBg = "bg-muted-foreground/10",
  chipColor = "text-muted-foreground",
}: {
  label: string
  icon: React.ElementType
  onClick: () => void
  chipBg?: string
  chipColor?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-sidebar-foreground/70 transition-all duration-150 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
    >
      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", chipBg, chipColor)}>
        <Icon className="h-3.5 w-3.5" />
      </span>
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
          <LogoIcon size={28} />
          <div className="flex flex-col leading-none">
            <span className="text-sm font-semibold text-sidebar-foreground">
              SocioPosts
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
        <div className="mb-1">
          <SectionLabel first>Workspace</SectionLabel>
          <div className="space-y-0.5">
            <NavItem
              href="/dashboard"
              label="Home"
              icon={Home}
              isActive={pathname === "/dashboard"}
              onClose={onClose}
              chipBg="bg-blue-500/10"
              chipColor="text-blue-500"
            />
            <NavItem
              id="tour-create"
              href={brandHref("/generate")}
              label="Create"
              icon={Sparkles}
              isActive={brandActive("/generate")}
              onClose={onClose}
              chipBg="bg-violet-500/10"
              chipColor="text-violet-500"
              faded={!activeBrandId}
            />
            <NavItem
              href={brandHref("/library")}
              label="My Content"
              icon={Bookmark}
              isActive={brandActive("/library")}
              onClose={onClose}
              chipBg="bg-pink-500/10"
              chipColor="text-pink-500"
              faded={!activeBrandId}
            />
            <NavItem
              id="tour-calendar"
              href={brandHref("/calendar")}
              label="Calendar"
              icon={Calendar}
              isActive={brandActive("/calendar")}
              onClose={onClose}
              chipBg="bg-green-500/10"
              chipColor="text-green-500"
              faded={!activeBrandId}
            />
          </div>
        </div>

        {/* GROWTH */}
        <div className="mb-1">
          <SectionLabel>Growth</SectionLabel>
          <div className="space-y-0.5">
            <NavItem
              id="tour-autopilot"
              href={brandHref("/fastlane")}
              label="Autopilot ✈️"
              icon={Zap}
              isActive={brandActive("/fastlane")}
              onClose={onClose}
              chipBg="bg-amber-500/10"
              chipColor="text-amber-500"
              faded={!activeBrandId}
            />
            <NavItem
              href={brandHref("/products")}
              label="Products"
              icon={Package}
              isActive={brandActive("/products")}
              onClose={onClose}
              chipBg="bg-orange-500/10"
              chipColor="text-orange-500"
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
              chipBg="bg-indigo-500/10"
              chipColor="text-indigo-500"
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
          chipBg="bg-sky-500/10"
          chipColor="text-sky-500"
        />
        <NavItem
          href="/settings"
          label="Settings"
          icon={Settings}
          isActive={pathname.startsWith("/settings")}
          onClose={onClose}
          chipBg="bg-slate-500/10"
          chipColor="text-slate-500"
        />
      </div>
    </aside>
    <HelpDrawer open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  )
}
