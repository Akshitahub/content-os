import crypto from "crypto"
import Razorpay from "razorpay"
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { z } from "zod"

const schema = z.object({
  razorpay_order_id: z.string(),
  razorpay_payment_id: z.string(),
  razorpay_signature: z.string(),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid payload."), { status: 400 })
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = parsed.data

  // Verify HMAC-SHA256 signature — prevents tampering with the payment response
  const body_string = `${razorpay_order_id}|${razorpay_payment_id}`
  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
    .update(body_string)
    .digest("hex")

  const expectedBuffer = Buffer.from(expectedSignature, "hex")
  const receivedBuffer = Buffer.from(razorpay_signature, "hex")

  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Payment verification failed."), { status: 400 })
  }

  // Signature only proves this order_id/payment_id pair was paid — it does
  // NOT prove which plan was purchased. Fetch the order server-side and use
  // its notes (set at creation time in create-checkout-session/route.ts) as
  // the source of truth for plan + owning user, never trust client input.
  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
  })

  let order
  try {
    order = await razorpay.orders.fetch(razorpay_order_id)
  } catch (err) {
    console.error("[billing/verify-payment] Razorpay order fetch failed:", err instanceof Error ? err.message : err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't verify this payment. Please try again."), { status: 500 })
  }

  const orderUserId = order.notes?.user_id
  const orderPlan = order.notes?.plan

  if (orderUserId !== user.id) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "This order does not belong to your account."), { status: 400 })
  }
  if (orderPlan !== "starter" && orderPlan !== "pro") {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid plan."), { status: 400 })
  }
  if (order.status !== "paid") {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "This payment hasn't been confirmed as paid yet."), { status: 400 })
  }

  const plan = orderPlan

  // Signature valid — upgrade the user's plan and reset their generation count
  const nextResetDate = new Date()
  nextResetDate.setMonth(nextResetDate.getMonth() + 1)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateError } = await (supabase.from("users") as any)
    .update({
      plan,
      generation_count: 0,
      generation_count_reset_at: nextResetDate.toISOString(),
    })
    .eq("id", user.id)

  if (updateError) {
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Failed to update plan."), { status: 500 })
  }

  return NextResponse.json({ data: { success: true, plan } })
}
