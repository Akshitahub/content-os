"use client"

import { useState, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { LogOut, Menu, Settings, Bell, ChevronDown } from "lucide-react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { BrandSelector } from "@/components/layout/BrandSelector"
import { PLAN_LIMITS } from "@/types/app"
import type { UserPlan } from "@/types/app"

interface HeaderProps {
  userEmail?: string
  userName?: string
  onMenuClick?: () => void
  generationCount?: number
  plan?: string
}

export function Header({ userEmail, userName, onMenuClick, generationCount = 0, plan = "free" }: HeaderProps) {
  const router = useRouter()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const userPlan = (plan as UserPlan) in PLAN_LIMITS ? (plan as UserPlan) : "free"
  const limit = PLAN_LIMITS[userPlan].generations
  const remaining = Math.max(0, limit - generationCount)
  const usagePct = Math.min(100, Math.round((generationCount / limit) * 100))
  const creditColor = remaining === 0 ? "text-red-500" : remaining < 5 ? "text-amber-500" : "text-muted-foreground"
  const barColor = remaining === 0 ? "bg-red-500" : remaining < 5 ? "bg-amber-500" : "bg-primary"

  const displayName = userName ?? userEmail ?? "Account"
  const initials = userName
    ? userName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : (userEmail?.[0] ?? "U").toUpperCase()

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/login")
    router.refresh()
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-4 md:px-6">
      <div className="flex items-center gap-3">
        {/* Hamburger — mobile only */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onMenuClick}
          className="h-8 w-8 text-muted-foreground hover:text-foreground lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <BrandSelector />
      </div>

      <div className="flex items-center gap-2">
        {/* Usage indicator */}
        <div className="hidden sm:flex items-center gap-2">
          <div className="flex flex-col items-end gap-0.5">
            <span className={`text-[10px] font-medium leading-none ${creditColor}`}>
              {remaining} credits remaining
            </span>
            <div className="h-1 w-20 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${barColor}`}
                style={{ width: `${usagePct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Notification bell (placeholder) */}
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
        </button>

        {/* Avatar + dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setDropdownOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-full pl-1 pr-2 py-1 hover:bg-muted transition-colors"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              {initials}
            </div>
            <span className="hidden text-sm text-muted-foreground sm:block max-w-[100px] truncate">
              {displayName}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60" />
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border bg-card shadow-lg z-50 overflow-hidden">
              <div className="px-3 py-2.5 border-b">
                <p className="text-xs font-medium truncate">{displayName}</p>
                {userEmail && displayName !== userEmail && (
                  <p className="text-[10px] text-muted-foreground truncate">{userEmail}</p>
                )}
                <span className="mt-1 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary capitalize">
                  {plan} plan
                </span>
              </div>
              <div className="py-1">
                <Link
                  href="/settings"
                  onClick={() => setDropdownOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <Settings className="h-3.5 w-3.5" />
                  Settings
                </Link>
                <button
                  onClick={() => { setDropdownOpen(false); handleSignOut() }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
