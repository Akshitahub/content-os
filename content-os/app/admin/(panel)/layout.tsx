import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from "@/lib/admin/session"
import { AdminLogoutButton } from "@/components/admin/AdminLogoutButton"

/**
 * Server-side re-verification of the admin session — defense in depth on
 * top of proxy.ts's own check, same reasoning as app/(dashboard)/layout.tsx's
 * supabase.auth.getUser() call re-checking what middleware already gated
 * (a middleware-only check can be bypassed by anything that skips the
 * proxy layer, e.g. a server action or a route handler called directly).
 * /admin/login itself lives outside this (panel) route group specifically
 * so it never goes through this check.
 */
export default async function AdminPanelLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const cookieStore = await cookies()
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value
  const session = token ? await verifyAdminSession(token) : null
  if (!session) {
    redirect("/admin/login")
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="flex h-14 items-center justify-between border-b bg-background px-6">
        <div className="flex items-center gap-6">
          <span className="text-sm font-semibold tracking-tight">SocioPosts Admin</span>
          <nav className="flex items-center gap-4">
            <Link href="/admin" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              Overview
            </Link>
            <Link href="/admin/users" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              Users
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{session.email}</span>
          <AdminLogoutButton />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  )
}
