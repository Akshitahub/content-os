import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from "@/lib/admin/session"
import { getAdminUserList } from "@/lib/admin/list-users"
import { buildError, ErrorCodes } from "@/types/api"
import type { UserPlan } from "@/types/app"

const VALID_PLANS: UserPlan[] = ["starter", "pro", "agency"]

/**
 * Admin panel's user-list view -- backs app/admin/(panel)/users/page.tsx
 * (which calls getAdminUserList directly server-side, same reasoning as
 * app/api/admin/users/[id]/route.ts's own doc comment: it's already inside
 * a layout that re-verified the admin session, so an internal fetch to
 * this route would just repeat that check for no benefit; this route
 * exists for anything else that wants the same data over HTTP). Gated on
 * the admin session cookie directly, same check as
 * app/admin/(panel)/layout.tsx and the [id] route.
 */
export async function GET(request: Request) {
  const cookieStore = await cookies()
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value
  const session = token ? await verifyAdminSession(token) : null
  if (!session) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "Not logged in."), { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const search = searchParams.get("search") ?? undefined
  const planParam = searchParams.get("plan")
  const plan = planParam && VALID_PLANS.includes(planParam as UserPlan) ? (planParam as UserPlan) : undefined
  const pageParam = Number(searchParams.get("page"))
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1

  const result = await getAdminUserList({ search, plan, page })

  return NextResponse.json({ data: result })
}
