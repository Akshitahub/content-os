import { NextResponse } from "next/server"
import { ADMIN_SESSION_COOKIE } from "@/lib/admin/session"

/** Clears the admin session cookie. Re-sets it with maxAge: 0 at the same
 * path the login route scoped it to (path=/) rather than a bare
 * .cookies.delete(name) -- a cookie is matched by name+path together, so
 * clearing it has to use the exact same path it was set with. */
export async function POST() {
  const response = NextResponse.json({ success: true })
  response.cookies.set(ADMIN_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  })
  return response
}
