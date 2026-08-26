import { type NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/middleware"

export async function proxy(request: NextRequest) {
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
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
