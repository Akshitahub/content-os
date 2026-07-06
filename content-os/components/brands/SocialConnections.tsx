"use client"

import { useState, useCallback, useEffect } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import Link from "next/link"
import { FaInstagram, FaFacebook, FaThreads, FaPinterest, FaLinkedin, FaYoutube } from "react-icons/fa6"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { isApiError } from "@/types/api"
import { PLAN_LIMITS, type UserPlan } from "@/types/app"

interface ConnectionStatus {
  connected: boolean
  facebook_connected: boolean
  instagram_connected: boolean
  ig_username: string | null
  connected_at: string | null
  threads_connected: boolean
  threads_username: string | null
  pinterest_connected: boolean
  pinterest_username: string | null
  linkedin_connected: boolean
  linkedin_username: string | null
  youtube_connected: boolean
  youtube_channel_name: string | null
}

const ERROR_MESSAGES: Record<string, string> = {
  oauth_denied: "Connection was cancelled.",
  token_exchange_failed: "Could not complete the connection with Meta. Please try again.",
  no_pages: "No Facebook Page was found for your account. Create a Facebook Page first, then try again.",
  no_boards: "No Pinterest board was found for your account. Create a board first, then try again.",
  server_error: "Something went wrong connecting your account. Please try again.",
  plan_restricted: "LinkedIn and YouTube publishing are available on Pro and Agency plans. Upgrade to connect this platform.",
}

