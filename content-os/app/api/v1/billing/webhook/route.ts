import crypto from "crypto"
import Razorpay from "razorpay"
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { applyPlanUpgrade } from "@/lib/billing/apply-plan-upgrade"
import { buildError, ErrorCodes } from "@/types/api"

interface RazorpayWebhookPayload {
  event?: string
  payload?: {
    payment?: {
      entity?: {
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
  if (!orderId) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Missing order_id in payload."), { status: 400 })
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
  const orderPlan = order.notes?.plan

  if (!orderUserId || (orderPlan !== "starter" && orderPlan !== "pro" && orderPlan !== "agency")) {
    console.error("[billing/webhook] order missing expected notes:", orderId)
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Order missing required metadata."), { status: 400 })
  }
  if (order.status !== "paid") {
    // Not actually paid yet by Razorpay's own record — nothing to do.
    return NextResponse.json({ data: { received: true } }, { status: 200 })
  }

  const admin = await createAdminClient()
  const { error } = await applyPlanUpgrade(admin, String(orderUserId), orderPlan)

  if (error) {
    console.error("[billing/webhook] plan upgrade failed:", error)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to apply plan upgrade."), { status: 500 })
  }

  return NextResponse.json({ data: { received: true } }, { status: 200 })
}
