import crypto from "crypto"
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { z } from "zod"

const schema = z.object({
  razorpay_order_id: z.string(),
  razorpay_payment_id: z.string(),
  razorpay_signature: z.string(),
  plan: z.enum(["starter", "pro"]),
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

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } = parsed.data

  // Verify HMAC-SHA256 signature — prevents tampering with the payment response
  const body_string = `${razorpay_order_id}|${razorpay_payment_id}`
  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
    .update(body_string)
    .digest("hex")

  if (expectedSignature !== razorpay_signature) {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Payment verification failed."), { status: 400 })
  }

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
