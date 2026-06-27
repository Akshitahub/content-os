"use client"

import { useState, useCallback } from "react"
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

const PLAN_LIMITS: Record<Plan, number> = {
  free: 15,
  starter: 500,
  pro: 500,
  agency: 2000,
}

const PLAN_COLORS: Record<Plan, string> = {
  free: "bg-gray-100 text-gray-700",
  starter: "bg-violet-100 text-violet-700",
  pro: "bg-blue-100 text-blue-700",
  agency: "bg-green-100 text-green-700",
}

const PLAN_FEATURES: { label: string; plans: Plan[] }[] = [
  { label: "AI content generation", plans: ["free", "starter", "pro", "agency"] },
  { label: "Brand management", plans: ["free", "starter", "pro", "agency"] },
  { label: "Influencer discovery", plans: ["starter", "pro", "agency"] },
  { label: "Content calendar", plans: ["starter", "pro", "agency"] },
  { label: "Image generation", plans: ["pro", "agency"] },
  { label: "Multiple brands", plans: ["pro", "agency"] },
  { label: "Priority support", plans: ["agency"] },
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

function PlanSection({ user }: { user: UserProps }) {
  const limit = PLAN_LIMITS[user.plan]
  const count = user.generation_count
  const pct = Math.min(100, Math.round((count / limit) * 100))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plan &amp; usage</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Current plan badge */}
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-muted-foreground">Current plan</span>
          <span className={`rounded-full px-3 py-0.5 text-xs font-semibold capitalize ${PLAN_COLORS[user.plan]}`}>
            {user.plan}
          </span>
        </div>

        {/* Generation usage */}
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {count} / {limit} generations used this month
          </p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all"
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

        {/* Upgrade CTA */}
        {user.plan !== "agency" && (
          <Button asChild variant="outline">
            <Link href="/#pricing">Upgrade plan</Link>
          </Button>
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
// Root client component
// ---------------------------------------------------------------------------

export function SettingsContent({ user, brands }: SettingsContentProps) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <ProfileSection user={user} />
      <Separator />
      <PlanSection user={user} />
      <Separator />
      <BrandsSection initialBrands={brands} />
      <Separator />
      <DangerZoneSection />
    </div>
  )
}
