import Stripe from "stripe"

export const stripe = new Stripe(
  process.env.STRIPE_SECRET_KEY ?? "sk_test_placeholder_configure_in_env",
  { apiVersion: "2026-06-24.dahlia" }
)
