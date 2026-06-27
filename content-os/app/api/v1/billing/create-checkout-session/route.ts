import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { stripe } from "@/lib/stripe/client"
import { buildError, ErrorCodes } from "@/types/api"

const PRICE_IDS: Record<"starter" | "pro", string> = {
  starter: process.env.STRIPE_STARTER_PRICE_ID ?? "",
  pro: process.env.STRIPE_PRO_PRICE_ID ?? "",
}

export async function POST(request: Request) {
  let supabase
  try {
    supabase = await createClient()
  } catch {
    return NextResponse.json(buildError(ErrorCodes.INTERNAL_ERROR, "Server error."), { status: 500 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(buildError(ErrorCodes.UNAUTHENTICATED, "You must be logged in."), { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "Invalid JSON."), { status: 400 })
  }

  const plan = (body as { plan?: string })?.plan
  if (plan !== "starter" && plan !== "pro") {
    return NextResponse.json(buildError(ErrorCodes.VALIDATION_ERROR, "plan must be 'starter' or 'pro'."), { status: 400 })
  }

  const priceId = PRICE_IDS[plan]
  if (!priceId) {
    return NextResponse.json(
      buildError(ErrorCodes.INTERNAL_ERROR, `Stripe price ID for '${plan}' is not configured.`),
      { status: 500 }
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawProfile } = await (supabase.from("users") as any)
    .select("stripe_customer_id, email")
    .eq("id", user.id)
    .single()
  const profile = rawProfile as { stripe_customer_id: string | null; email: string } | null

  let customerId = profile?.stripe_customer_id ?? null

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: profile?.email ?? user.email ?? undefined,
      metadata: { supabase_user_id: user.id },
    })
    customerId = customer.id

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("users") as any)
      .update({ stripe_customer_id: customerId })
      .eq("id", user.id)
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${baseUrl}/dashboard?upgraded=true`,
    cancel_url: `${baseUrl}/settings`,
    metadata: { supabase_user_id: user.id, plan },
  })

  return NextResponse.json({ data: { url: session.url } }, { status: 200 })
}
