"use client"

import { useState, useCallback, useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { isApiError } from "@/types/api"
import posthog from "posthog-js"
import { POSTHOG_KEY } from "@/lib/analytics/posthog"
import { PLAN_LIMITS } from "@/types/app"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Plan = "free" | "starter" | "pro" | "agency"

interface UserProps {
  full_name: string | null
  email: string
  plan: Plan
  generation_count: number
  generation_count_reset_at: string | null
  reel_count_this_week: number
  reel_count_reset_at: string | null
  free_reel_used_at: string | null
}

interface BrandProps {
  id: string
  name: string
  niche: string | null
  is_active: boolean
}

interface SettingsContentProps {
  user: UserProps
  brands: BrandProps[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Generation/brand/reel limits come from PLAN_LIMITS in types/app.ts — the
// single source of truth shared with the backend usage checkers. This file
// previously hand-maintained its own stale copy (Pro showed a 500/mo cap
// here when the real limit had already moved to 1200).

const PLAN_COLORS: Record<Plan, string> = {
  free: "bg-gray-100 text-gray-700",
  starter: "bg-violet-100 text-violet-700",
  pro: "bg-blue-100 text-blue-700",
  agency: "bg-green-100 text-green-700",
}

const PLAN_FEATURES: { label: string; plans: Plan[] }[] = [
  { label: "AI content generation", plans: ["free", "starter", "pro", "agency"] },
  { label: "Brand management", plans: ["free", "starter", "pro", "agency"] },
  { label: "Auto-post & schedule (Instagram, Facebook, Threads, Pinterest)", plans: ["starter", "pro", "agency"] },
  { label: "Autopilot (30-day content planner)", plans: ["starter", "pro", "agency"] },
  { label: "Influencer outreach tools", plans: ["starter", "pro", "agency"] },
  { label: "LinkedIn, YouTube, Twitter/X publishing", plans: ["pro", "agency"] },
  { label: "AI video reels", plans: ["free", "pro", "agency"] },
  { label: "Competitor tracking", plans: ["starter", "pro", "agency"] },
  { label: "Full analytics + demographics + best-time-to-post", plans: ["pro", "agency"] },
  { label: "Monthly PDF reports", plans: ["starter", "pro", "agency"] },
  { label: "Dedicated support", plans: ["agency"] },
]

// ---------------------------------------------------------------------------
// Profile section schema
// ---------------------------------------------------------------------------

const profileSchema = z.object({
  full_name: z.string().min(1, "Name is required").max(200),
})

type ProfileFormValues = z.infer<typeof profileSchema>

// ---------------------------------------------------------------------------
// Section 1: Profile
// ---------------------------------------------------------------------------

function ProfileSection({ user }: { user: UserProps }) {
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const { register, handleSubmit, formState: { errors } } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { full_name: user.full_name ?? "" },
  })

  const initials = (user.full_name ?? user.email)
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()

  const onSubmit = useCallback(async (values: ProfileFormValues) => {
    setSaveState("saving")
    setErrorMsg(null)
    try {
      const res = await fetch("/api/v1/user/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      })
      const json: unknown = await res.json()
      if (!res.ok || isApiError(json)) {
        const msg = isApiError(json) ? json.error.message : "Failed to save."
        setErrorMsg(msg)
        setSaveState("error")
        return
      }
      setSaveState("saved")
      try { if (POSTHOG_KEY) posthog.capture("profile_updated") } catch {}
      setTimeout(() => setSaveState("idle"), 2000)
    } catch {
      setErrorMsg("Network error. Please try again.")
      setSaveState("error")
    }
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Avatar row */}
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">
              {initials}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled
              title="Coming soon"
            >
              Upload photo
            </Button>
          </div>

          {/* Full name */}
          <div className="space-y-1.5">
            <Label htmlFor="full_name">Full name</Label>
            <Input
              id="full_name"
              placeholder="Your name"
              {...register("full_name")}
            />
            {errors.full_name && (
              <p className="text-xs text-destructive">{errors.full_name.message}</p>
            )}
          </div>

          {/* Email (read-only) */}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={user.email}
              readOnly
              disabled
              className="cursor-not-allowed"
            />
            <p className="text-xs text-muted-foreground">Email cannot be changed here.</p>
          </div>

          {/* Save feedback + button */}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saveState === "saving"}>
              {saveState === "saving" ? "Saving…" : "Save changes"}
            </Button>
            {saveState === "saved" && (
              <span className="text-sm font-medium text-green-600">Saved!</span>
            )}
            {saveState === "error" && errorMsg && (
              <span className="text-sm text-destructive">{errorMsg}</span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Section 2: Plan & usage
// ---------------------------------------------------------------------------

interface RazorpayResponse {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

function PlanSection({ user }: { user: UserProps }) {
  const limit = PLAN_LIMITS[user.plan].generations
  const count = user.generation_count
  const pct = Math.min(100, Math.round((count / limit) * 100))

  const reelsPerWeek = PLAN_LIMITS[user.plan].reelsPerWeek
  const reelResetAt = user.reel_count_reset_at ? new Date(user.reel_count_reset_at) : null
  const reelCountNeedsReset = !reelResetAt || reelResetAt <= new Date()
  const reelCountThisWeek = reelCountNeedsReset ? 0 : user.reel_count_this_week

  const [upgradeState, setUpgradeState] = useState<"idle" | "loading">("idle")
  const [billingError, setBillingError] = useState<string | null>(null)
  const [paymentSuccess, setPaymentSuccess] = useState(false)

  // Load the Razorpay checkout script once on mount
  useEffect(() => {
    const script = document.createElement("script")
    script.src = "https://checkout.razorpay.com/v1/checkout.js"
    script.async = true
    document.body.appendChild(script)
    return () => {
      document.body.removeChild(script)
    }
  }, [])

  const handleUpgrade = useCallback(async (plan: "starter" | "pro" | "agency") => {
    setUpgradeState("loading")
    setBillingError(null)
    setPaymentSuccess(false)
    try {
      const res = await fetch("/api/v1/billing/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      })
      const json = await res.json() as {
        data?: { orderId: string; amount: number; currency: string; keyId: string }
        error?: { message: string }
      }
      if (!res.ok || !json.data) {
        setBillingError(json.error?.message ?? "Failed to start checkout.")
        setUpgradeState("idle")
        return
      }

      const { orderId, amount, currency, keyId } = json.data
      setUpgradeState("idle")

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rzp = new (window as any).Razorpay({
        key: keyId,
        amount,
        currency,
        name: "ContentOS",
        description: `${{ starter: "Starter", pro: "Pro", agency: "Agency" }[plan]} Plan`,
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
                plan,
              }),
            })
            if (verifyRes.ok) {
              setPaymentSuccess(true)
              setTimeout(() => window.location.reload(), 2000)
            } else {
              const errJson = await verifyRes.json() as { error?: { message: string } }
              setBillingError(errJson.error?.message ?? "Payment verification failed. Please contact support.")
            }
          } catch {
            setBillingError("Could not verify payment. Please contact support.")
          }
        },
        theme: { color: "#7c3aed" },
      })
      rzp.open()
    } catch {
      setBillingError("Network error. Please try again.")
      setUpgradeState("idle")
    }
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plan &amp; usage</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Current plan badge */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-muted-foreground">Current plan</span>
          <span className={`rounded-full px-3 py-0.5 text-xs font-semibold capitalize ${PLAN_COLORS[user.plan]}`}>
            {user.plan}
          </span>
          {user.plan === "free" && (
            <span className="text-xs text-muted-foreground">
              {user.free_reel_used_at ? "Free reel used" : "1 free AI video reel available"}
            </span>
          )}
          {(user.plan === "pro" || user.plan === "agency") && (
            <span className="text-xs text-muted-foreground">
              {reelCountThisWeek} of {reelsPerWeek} AI video reels used this week
            </span>
          )}
        </div>

        {/* Generation usage */}
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {count} / {limit} generations used this month
          </p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className={`h-full rounded-full transition-all ${pct >= 80 ? "bg-red-500" : "bg-primary"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Feature comparison */}
        <div className="space-y-1">
          <p className="text-sm font-medium">Features on your plan</p>
          <ul className="mt-2 space-y-1.5">
            {PLAN_FEATURES.map((feat) => {
              const included = feat.plans.includes(user.plan)
              return (
                <li key={feat.label} className="flex items-center gap-2 text-sm">
                  {included ? (
                    <span className="text-green-500">&#10003;</span>
                  ) : (
                    <span className="text-muted-foreground">&#8212;</span>
                  )}
                  <span className={included ? "" : "text-muted-foreground"}>{feat.label}</span>
                </li>
              )
            })}
          </ul>
        </div>

        {/* Payment success banner */}
        {paymentSuccess && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
            <p className="text-sm font-medium text-green-700">
              ✓ Payment successful! Your plan has been upgraded. Refreshing…
            </p>
          </div>
        )}

        {/* Upgrade buttons */}
        {user.plan === "free" && (
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => handleUpgrade("starter")}
              disabled={upgradeState === "loading"}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              {upgradeState === "loading" ? "Loading…" : "Upgrade to Starter — ₹699/mo"}
            </Button>
            <Button
              variant="outline"
              onClick={() => handleUpgrade("pro")}
              disabled={upgradeState === "loading"}
            >
              Upgrade to Pro — ₹2,499/mo
            </Button>
            <Button
              variant="outline"
              onClick={() => handleUpgrade("agency")}
              disabled={upgradeState === "loading"}
            >
              Upgrade to Agency — ₹6,999/mo
            </Button>
          </div>
        )}

        {user.plan === "starter" && (
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => handleUpgrade("pro")}
              disabled={upgradeState === "loading"}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              {upgradeState === "loading" ? "Loading…" : "Upgrade to Pro — ₹2,499/mo"}
            </Button>
            <Button
              variant="outline"
              onClick={() => handleUpgrade("agency")}
              disabled={upgradeState === "loading"}
            >
              Upgrade to Agency — ₹6,999/mo
            </Button>
          </div>
        )}

        {user.plan === "pro" && (
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => handleUpgrade("agency")}
              disabled={upgradeState === "loading"}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              {upgradeState === "loading" ? "Loading…" : "Upgrade to Agency — ₹6,999/mo"}
            </Button>
          </div>
        )}

        {billingError && (
          <p className="text-sm text-destructive">{billingError}</p>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Section 3: Brand management
// ---------------------------------------------------------------------------

function BrandsSection({ initialBrands }: { initialBrands: BrandProps[] }) {
  const router = useRouter()
  const [brands, setBrands] = useState<BrandProps[]>(initialBrands)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const handleDeleteConfirm = useCallback(async (id: string) => {
    setDeletingId(id)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/v1/brands/${id}`, { method: "DELETE" })
      const json: unknown = await res.json()
      if (!res.ok || isApiError(json)) {
        const msg = isApiError(json) ? json.error.message : "Failed to delete brand."
        setDeleteError(msg)
        setDeletingId(null)
        return
      }
      setBrands((prev) => prev.filter((b) => b.id !== id))
      setConfirmDeleteId(null)
      router.refresh()
    } catch {
      setDeleteError("Network error. Please try again.")
    } finally {
      setDeletingId(null)
    }
  }, [router])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Brands</CardTitle>
      </CardHeader>
      <CardContent>
        {brands.length === 0 ? (
          <p className="text-sm text-muted-foreground">No brands yet.</p>
        ) : (
          <ul className="space-y-3">
            {brands.map((brand) => (
              <li key={brand.id} className="rounded-md border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{brand.name}</span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                          brand.is_active
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {brand.is_active ? "Active" : "Inactive"}
                      </span>
                    </div>
                    {brand.niche && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{brand.niche}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/brands/${brand.id}`}>Edit</Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        setDeleteError(null)
                        setConfirmDeleteId(confirmDeleteId === brand.id ? null : brand.id)
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>

                {/* Inline confirm */}
                {confirmDeleteId === brand.id && (
                  <div className="mt-3 flex items-center gap-3 border-t pt-3">
                    <p className="text-sm text-muted-foreground">Are you sure?</p>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={deletingId === brand.id}
                      onClick={() => handleDeleteConfirm(brand.id)}
                    >
                      {deletingId === brand.id ? "Deleting…" : "Yes, delete"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmDeleteId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {deleteError && (
          <p className="mt-3 text-sm text-destructive">{deleteError}</p>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Section 4: Danger zone
// ---------------------------------------------------------------------------

function DangerZoneSection() {
  const router = useRouter()
  const [showConfirm, setShowConfirm] = useState(false)
  const [confirmInput, setConfirmInput] = useState("")
  const [isDeleting, setIsDeleting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const handleDeleteAccount = useCallback(async () => {
    if (confirmInput !== "DELETE") return
    setIsDeleting(true)
    setErrorMsg(null)
    try {
      const res = await fetch("/api/v1/user/account", { method: "DELETE" })
      const json: unknown = await res.json()
      if (!res.ok || isApiError(json)) {
        const msg = isApiError(json) ? json.error.message : "Failed to delete account."
        setErrorMsg(msg)
        setIsDeleting(false)
        return
      }
      router.push("/login")
    } catch {
      setErrorMsg("Network error. Please try again.")
      setIsDeleting(false)
    }
  }, [confirmInput, router])

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Permanently delete your account and all associated data. This action cannot be undone.
        </p>

        {!showConfirm ? (
          <Button
            variant="destructive"
            onClick={() => setShowConfirm(true)}
          >
            Delete account
          </Button>
        ) : (
          <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
            <p className="text-sm font-medium">
              Type <span className="font-mono font-bold">DELETE</span> to confirm
            </p>
            <Input
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              placeholder="DELETE"
              className="max-w-xs font-mono"
            />
            <div className="flex items-center gap-3">
              <Button
                variant="destructive"
                disabled={confirmInput !== "DELETE" || isDeleting}
                onClick={handleDeleteAccount}
              >
                {isDeleting ? "Deleting…" : "Confirm deletion"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setShowConfirm(false)
                  setConfirmInput("")
                  setErrorMsg(null)
                }}
              >
                Cancel
              </Button>
            </div>
            {errorMsg && (
              <p className="text-sm text-destructive">{errorMsg}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Section 5: Connections (coming soon)
// ---------------------------------------------------------------------------

const PLATFORMS_COMING_SOON = [
  { name: "TikTok", icon: "🎵", note: "Requires TikTok developer account" },
  { name: "LinkedIn", icon: "💼", note: "Requires LinkedIn app" },
  { name: "YouTube", icon: "▶️", note: "Requires Google OAuth" },
  { name: "Twitter / X", icon: "🐦", note: "Requires X developer account" },
] as const

function ConnectionsSection({ brands }: { brands: BrandProps[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect &amp; publish</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Connect your social accounts to auto-post directly from the calendar. Until then, copy content from any calendar entry and post manually.
        </p>

        <div className="flex items-center justify-between rounded-md border px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-lg">📸</span>
            <div>
              <p className="text-sm font-medium">Instagram</p>
              <p className="text-xs text-muted-foreground">Connect per brand from that brand&apos;s page</p>
            </div>
          </div>
          {brands.length > 0 ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`/brands/${brands[0].id}`}>Manage</Link>
            </Button>
          ) : (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Add a brand first</span>
          )}
        </div>

        <ul className="space-y-2">
          {PLATFORMS_COMING_SOON.map(platform => (
            <li key={platform.name} className="flex items-center justify-between rounded-md border px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="text-lg">{platform.icon}</span>
                <div>
                  <p className="text-sm font-medium">{platform.name}</p>
                  <p className="text-xs text-muted-foreground">{platform.note}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Not connected</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled
                  title="Coming soon — deploy your app first to enable OAuth callbacks"
                >
                  Connect
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Auto-posting requires a deployed domain for OAuth callbacks. Feature coming soon.
        </p>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Root client component
// ---------------------------------------------------------------------------

export function SettingsContent({ user, brands }: SettingsContentProps) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <ProfileSection user={user} />
      <Separator />
      <PlanSection user={user} />
      <Separator />
      <ConnectionsSection brands={brands} />
      <Separator />
      <BrandsSection initialBrands={brands} />
      <Separator />
      <DangerZoneSection />
    </div>
  )
}
