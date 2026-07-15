import Razorpay from "razorpay"
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { z } from "zod"

const schema = z.object({
  plan: z.enum(["starter", "pro", "agency"]),
})

// Prices in paise — match values displayed in the UI
const PLAN_PRICES: Record<string, number> = {
  starter: 99900,   // ₹999
  pro: 249900,      // ₹2,499
  agency: 699900,   // ₹6,999
}

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
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid plan."), { status: 400 })
  }

  const { plan } = parsed.data
  const amount = PLAN_PRICES[plan]

  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
  })

  try {
    const order = await razorpay.orders.create({
      amount,
      currency: "INR",
      receipt: `order_${user.id.slice(0, 8)}_${Date.now()}`,
      notes: {
        user_id: user.id,
        plan,
      },
    })

    return NextResponse.json({
      data: {
        orderId: order.id,
        amount: Number(order.amount),
        currency: order.currency,
        keyId: process.env.RAZORPAY_KEY_ID,
      },
    })
  } catch (err) {
    // Full raw error (e.g. Razorpay's error body) stays server-side only —
    // never shown to the user.
    console.error("[billing/create-checkout-session] Razorpay order creation failed:", err instanceof Error ? err.message : err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't start checkout. Please try again."), { status: 500 })
  }
}
