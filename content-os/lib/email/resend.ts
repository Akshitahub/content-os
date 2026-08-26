import { Resend } from "resend"
import { createAdminClient } from "@/lib/supabase/server"
import { generateUnsubscribeToken } from "@/lib/email/unsubscribe-token"

const FROM = "SocioPosts <hello@socioposts.com>"
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

/**
 * Gate for every non-transactional (marketing/lifecycle) email-sending
 * function below — checked first, before any send is attempted. Payment
 * confirmations are exempt (transactional/required, not marketing — see
 * sendPaymentConfirmationEmail, which does not call this).
 *
 * Fails closed: if the opt-out status can't be verified for any reason
 * (DB error, missing row), this returns true (treat as opted out) rather
 * than false — a skipped send is a minor inconvenience, an unwanted send
 * to someone who opted out is the actual compliance problem this exists
 * to prevent.
 */
async function isOptedOutOfMarketingEmails(userId: string): Promise<boolean> {
  try {
    const admin = await createAdminClient()
    const { data, error } = await admin
      .from("users")
      .select("marketing_emails_opted_out")
      .eq("id", userId)
      .single<{ marketing_emails_opted_out: boolean }>()

    if (error || !data) {
      console.error(`[email] could not verify opt-out status for user ${userId}, skipping send to be safe:`, error?.message)
      return true
    }
    return data.marketing_emails_opted_out
  } catch (err) {
    console.error(`[email] could not verify opt-out status for user ${userId}, skipping send to be safe:`, err instanceof Error ? err.message : err)
    return true
  }
}

function unsubscribeUrl(userId: string): string {
  return `${APP_URL}/api/v1/email/unsubscribe?token=${generateUnsubscribeToken(userId)}`
}

export async function sendWelcomeEmail(userId: string, to: string, name?: string): Promise<void> {
  if (!process.env.RESEND_API_KEY) return
  if (await isOptedOutOfMarketingEmails(userId)) return

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
          <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">⚡ SocioPosts</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:40px;">
          <h1 style="margin:0 0 12px;font-size:26px;font-weight:700;color:#0f0f0f;letter-spacing:-0.5px;">You're in. Let's build something.</h1>
          <p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.6;">
            Hi ${firstName}, your SocioPosts account is ready. Import your brand URL and SocioPosts will learn your voice, products, and audience — then generate 30 days of content tailored to you.
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
            You received this because you signed up for SocioPosts.
            <a href="${unsubscribeUrl(userId)}" style="color:#9ca3af;">Unsubscribe</a> at any time.
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
      subject: "Welcome to SocioPosts — let's build your brand 🚀",
      html,
    })
  } catch (err) {
    console.error("[email/welcome] Failed to send welcome email:", err)
  }
}

/**
 * Sends a payment confirmation receipt right after a plan upgrade is
 * applied. Mirrors sendWelcomeEmail's shape exactly (silent no-op without
 * RESEND_API_KEY, logs-and-swallows on send failure, no result the caller
 * needs to check) — this fires from the server-to-server webhook path,
 * where a flaky email provider must never fail the webhook response or
 * block the plan upgrade that already succeeded.
 */
export async function sendPaymentConfirmationEmail(
  to: string,
  details: { planName: string; amountRupees: number; billingPeriod: "monthly" | "annual" }
): Promise<void> {
  if (!process.env.RESEND_API_KEY) return

  const resend = new Resend(process.env.RESEND_API_KEY)
  const dashboardUrl = `${APP_URL}/dashboard`
  const periodLabel = details.billingPeriod === "annual" ? "year" : "month"
  const formattedAmount = `₹${details.amountRupees.toLocaleString("en-IN")}`

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
          <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">⚡ SocioPosts</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:40px;">
          <h1 style="margin:0 0 12px;font-size:26px;font-weight:700;color:#0f0f0f;letter-spacing:-0.5px;">Payment confirmed 🎉</h1>
          <p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.6;">
            Thanks for upgrading! Your ${details.planName} plan is now active.
          </p>
          <!-- Receipt -->
          <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 32px;background:#f9fafb;border-radius:8px;">
            <tr><td style="padding:20px 24px;">
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="padding:4px 0;font-size:14px;color:#6b7280;">Plan</td>
                  <td style="padding:4px 0;font-size:14px;color:#0f0f0f;font-weight:600;text-align:right;">${details.planName}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0;font-size:14px;color:#6b7280;">Billing period</td>
                  <td style="padding:4px 0;font-size:14px;color:#0f0f0f;font-weight:600;text-align:right;text-transform:capitalize;">${details.billingPeriod}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0;font-size:14px;color:#6b7280;">Amount charged</td>
                  <td style="padding:4px 0;font-size:14px;color:#0f0f0f;font-weight:600;text-align:right;">${formattedAmount} / ${periodLabel}</td>
                </tr>
              </table>
            </td></tr>
          </table>
          <!-- CTA -->
          <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
            <tr><td style="background:#7c3aed;border-radius:8px;">
              <a href="${dashboardUrl}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                Go to dashboard →
              </a>
            </td></tr>
          </table>
          <p style="margin:0;font-size:13px;color:#9ca3af;">
            Have questions about your billing? Just reply to this email — we read every one.
          </p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:24px 40px;border-top:1px solid #f3f4f6;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">
            You received this because you upgraded your SocioPosts plan.
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
      subject: `Payment confirmed — ${details.planName} plan is active`,
      html,
    })
  } catch (err) {
    console.error("[email/payment-confirmation] Failed to send payment confirmation email:", err)
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
  replyTo: string,
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
            Sent by ${brandName} via SocioPosts.
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
      ...(replyTo ? { replyTo } : {}),
    })
    return { success: true }
  } catch (err) {
    console.error("[email/outreach] Failed to send outreach email:", err)
    return { success: false, error: err instanceof Error ? err.message : "Failed to send email." }
  }
}
