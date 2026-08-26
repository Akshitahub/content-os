import Razorpay from "razorpay"
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildError, ErrorCodes } from "@/types/api"
import { CREDIT_PACK_IDS, CREDIT_PACKS } from "@/lib/usage/credit-packs"
import { z } from "zod"

const schema = z.object({
  packId: z.enum(CREDIT_PACK_IDS as [string, ...string[]]),
})

/**
 * Counterpart to create-checkout-session/route.ts, for a one-time credit
 * top-up pack instead of a recurring plan. Razorpay's Orders API (the same
 * razorpay.orders.create() call the plan-checkout route already uses) is
 * itself a one-time-payment primitive either way — this app's "monthly
 * plan" was never a Razorpay Subscription to begin with, just a plan order
 * plus this app's own monthly generation_count reset. So there's no
 * separate Razorpay "one-time order" API to switch to here; what actually
 * distinguishes a top-up from a plan purchase is entirely in this app's
 * own order `notes` (purchase_type) and in how /verify-payment and
 * /webhook branch on it — see applyCreditTopup vs applyPlanUpgrade.
 */
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
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid credit pack."), { status: 400 })
  }

  const packId = parsed.data.packId as keyof typeof CREDIT_PACKS
  const pack = CREDIT_PACKS[packId]
  // Razorpay wants paise; CREDIT_PACKS.price is whole rupees.
  const amount = pack.price * 100

  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
  })

  try {
    const order = await razorpay.orders.create({
      amount,
      currency: "INR",
      receipt: `topup_${user.id.slice(0, 8)}_${Date.now()}`,
      notes: {
        user_id: user.id,
        pack_id: packId,
        // Distinguishes this from a plan-purchase order for /verify-payment
        // and /webhook, which otherwise share this exact Razorpay flow.
        purchase_type: "credit_topup",
      },
    })

    return NextResponse.json({
      data: {
        orderId: order.id,
        amount: Number(order.amount),
        currency: order.currency,
        keyId: process.env.RAZORPAY_KEY_ID,
        packName: pack.name,
        credits: pack.credits,
      },
    })
  } catch (err) {
    console.error("[billing/create-topup-checkout-session] Razorpay order creation failed:", err instanceof Error ? err.message : err)
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Couldn't start checkout. Please try again."), { status: 500 })
  }
}
