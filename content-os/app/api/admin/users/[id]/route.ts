import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from "@/lib/admin/session"
import { getAdminUserDetail } from "@/lib/admin/get-user-detail"
import { buildError, ErrorCodes } from "@/types/api"

type RouteParams = { params: Promise<{ id: string }> }

/**
 * Admin panel's per-user detail view -- backs
 * app/admin/(panel)/users/[id]/page.tsx (which calls getAdminUserDetail
 * directly server-side rather than fetching this route, since it's
 * already inside a layout that re-verified the admin session; this route
 * exists for anything else that wants the same data over HTTP). Gated on
 * the admin session cookie directly (same check as
 * app/admin/(panel)/layout.tsx) rather than Supabase auth -- admin_users
 * has no relationship to the customer-facing auth system at all (see
 * lib/admin/session.ts's doc comment).
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params

  const cookieStore = await cookies()
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value
  const session = token ? await verifyAdminSession(token) : null
  if (!session) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "Not logged in."), { status: 401 })
  }

  const detail = await getAdminUserDetail(id)
  if (!detail) {
    return NextResponse.json(buildError(ErrorCodes.NOT_FOUND, "User not found."), { status: 404 })
  }

  return NextResponse.json({ data: detail })
}
