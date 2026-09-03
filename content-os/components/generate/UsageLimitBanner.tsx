"use client"

import { useEffect } from "react"
import Link from "next/link"
import { AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ApiResponseError } from "@/hooks/useGeneration"
import { useCreditTopup } from "@/hooks/useCreditTopup"
import { getFriendlyError } from "@/lib/utils/error-messages"
import { CREDIT_PACKS, CREDIT_PACK_IDS } from "@/lib/usage/credit-packs"

interface UsageLimitBannerProps {
  error: unknown
  onRetry: () => void
}

/**
 * Shared amber error banner for every "Create" generator (previously a
 * near-identical block copy-pasted across ContentTypeGenerator,
 * HookGenerator, FullPostGenerator, CarouselBuilder, StorySequence,
 * BlogPostGenerator, and AdMaker). Each caller keeps its own
 * `{error && <UsageLimitBanner .../>}` guard -- this only decides WHAT to
 * render once there's genuinely an error to show, not whether to mount at
 * all (mounting unconditionally would mean useCreditTopup's Razorpay
 * script-load effect fires on every Create tab visit, error or not).
 *
 * - A plain generation failure keeps today's exact look: message + a
 *   "🔄 Try again" button calling onRetry.
 * - A USAGE_LIMIT_EXCEEDED failure gets the real fix instead of a dead-end
 *   retry (retrying can't fix a credit shortage): the same inline
 *   credit-pack picker as Settings' "Buy more credits" card, driven by
 *   this component's own useCreditTopup() call -- not a second
 *   implementation of that flow. Buying a pack auto-retries the
 *   generation shortly after credits land, since that's the one case
 *   where auto-retry is actually correct (the underlying "out of
 *   credits" condition just changed).
 */
export function UsageLimitBanner({ error, onRetry }: UsageLimitBannerProps) {
  const {
    topupConfirming,
    setTopupConfirming,
    topupState,
    topupError,
    setTopupError,
    topupSuccess,
    handleBuyTopup,
  } = useCreditTopup()

  useEffect(() => {
    if (!topupSuccess) return
    const t = setTimeout(() => onRetry(), 1500)
    return () => clearTimeout(t)
  }, [topupSuccess, onRetry])

  if (!error) return null

  const isUsageLimit = error instanceof ApiResponseError && error.code === "USAGE_LIMIT_EXCEEDED"

  if (!isUsageLimit) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-3">
        <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm text-amber-900 font-medium">{getFriendlyError(error)}</p>
          <button onClick={onRetry} className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-amber-700 hover:text-amber-900">
            🔄 Try again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-50 p-4 space-y-3">
      <p className="text-sm font-semibold text-amber-900 text-center">{error.message}</p>

      {topupSuccess && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-sm font-medium text-green-700 text-center">
            ✓ {topupSuccess.credits} credits added! Refreshing…
          </p>
        </div>
      )}

      {/* Exact pack-picker UI/interaction as SettingsContent.tsx's own
          "Buy more credits" card -- same confirm-then-buy two-step per
          pack, same classNames, just a white card background here since
          this sits inside an amber banner instead of Settings' plain
          card. */}
      <div className="grid gap-3 sm:grid-cols-3">
        {CREDIT_PACK_IDS.map((packId) => {
          const pack = CREDIT_PACKS[packId]
          const isConfirming = topupConfirming === packId
          return (
            <div key={packId} className="rounded-lg border bg-white p-3 space-y-2">
              <div>
                <p className="text-sm font-semibold">{pack.name}</p>
                <p className="text-xs text-muted-foreground">{pack.credits.toLocaleString("en-IN")} credits</p>
              </div>
              {!isConfirming ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={topupState === "loading"}
                  onClick={() => { setTopupConfirming(packId); setTopupError(null) }}
                >
                  {`₹${pack.price.toLocaleString("en-IN")}`}
                </Button>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">Buy {pack.credits} credits for ₹{pack.price.toLocaleString("en-IN")}?</p>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      className="flex-1 bg-violet-600 hover:bg-violet-700 text-white"
                      disabled={topupState === "loading"}
                      onClick={() => handleBuyTopup(packId)}
                    >
                      {topupState === "loading" ? "Loading…" : "Yes, buy"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={topupState === "loading"}
                      onClick={() => setTopupConfirming(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {topupError && (
        <p className="text-sm text-destructive text-center">{topupError}</p>
      )}

      {/* Same upgrade destination Header.tsx's own low-credit nudge and
          upgrade links use -- the id="plan-usage" Card that wraps
          SettingsContent.tsx's own upgrade CTAs. */}
      <div className="text-center">
        <Link href="/settings#plan-usage" className="text-xs font-semibold text-amber-700 underline underline-offset-2 hover:text-amber-900">
          Or upgrade your plan →
        </Link>
      </div>
    </div>
  )
}
