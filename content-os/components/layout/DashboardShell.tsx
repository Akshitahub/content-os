"use client"

import { useState, useCallback } from "react"
import { Sidebar } from "@/components/layout/Sidebar"
import { Header } from "@/components/layout/Header"

interface DashboardShellProps {
  children: React.ReactNode
  userEmail?: string
  userName?: string
}

export function DashboardShell({ children, userEmail, userName }: DashboardShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false)

  const openMenu = useCallback(() => setMobileOpen(true), [])
  const closeMenu = useCallback(() => setMobileOpen(false), [])

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={closeMenu}
          aria-hidden="true"
        />
      )}

      <Sidebar isOpen={mobileOpen} onClose={closeMenu} />

      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <Header userEmail={userEmail} userName={userName} onMenuClick={openMenu} />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
