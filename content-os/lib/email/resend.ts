import { Resend } from "resend"

const FROM = "ContentOS <hello@contentos.in>"
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

export async function sendWelcomeEmail(to: string, name?: string): Promise<void> {
  if (!process.env.RESEND_API_KEY) return

  const resend = new Resend(process.env.RESEND_API_KEY)

  const firstName = name?.split(" ")[0] ?? "there"
  const brandImportUrl = `${APP_URL}/brands/new`

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr><td style="background:#0f0f0f;padding:32px 40px;">
          <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">⚡ ContentOS</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:40px;">
          <h1 style="margin:0 0 12px;font-size:26px;font-weight:700;color:#0f0f0f;letter-spacing:-0.5px;">You're in. Let's build something.</h1>
          <p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.6;">
            Hi ${firstName}, your ContentOS account is ready. Import your brand URL and ContentOS will learn your voice, products, and audience — then generate 30 days of content tailored to you.
          </p>
          <!-- CTA -->
          <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
            <tr><td style="background:#7c3aed;border-radius:8px;">
              <a href="${brandImportUrl}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                Import your brand →
              </a>
            </td></tr>
          </table>
          <!-- Features -->
          <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:32px;">
            <tr><td style="padding:8px 0;font-size:14px;color:#374151;">✓ &nbsp;Hooks &amp; captions in your exact voice</td></tr>
            <tr><td style="padding:8px 0;font-size:14px;color:#374151;">✓ &nbsp;Reel scripts &amp; carousels</td></tr>
            <tr><td style="padding:8px 0;font-size:14px;color:#374151;">✓ &nbsp;Fastlane: 30-day calendar in one click</td></tr>
          </table>
          <p style="margin:0;font-size:13px;color:#9ca3af;">
            Have questions? Just reply to this email — we read every one.
          </p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:24px 40px;border-top:1px solid #f3f4f6;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">
            You received this because you signed up for ContentOS.
            <a href="${APP_URL}" style="color:#9ca3af;">Unsubscribe</a> at any time.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim()

  try {
    await resend.emails.send({
      from: FROM,
      to,
      subject: "Welcome to ContentOS — let's build your brand 🚀",
      html,
    })
  } catch (err) {
    console.error("[email/welcome] Failed to send welcome email:", err)
  }
}

/**
 * Sends a brand's outreach message directly to an influencer's email.
 * Unlike sendWelcomeEmail, this returns a result the caller must check —
 * the user is actively trying to reach someone, so a silent failure here
 * would look like the email went out when it didn't.
 */
export async function sendOutreachEmail(
  to: string,
  subject: string,
  messageText: string,
  brandName: string,
): Promise<{ success: boolean; error?: string }> {
  if (!process.env.RESEND_API_KEY) {
    return { success: false, error: "Email sending is not configured." }
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const effectiveSubject = subject.trim() || `Partnership opportunity with ${brandName}`
  const bodyHtml = messageText
    .split("\n")
    .map((line) => (line.trim() ? line : "&nbsp;"))
    .join("<br>")

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr><td style="background:#0f0f0f;padding:32px 40px;">
          <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">${brandName}</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:40px;">
          <div style="margin:0;font-size:15px;color:#374151;line-height:1.6;white-space:pre-wrap;">${bodyHtml}</div>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:24px 40px;border-top:1px solid #f3f4f6;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">
            Sent by ${brandName} via ContentOS.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim()

  try {
    await resend.emails.send({
      from: FROM,
      to,
      subject: effectiveSubject,
      html,
    })
    return { success: true }
  } catch (err) {
    console.error("[email/outreach] Failed to send outreach email:", err)
    return { success: false, error: err instanceof Error ? err.message : "Failed to send email." }
  }
}
