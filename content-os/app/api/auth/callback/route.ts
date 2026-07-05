import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { sendWelcomeEmail } from "@/lib/email/resend"

export async function GET(request: Request) {
  console.log("[auth/callback] GET called")

  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  let next = searchParams.get("next") ?? "/dashboard"

  // Guard against open-redirect: must be a single-slash relative path, not a
  // protocol-relative ("//evil.com") or absolute ("https://evil.com") URL.
  if (!/^\/(?!\/)/.test(next)) {
    next = "/dashboard"
  }

  if (code) {
    let supabase
    try {
      supabase = await createClient()
    } catch (err) {
      console.error("[auth/callback] createClient failed:", err)
      return NextResponse.redirect(`${origin}/login?error=Server+error`)
    }

    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // Get user to determine if they're new and send welcome email
      let redirectPath = next
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const createdAt = new Date(user.created_at).getTime()
          const updatedAt = new Date(user.updated_at ?? user.created_at).getTime()
          const isNewUser = Math.abs(createdAt - updatedAt) < 10_000

          if (isNewUser) {
            redirectPath = "/onboarding/welcome"
            if (user.email) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const fullName = (user.user_metadata as any)?.full_name as string | undefined
              await sendWelcomeEmail(user.email, fullName).catch(() => {})
            }
          }
        }
      } catch (err) {
        console.error("[auth/callback] post-auth check failed:", err)
      }

      const forwardedHost = request.headers.get("x-forwarded-host")
      const isLocalEnv = process.env.NODE_ENV === "development"

      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${redirectPath}`)
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${redirectPath}`)
      } else {
        return NextResponse.redirect(`${origin}${redirectPath}`)
      }
    }
  }

  return NextResponse.redirect(
    `${origin}/login?error=Could+not+authenticate.+Please+try+again.`
  )
}
