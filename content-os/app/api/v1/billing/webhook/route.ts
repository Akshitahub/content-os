import { NextResponse } from "next/server"
import { stripe } from "@/lib/stripe/client"
import { createClient } from "@/lib/supabase/server"
import type Stripe from "stripe"

export async function POST(request: Request) {
  const rawBody = await request.text()
  const sig = request.headers.get("stripe-signature") ?? ""
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? ""

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret)
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Webhook signature verification failed"
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  let supabase
  try {
    supabase = await createClient()
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session
      const userId = session.metadata?.supabase_user_id
      const plan = session.metadata?.plan

      if (userId && plan && (plan === "starter" || plan === "pro")) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from("users") as any)
          .update({
            plan,
            stripe_customer_id: session.customer as string,
            stripe_subscription_id: session.subscription as string,
          })
          .eq("id", userId)
      }
      break
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id
      const status = sub.status

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rawRow1 } = await (supabase.from("users") as any)
        .select("id")
        .eq("stripe_customer_id", customerId)
        .single()
      const userRow = rawRow1 as { id: string } | null

      if (userRow?.id) {
        const isActive = status === "active" || status === "trialing"
        if (!isActive) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase.from("users") as any)
            .update({ plan: "free" })
            .eq("id", userRow.id)
        }
      }
      break
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rawRow2 } = await (supabase.from("users") as any)
        .select("id")
        .eq("stripe_customer_id", customerId)
        .single()
      const userRow = rawRow2 as { id: string } | null

      if (userRow?.id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from("users") as any)
          .update({ plan: "free", stripe_subscription_id: null })
          .eq("id", userRow.id)
      }
      break
    }

    default:
      break
  }

  return NextResponse.json({ received: true }, { status: 200 })
}
