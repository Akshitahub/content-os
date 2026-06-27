import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { stripe } from "@/lib/stripe/client"
import { buildError, ErrorCodes } from "@/types/api"

export async function POST() {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawProfile } = await (supabase.from("users") as any)
    .select("stripe_customer_id")
    .eq("id", user.id)
    .single()
  const profile = rawProfile as { stripe_customer_id: string | null } | null

  const customerId = profile?.stripe_customer_id
  if (!customerId) {
    return NextResponse.json(
      buildError(ErrorCodes.VALIDATION_ERROR, "No billing account found. Please subscribe first."),
      { status: 400 }
    )
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${baseUrl}/settings`,
  })

  return NextResponse.json({ data: { url: portalSession.url } }, { status: 200 })
}