export function SocialConnections({ brandId }: { brandId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [plan, setPlan] = useState<UserPlan>("free")
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [banner, setBanner] = useState<{ type: "success" | "error"; message: string } | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/brands/${brandId}/social-connections`)
      const json: unknown = await res.json()
      if (res.ok && !isApiError(json)) {
        setStatus((json as { data: ConnectionStatus }).data)
      }
    } catch {
      // Leave status as null — UI falls back to "not connected" state
    } finally {
      setLoading(false)
    }
  }, [brandId])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  // LinkedIn/YouTube are gated to paid plans (Zernio bills per connected
  // account) — fetched separately from connection status since it comes
  // from the user's profile, not the brand's social connections.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/v1/user/profile")
        const json: unknown = await res.json()
        if (!cancelled && res.ok && !isApiError(json)) {
          setPlan((json as { data: { plan: UserPlan } }).data.plan)
        }
      } catch {
        // Leave as "free" — the more conservative default for a gated feature
      }
    })()
    return () => { cancelled = true }
  }, [])

  const hasZernioAccess = PLAN_LIMITS[plan].zernioSocialPlatforms

  // Surface the success/error banner from the OAuth callback redirect, then
  // strip the query params so a refresh doesn't re-show it.
  useEffect(() => {
    const success = searchParams.get("ig_success")
    const error = searchParams.get("ig_error")
    const threadsSuccess = searchParams.get("threads_success")
    const threadsError = searchParams.get("threads_error")
    const pinterestSuccess = searchParams.get("pinterest_success")
    const pinterestError = searchParams.get("pinterest_error")
    const linkedinSuccess = searchParams.get("linkedin_success")
    const linkedinError = searchParams.get("linkedin_error")
    const youtubeSuccess = searchParams.get("youtube_success")
    const youtubeError = searchParams.get("youtube_error")

    if (success === "1") {
      setBanner({ type: "success", message: "Instagram and Facebook connected successfully." })
      router.replace(pathname)
    } else if (success === "partial") {
      setBanner({
        type: "success",
        message: "Facebook connected. Instagram not available — no Instagram Business account is linked to this Page.",
      })
      router.replace(pathname)
    } else if (error) {
      setBanner({ type: "error", message: ERROR_MESSAGES[error] ?? ERROR_MESSAGES.server_error })
      router.replace(pathname)
    } else if (threadsSuccess === "1") {
      setBanner({ type: "success", message: "Threads connected successfully." })
      router.replace(pathname)
    } else if (threadsError) {
      setBanner({ type: "error", message: ERROR_MESSAGES[threadsError] ?? ERROR_MESSAGES.server_error })
      router.replace(pathname)
    } else if (pinterestSuccess === "1") {
      setBanner({ type: "success", message: "Pinterest connected successfully." })
      router.replace(pathname)
    } else if (pinterestError) {
      setBanner({ type: "error", message: ERROR_MESSAGES[pinterestError] ?? ERROR_MESSAGES.server_error })
      router.replace(pathname)
    } else if (linkedinSuccess === "1") {
      setBanner({ type: "success", message: "LinkedIn connected successfully." })
      router.replace(pathname)
    } else if (linkedinError) {
      setBanner({ type: "error", message: ERROR_MESSAGES[linkedinError] ?? ERROR_MESSAGES.server_error })
      router.replace(pathname)
    } else if (youtubeSuccess === "1") {
      setBanner({ type: "success", message: "YouTube connected successfully." })
      router.replace(pathname)
    } else if (youtubeError) {
      setBanner({ type: "error", message: ERROR_MESSAGES[youtubeError] ?? ERROR_MESSAGES.server_error })
      router.replace(pathname)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const handleDisconnect = useCallback(async () => {
    setDisconnecting(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/v1/brands/${brandId}/social-connections`, { method: "DELETE" })
      const json: unknown = await res.json()
      if (!res.ok || isApiError(json)) {
        const msg = isApiError(json) ? json.error.message : "Failed to disconnect."
        setActionError(msg)
        return
      }
      setStatus((prev) => ({
        connected: false,
        facebook_connected: false,
        instagram_connected: false,
        ig_username: null,
        connected_at: null,
        threads_connected: prev?.threads_connected ?? false,
        threads_username: prev?.threads_username ?? null,
        pinterest_connected: prev?.pinterest_connected ?? false,
        pinterest_username: prev?.pinterest_username ?? null,
        linkedin_connected: prev?.linkedin_connected ?? false,
        linkedin_username: prev?.linkedin_username ?? null,
        youtube_connected: prev?.youtube_connected ?? false,
        youtube_channel_name: prev?.youtube_channel_name ?? null,
      }))
      setConfirmDisconnect(false)
    } catch {
      setActionError("Network error. Please try again.")
    } finally {
      setDisconnecting(false)
    }
  }, [brandId])

  return (
    <div className="space-y-4">
      {banner && (
        <div
          className={`rounded-md border px-4 py-3 text-sm ${
            banner.type === "success"
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-destructive/40 bg-destructive/5 text-destructive"
          }`}
        >
          {banner.message}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FaInstagram className="h-5 w-5" style={{ color: "#E1306C" }} />
            <FaFacebook className="h-5 w-5" style={{ color: "#1877F2" }} />
            Instagram &amp; Facebook
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Checking connection status…</p>
          ) : status?.connected ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-md border px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">Facebook Page</p>
                    {status.connected_at && (
                      <p className="text-xs text-muted-foreground">
                        Connected {new Date(status.connected_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                    Connected
                  </span>
                </div>

                {status.instagram_connected ? (
                  <div className="flex items-center justify-between rounded-md border px-4 py-3">
                    <p className="text-sm font-medium">@{status.ig_username ?? "unknown"}</p>
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                      Connected
                    </span>
                  </div>
                ) : (
                  <div className="rounded-md border px-4 py-3">
                    <p className="text-sm font-medium">Instagram</p>
                    <p className="text-xs text-muted-foreground">
                      Not available — no Instagram Business account is linked to this Page.
                    </p>
                  </div>
                )}
              </div>

              {!confirmDisconnect ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setConfirmDisconnect(true)}
                >
                  Disconnect
                </Button>
              ) : (
                <div className="flex items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                  <p className="text-sm text-muted-foreground">Disconnect Instagram &amp; Facebook?</p>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={disconnecting}
                    onClick={handleDisconnect}
                  >
                    {disconnecting ? "Disconnecting…" : "Yes, disconnect"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDisconnect(false)}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-md border px-4 py-3">
              <div>
                <p className="text-sm font-medium">Not connected</p>
                <p className="text-xs text-muted-foreground">
                  Requires a Facebook Page. An Instagram Business account linked to that Page enables Instagram auto-posting too.
                </p>
              </div>
              <Button size="sm" asChild>
                <a href={`/api/v1/social/instagram/connect?brandId=${brandId}`}>Connect Instagram &amp; Facebook</a>
              </Button>
            </div>
          )}

          {actionError && <p className="text-sm text-destructive">{actionError}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FaThreads className="h-5 w-5" style={{ color: "#000000" }} /> Threads
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Checking connection status…</p>
          ) : status?.threads_connected ? (
            <div className="flex items-center justify-between rounded-md border px-4 py-3">
              <p className="text-sm font-medium">@{status.threads_username ?? "unknown"}</p>
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                Connected
              </span>
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-md border px-4 py-3">
              <div>
                <p className="text-sm font-medium">Not connected</p>
                <p className="text-xs text-muted-foreground">
                  Connect Threads to schedule and publish posts there.
                </p>
              </div>
              <Button size="sm" asChild>
                <a href={`/api/v1/social/threads/connect?brandId=${brandId}`}>Connect Threads</a>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FaPinterest className="h-5 w-5" style={{ color: "#E60023" }} /> Pinterest
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Checking connection status…</p>
          ) : status?.pinterest_connected ? (
            <div className="flex items-center justify-between rounded-md border px-4 py-3">
              <p className="text-sm font-medium">@{status.pinterest_username ?? "unknown"}</p>
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                Connected
              </span>
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-md border px-4 py-3">
              <div>
                <p className="text-sm font-medium">Not connected</p>
                <p className="text-xs text-muted-foreground">
                  Connect Pinterest to schedule and publish pins there.
                </p>
              </div>
              <Button size="sm" asChild>
                <a href={`/api/v1/social/pinterest/connect?brandId=${brandId}`}>Connect Pinterest</a>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FaLinkedin className="h-5 w-5" style={{ color: "#0A66C2" }} /> LinkedIn
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Checking connection status…</p>
          ) : status?.linkedin_connected ? (
            <div className="flex items-center justify-between rounded-md border px-4 py-3">
              <p className="text-sm font-medium">{status.linkedin_username ?? "Connected"}</p>
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                Connected
              </span>
            </div>
          ) : !hasZernioAccess ? (
            <div className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-amber-900">Not connected</p>
                  <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-800">Pro</span>
                </div>
                <p className="text-xs text-amber-700">
                  LinkedIn publishing is available on Pro and Agency plans.
                </p>
              </div>
              <Button size="sm" variant="outline" asChild>
                <Link href="/settings?tab=billing">Upgrade</Link>
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-md border px-4 py-3">
              <div>
                <p className="text-sm font-medium">Not connected</p>
                <p className="text-xs text-muted-foreground">
                  Connect LinkedIn to schedule and publish posts there.
                </p>
              </div>
              <Button size="sm" asChild>
                <a href={`/api/v1/social/linkedin/connect?brandId=${brandId}`}>Connect LinkedIn</a>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FaYoutube className="h-5 w-5" style={{ color: "#FF0000" }} /> YouTube
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Checking connection status…</p>
          ) : status?.youtube_connected ? (
            <div className="flex items-center justify-between rounded-md border px-4 py-3">
              <p className="text-sm font-medium">{status.youtube_channel_name ?? "Connected"}</p>
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                Connected
              </span>
            </div>
          ) : !hasZernioAccess ? (
            <div className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-amber-900">Not connected</p>
                  <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-800">Pro</span>
                </div>
                <p className="text-xs text-amber-700">
                  YouTube publishing is available on Pro and Agency plans.
                </p>
              </div>
              <Button size="sm" variant="outline" asChild>
                <Link href="/settings?tab=billing">Upgrade</Link>
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-md border px-4 py-3">
              <div>
                <p className="text-sm font-medium">Not connected</p>
                <p className="text-xs text-muted-foreground">
                  Connect YouTube to schedule video uploads there.
                </p>
              </div>
              <Button size="sm" asChild>
                <a href={`/api/v1/social/youtube/connect?brandId=${brandId}`}>Connect YouTube</a>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
