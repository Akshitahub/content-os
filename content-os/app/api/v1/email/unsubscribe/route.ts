import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe-token"

/**
 * Standard one-click unsubscribe UX: no login required (the whole point —
 * someone who no longer wants these emails shouldn't have to sign back in
 * to say so), a signed token in the URL stands in for auth instead (see
 * lib/email/unsubscribe-token.ts). Returns a plain HTML confirmation page,
 * not JSON — this is a link a human clicks from their email client, not
 * an API call a frontend makes.
 */
function htmlPage(heading: string, body: string): NextResponse {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SocioPosts</title></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 20px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <tr><td style="background:#0f0f0f;padding:32px 40px;">
          <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">⚡ SocioPosts</p>
        </td></tr>
        <tr><td style="padding:40px;text-align:center;">
          <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#0f0f0f;">${heading}</h1>
          <p style="margin:0;font-size:15px;color:#6b7280;line-height:1.6;">${body}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim()

  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get("token")

  if (!token) {
    return htmlPage("Invalid unsubscribe link", "This link is missing its token. If you followed a link from an email, please contact support.")
  }

  const userId = verifyUnsubscribeToken(token)
  if (!userId) {
    return htmlPage("Invalid unsubscribe link", "This link is invalid or has been tampered with. If you followed a link from an email, please contact support.")
  }

  try {
    const admin = await createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin.from("users") as any)
      .update({ marketing_emails_opted_out: true })
      .eq("id", userId)

    if (error) {
      console.error("[email/unsubscribe] update failed:", error.message)
      return htmlPage("Something went wrong", "We couldn't process your unsubscribe request. Please try again or contact support.")
    }
  } catch (err) {
    console.error("[email/unsubscribe] unexpected error:", err instanceof Error ? err.message : err)
    return htmlPage("Something went wrong", "We couldn't process your unsubscribe request. Please try again or contact support.")
  }

  return htmlPage("You've been unsubscribed", "You won't receive any more marketing emails from SocioPosts. Transactional emails (like payment receipts) are unaffected.")
}
