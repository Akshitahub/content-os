"use client"

import { useState } from "react"
import { Gift } from "lucide-react"
import { useCreditTopup } from "@/hooks/useCreditTopup"
import { CREDIT_PACKS, CREDIT_PACK_IDS, type CreditPackId } from "@/lib/usage/credit-packs"

// One color family per pack -- literal, complete class strings (not
// template-built from a bare color name) since Tailwind's JIT scanner only
// picks up classes it can find written out somewhere in the source.
const PACK_STYLES: Record<CreditPackId, { card: string; ribbon: string; icon: string; button: string }> = {
  quick_topup: {
    card: "bg-amber-50/60 dark:bg-amber-950/20 border-amber-200/60 dark:border-amber-800/30",
    ribbon: "bg-amber-300 dark:bg-amber-700",
    icon: "text-amber-600 dark:text-amber-400",
    button: "bg-amber-600 hover:bg-amber-700",
  },
  power_pack: {
    // Violet — matches the brand's own primary/accent color used
    // throughout the rest of the dashboard.
    card: "bg-violet-50/60 dark:bg-violet-950/20 border-violet-200/60 dark:border-violet-800/30",
    ribbon: "bg-violet-300 dark:bg-violet-700",
    icon: "text-violet-600 dark:text-violet-400",
    button: "bg-violet-600 hover:bg-violet-700",
  },
  mega_pack: {
    card: "bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200/60 dark:border-emerald-800/30",
    ribbon: "bg-emerald-300 dark:bg-emerald-700",
    icon: "text-emerald-600 dark:text-emerald-400",
    button: "bg-emerald-600 hover:bg-emerald-700",
  },
}

/**
 * Dashboard-level entry point for the same one-time credit top-up purchase
 * flow as Settings' "Buy more credits" card -- reuses hooks/useCreditTopup.ts
 * (the single source of truth for the Razorpay integration) rather than
 * re-implementing checkout/verify-payment here.
 */
export function CreditGiftBoxes() {
  const {
    topupConfirming,
    setTopupConfirming,
    topupState,
    topupError,
    setTopupError,
    topupSuccess,
    handleBuyTopup,
  } = useCreditTopup()

  // Local to this component only -- remembers which pack an in-flight error
  // belongs to even after topupConfirming itself has already reset to null
  // (handleBuyTopup clears it once the checkout-session fetch succeeds,
  // right before the Razorpay modal opens -- before a payment-cancelled/
  // failed/verify-failed error can even occur), so the error line always
  // has a card to render under instead of silently having nowhere to go.
  const [activePackId, setActivePackId] = useState<CreditPackId | null>(null)

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {CREDIT_PACK_IDS.map((packId) => {
          const pack = CREDIT_PACKS[packId]
          const styles = PACK_STYLES[packId]
          const isConfirming = topupConfirming === packId
          // Distinct credit counts per pack (100/200/500) make this a safe
          // way to tell which pack a shared topupSuccess belongs to.
          const justPurchased = topupSuccess?.credits === pack.credits

          return (
            <div
              key={packId}
              className={`relative overflow-hidden rounded-2xl border p-4 text-center ${styles.card}`}
            >
              {justPurchased ? (
                <div className="flex flex-col items-center justify-center gap-1 py-8">
                  <p className="text-sm font-medium text-green-700 dark:text-green-400">
                    ✓ {pack.credits.toLocaleString("en-IN")} credits added!
                  </p>
                  <p className="text-xs text-muted-foreground">Refreshing…</p>
                </div>
              ) : (
                <>
                  {packId === "power_pack" && (
                    <p className="mx-auto mb-2 w-fit rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                      A favorite
                    </p>
                  )}

                  {/* Bow — two overlapping rotated rounded rectangles, not a
                      full-width ribbon bar. */}
                  <div className="relative mx-auto mb-2 h-2.5 w-7">
                    <div className={`absolute left-1/2 top-1/2 h-2.5 w-4 -translate-x-1/2 -translate-y-1/2 -rotate-12 rounded-full ${styles.ribbon}`} />
                    <div className={`absolute left-1/2 top-1/2 h-2.5 w-4 -translate-x-1/2 -translate-y-1/2 rotate-12 rounded-full ${styles.ribbon}`} />
                  </div>

                  <Gift className={`mx-auto h-6 w-6 ${styles.icon}`} />

                  <p className="mt-1.5 text-xs font-medium text-foreground">{pack.name}</p>
                  <p className="text-lg font-semibold text-foreground">{pack.credits.toLocaleString("en-IN")}</p>
                  <p className="text-xs text-muted-foreground">₹{pack.price.toLocaleString("en-IN")}</p>

                  <div className="mt-3">
                    {!isConfirming ? (
                      <button
                        type="button"
                        className={`h-8 w-full rounded-md text-sm font-medium text-white transition-colors ${styles.button}`}
                        disabled={topupState === "loading"}
                        onClick={() => {
                          setActivePackId(packId)
                          setTopupConfirming(packId)
                          setTopupError(null)
                        }}
                      >
                        Buy {pack.credits.toLocaleString("en-IN")} credits
                      </button>
                    ) : (
                      <div className="space-y-1.5">
                        <p className="text-xs text-muted-foreground">
                          Buy {pack.credits.toLocaleString("en-IN")} credits for ₹{pack.price.toLocaleString("en-IN")}?
                        </p>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            className={`h-8 flex-1 rounded-md text-sm font-medium text-white transition-colors ${styles.button}`}
                            disabled={topupState === "loading"}
                            onClick={() => handleBuyTopup(packId)}
                          >
                            {topupState === "loading" ? "Loading…" : "Yes, buy"}
                          </button>
                          <button
                            type="button"
                            className="h-8 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-secondary"
                            disabled={topupState === "loading"}
                            onClick={() => setTopupConfirming(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {topupError && activePackId === packId && (
                    <p className="mt-2 text-xs text-destructive">{topupError}</p>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        A little something for whenever you need more room to create.
      </p>
    </div>
  )
}
