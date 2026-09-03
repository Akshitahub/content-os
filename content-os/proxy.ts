import { type NextRequest, NextResponse } from "next/server"
import { updateSession } from "@/lib/supabase/middleware"
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from "@/lib/admin/session"

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Admin panel session check — fully independent of the Supabase
  // user/isDashboardRoute logic in updateSession below (lib/supabase/
  // middleware.ts). admin_users is a separate credential store with no
  // relationship to Supabase auth at all (see lib/admin/session.ts's own
  // doc comment), so this reads/verifies its own cookie rather than
  // touching anything updateSession already computed.
  if (pathname.startsWith("/admin")) {
    const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value
    const session = token ? await verifyAdminSession(token) : null

    if (pathname !== "/admin/login" && !session) {
      return NextResponse.redirect(new URL("/admin/login", request.url))
    }
    if (pathname === "/admin/login" && session) {
      return NextResponse.redirect(new URL("/admin", request.url))
    }
  }

  return await updateSession(request)
}

export const config = {
  // /api/** is deliberately excluded: every route handler under app/api
  // already creates its own Supabase server client and calls
  // supabase.auth.getUser() itself (the correct place to authorize an API
  // request — a redirect-based check here wouldn't even apply, since
  // isDashboardRoute/isAuthRoute in updateSession only match page paths
  // like /dashboard and /brands, never /api/*). Running this proxy's own
  // getUser() again on top of that was pure duplication, and on a page
  // load that fires several parallel API calls at once, each of those
  // extra proxy-layer refresh attempts raced the API route's own refresh
  // (and each other) over the same one-time-use refresh token cookie —
  // Supabase rotates refresh tokens, so only the first of any concurrent
  // batch succeeds; every other one fails with "Invalid Refresh Token:
  // Already Used" and (per @supabase/auth-js's GoTrueClient) reacts by
  // clearing the session cookie outright. Whichever response's Set-Cookie
  // reaches the browser last wins, so a losing request completing after
  // the real refresh's success looks exactly like a random logout — far
  // likelier on mobile, where reopening a fully-closed/killed browser
  // reloads the page from scratch and fires its first burst of parallel
  // API calls all at once, right when the access token (1hr lifetime) is
  // most likely to already be past its refresh margin. Excluding /api
  // here doesn't remove any real protection (see above) and roughly
  // halves how many independent clients can race per page load.
  // Verified this already covers /admin and /admin/login (the two paths
  // the admin session check above cares about): neither starts with
  // "api/", "_next/static", or "_next/image", isn't "favicon.ico", and
  // doesn't end in an excluded image extension, so the negative lookahead
  // matches them same as any other page route — no separate matcher entry
  // needed for /admin/*.
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
