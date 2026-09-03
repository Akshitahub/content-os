"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { LogOut, Loader2 } from "lucide-react"

/** Posts to /api/admin/auth/logout (clears the ADMIN_SESSION_COOKIE
 * cookie) then sends the browser to /admin/login -- always redirects even
 * if the request itself fails, since the goal is "get the user off any
 * admin page" either way. */
export function AdminLogoutButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleLogout() {
    setLoading(true)
    try {
      await fetch("/api/admin/auth/logout", { method: "POST" })
    } finally {
      router.push("/admin/login")
      router.refresh()
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-60"
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
      Sign out
    </button>
  )
}
