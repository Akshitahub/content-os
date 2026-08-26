import crypto from "crypto"
import Razorpay from "razorpay"
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { applyPlanUpgrade } from "@/lib/billing/apply-plan-upgrade"
import { applyCreditTopup } from "@/lib/billing/apply-credit-topup"
import { CREDIT_PACKS, type CreditPackId } from "@/lib/usage/credit-packs"
import { sendPaymentConfirmationEmail } from "@/lib/email/resend"
import { buildError, ErrorCodes } from "@/types/api"

interface RazorpayWebhookPayload {
  event?: string
  payload?: {
    payment?: {
      entity?: {
        id?: string
        order_id?: string
        status?: string
      }
    }
  }
}

/**
 * Server-to-server payment confirmation, independent of the client-triggered
 * /verify-payment flow. That flow depends on the user's browser successfully
 * running the Razorpay checkout `handler` callback after a successful
 * charge -- if the tab closes, the network drops, or the browser crashes in
 * that window, Razorpay has the money and the plan never upgrades, with no
 * reconciliation. This webhook (configured in the Razorpay Dashboard against
 * this URL, for the payment.captured event) is the source-of-truth backstop
 * for that gap.
 *
 * Naturally idempotent: Razorpay retries webhooks on failure, and this can
 * also fire for an order the client already confirmed via /verify-payment —
 * re-applying the same plan/reset values has no additional effect either way.
 */
export async function POST(request: Request) {
  console.log("[billing/webhook] POST called")

  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error("[billing/webhook] RAZORPAY_WEBHOOK_SECRET is not configured")
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Webhook is not configured."), { status: 500 })
  }

  // Signature is computed over the RAW request body — must read as text
  // before any JSON parsing, or the signature will never match.
  const rawBody = await request.text()
  const signature = request.headers.get("x-razorpay-signature")

  if (!signature) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Missing signature."), { status: 400 })
  }

  const expectedSignature = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex")
  const expectedBuffer = Buffer.from(expectedSignature, "hex")
  const receivedBuffer = Buffer.from(signature, "hex")

  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    console.error("[billing/webhook] signature mismatch")
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid signature."), { status: 400 })
  }

  let event: RazorpayWebhookPayload
  try {
    event = JSON.parse(rawBody) as RazorpayWebhookPayload
  } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  if (event.event !== "payment.captured") {
    // Acknowledge everything else so Razorpay doesn't keep retrying —
    // we only act on captures.
    return NextResponse.json({ data: { received: true } }, { status: 200 })
  }

  const orderId = event.payload?.payment?.entity?.order_id
  const paymentId = event.payload?.payment?.entity?.id
  if (!orderId || !paymentId) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Missing order_id/payment id in payload."), { status: 400 })
  }

  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
  })

  let order
  try {
    order = await razorpay.orders.fetch(orderId)
  } catch (err) {
    console.error("[billing/webhook] order fetch failed:", err instanceof Error ? err.message : err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't verify this order."), { status: 500 })
  }

  const orderUserId = order.notes?.user_id
  if (!orderUserId) {
    console.error("[billing/webhook] order missing user_id note:", orderId)
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Order missing required metadata."), { status: 400 })
  }
  if (order.status !== "paid") {
    // Not actually paid yet by Razorpay's own record — nothing to do.
    return NextResponse.json({ data: { received: true } }, { status: 200 })
  }

  const admin = await createAdminClient()

  // Two order shapes share this one webhook — same purchase_type branch as
  // /verify-payment. See create-topup-checkout-session/route.ts.
  if (order.notes?.purchase_type === "credit_topup") {
    const packId = order.notes?.pack_id
    if (!packId || !(packId in CREDIT_PACKS)) {
      console.error("[billing/webhook] top-up order missing/invalid pack_id:", orderId)
      return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Order missing required metadata."), { status: 400 })
    }

    const { error: topupError } = await applyCreditTopup(
      admin,
      String(orderUserId),
      packId as CreditPackId,
      paymentId,
      Number(order.amount) / 100
    )

    if (topupError) {
      console.error("[billing/webhook] credit top-up failed:", topupError)
      return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to credit top-up."), { status: 500 })
    }

    return NextResponse.json({ data: { received: true } }, { status: 200 })
  }

  const orderPlan = order.notes?.plan
  // Absent on any order created before this field existed — defaults to
  // "monthly" rather than rejecting the order, same fallback the checkout
  // session route itself uses when the client omits billingPeriod.
  const billingPeriod = order.notes?.billing_period === "annual" ? "annual" : "monthly"

  if (orderPlan !== "starter" && orderPlan !== "pro" && orderPlan !== "agency") {
    console.error("[billing/webhook] order missing expected notes:", orderId)
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Order missing required metadata."), { status: 400 })
  }

  const { error } = await applyPlanUpgrade(admin, String(orderUserId), orderPlan, billingPeriod)

  if (error) {
    console.error("[billing/webhook] plan upgrade failed:", error)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to apply plan upgrade."), { status: 500 })
  }

  // Best-effort receipt — never lets an email-provider hiccup fail this
  // response or undo the plan upgrade that already succeeded above. This
  // (not /verify-payment, which depends on the user's browser still being
  // there) is the reliable place for it, same reasoning as this route's
  // own doc comment above.
  try {
    const { data: authUser } = await admin.auth.admin.getUserById(String(orderUserId))
    if (authUser?.user?.email) {
      const planName = orderPlan.charAt(0).toUpperCase() + orderPlan.slice(1)
      await sendPaymentConfirmationEmail(authUser.user.email, {
        planName,
        amountRupees: Number(order.amount) / 100,
        billingPeriod,
      })
    }
  } catch (err) {
    console.error("[billing/webhook] payment confirmation email failed (non-fatal):", err)
  }

  return NextResponse.json({ data: { received: true } }, { status: 200 })
}
