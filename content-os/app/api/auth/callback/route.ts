import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { sendWelcomeEmail } from "@/lib/email/resend"

export async function GET(request: Request) {
  console.log("[auth/callback] GET called")

  const { searchParams, origin } = new URL(request.url)

  // Supabase rejects some links (expired, already used, etc.) before they
  // ever reach us as a `code` -- it redirects here with `?error=...&
  // error_description=...` instead. Surfacing that real reason (both in
  // logs and in the redirect URL) instead of collapsing straight to the
  // generic message below is the whole point of this route's error
  // handling -- otherwise every failure mode looks identical.
  const oauthError = searchParams.get("error")
  const oauthErrorDescription = searchParams.get("error_description")
  if (oauthError || oauthErrorDescription) {
    console.error("[auth/callback] Supabase redirected with error:", { error: oauthError, error_description: oauthErrorDescription })
    const message = oauthErrorDescription || oauthError || "Could not authenticate. Please try again."
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(message)}`)
  }

  const code = searchParams.get("code")
  let next = searchParams.get("next") ?? "/dashboard"

  // Guard against open-redirect: must be a single-slash relative path, not a
  // protocol-relative ("//evil.com") or absolute ("https://evil.com") URL.
  if (!/^\/(?!\/)/.test(next)) {
    next = "/dashboard"
  }

  // Agency has no trial (see signup/page.tsx) — its signup CTA links here
  // with this `next` target so a brand-new Agency signup is sent straight
  // to checkout below instead of the trial-oriented onboarding flow.
  const isAgencyCheckout = next.startsWith("/settings") && next.includes("startPlan=agency")

  if (code) {
    let supabase
    try {
      supabase = await createClient()
    } catch (err) {
      console.error("[auth/callback] createClient failed:", err)
      return NextResponse.redirect(`${origin}/login?error=Server+error`)
    }

    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (error) {
      console.error("[auth/callback] exchangeCodeForSession failed:", error.message)
      return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`)
    }

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
            if (isAgencyCheckout) {
              // handle_new_user() (migration 039) unconditionally grants a
              // 7-day trial on signup. Agency doesn't get one, so clear it
              // here rather than in the trigger — this is the one signup
              // path that opts out, and null trial_ends_at + no
              // subscription already fails closed as "must pay" (see
              // lib/usage/trial-status.ts), so this alone is enough even if
              // the user abandons the checkout modal below.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const { error: clearTrialError } = await (supabase.from("users") as any)
                .update({ trial_ends_at: null })
                .eq("id", user.id)
              if (clearTrialError) {
                console.error("[auth/callback] failed to clear Agency signup trial:", clearTrialError)
              }
            } else {
              redirectPath = "/onboarding/welcome"
            }
            if (user.email) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const fullName = (user.user_metadata as any)?.full_name as string | undefined
              await sendWelcomeEmail(user.id, user.email, fullName).catch(() => {})
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
