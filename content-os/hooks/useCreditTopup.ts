"use client"

import { useState, useEffect, useCallback } from "react"
import { CREDIT_PACKS, type CreditPackId } from "@/lib/usage/credit-packs"

// Shared response shape Razorpay's checkout modal hands back to the
// `handler` callback on a successful payment -- single source of truth for
// any caller (this hook's own handleBuyTopup, and
// SettingsContent.tsx's separate plan-upgrade handleUpgrade) that needs to
// forward it to /api/v1/billing/verify-payment.
export interface RazorpayResponse {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

/**
 * The credit top-up purchase flow -- extracted from
 * components/settings/SettingsContent.tsx so it's the single source of
 * truth for the Razorpay integration, reusable by any UI that wants to
 * sell a one-time credit pack (Settings' own "Buy more credits" card, and
 * a dashboard-level entry point) without duplicating the checkout-session
 * fetch, Razorpay modal wiring, and verify-payment call. Behavior is
 * unchanged from the inline version this replaces -- only moved.
 */
export function useCreditTopup() {
  // Separate state from any plan-upgrade flow a caller might also have,
  // since a pack purchase can happen alongside (not instead of) a plan
  // change, and needs its own inline-confirm step per pack (not a native
  // confirm(), same pattern SocialConnections.tsx's disconnect flow uses).
  const [topupConfirming, setTopupConfirming] = useState<CreditPackId | null>(null)
  const [topupState, setTopupState] = useState<"idle" | "loading">("idle")
  const [topupError, setTopupError] = useState<string | null>(null)
  const [topupSuccess, setTopupSuccess] = useState<{ credits: number } | null>(null)

  // Load the Razorpay checkout script once on mount
  const [razorpayReady, setRazorpayReady] = useState(false)
  useEffect(() => {
    const script = document.createElement("script")
    script.src = "https://checkout.razorpay.com/v1/checkout.js"
    script.async = true
    script.onload = () => setRazorpayReady(true)
    document.body.appendChild(script)
    return () => {
      document.body.removeChild(script)
    }
  }, [])

  const handleBuyTopup = useCallback(async (packId: CreditPackId) => {
    const pack = CREDIT_PACKS[packId]
    setTopupState("loading")
    setTopupError(null)
    setTopupSuccess(null)
    try {
      const res = await fetch("/api/v1/billing/create-topup-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId }),
      })
      const json = await res.json() as {
        data?: { orderId: string; amount: number; currency: string; keyId: string }
        error?: { message: string }
      }
      if (!res.ok || !json.data) {
        setTopupError(json.error?.message ?? "Failed to start checkout.")
        setTopupState("idle")
        return
      }

      const { orderId, amount, currency, keyId } = json.data
      setTopupState("idle")
      setTopupConfirming(null)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rzp = new (window as any).Razorpay({
        key: keyId,
        amount,
        currency,
        name: "SocioPosts",
        description: `${pack.name} (${pack.credits} credits)`,
        order_id: orderId,
        handler: async function (response: RazorpayResponse) {
          try {
            const verifyRes = await fetch("/api/v1/billing/verify-payment", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }),
            })
            if (verifyRes.ok) {
              setTopupSuccess({ credits: pack.credits })
              setTimeout(() => window.location.reload(), 2000)
            } else {
              const errJson = await verifyRes.json() as { error?: { message: string } }
              setTopupError(errJson.error?.message ?? "Payment verification failed. Please contact support.")
            }
          } catch {
            setTopupError("Could not verify payment. Please contact support.")
          }
        },
        modal: {
          ondismiss: () => {
            setTopupError("Payment cancelled.")
          },
        },
        theme: { color: "#7c3aed" },
      })

      rzp.on("payment.failed", function (response: { error?: { description?: string } }) {
        setTopupError(response.error?.description ?? "Payment failed. Please try again.")
      })

      rzp.open()
    } catch {
      setTopupError("Network error. Please try again.")
      setTopupState("idle")
    }
  }, [])

  return {
    topupConfirming,
    setTopupConfirming,
    topupState,
    topupError,
    // Exposed alongside topupError (beyond the plain read value) so a
    // caller's UI can clear a stale error the moment it re-opens the
    // inline confirm step, same as SettingsContent.tsx's own "Buy more
    // credits" card already did before this hook existed -- omitting it
    // would leave a previous attempt's error banner visible while the
    // user is still deciding whether to retry.
    setTopupError,
    topupSuccess,
    razorpayReady,
    handleBuyTopup,
  }
}
