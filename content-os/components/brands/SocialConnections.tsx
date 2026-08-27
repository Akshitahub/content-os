"use client"

import { useState, useCallback, useEffect } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import Link from "next/link"
import { FaInstagram, FaThreads, FaPinterest, FaLinkedin, FaYoutube, FaXTwitter } from "react-icons/fa6"
import type { IconType } from "react-icons"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
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
  twitter_connected: boolean
  twitter_username: string | null
}

const ERROR_MESSAGES: Record<string, string> = {
  oauth_denied: "Connection was cancelled.",
  token_exchange_failed: "Could not complete the connection. Please try again.",
  no_boards: "No Pinterest board was found for your account. Create a board first, then try again.",
  server_error: "Something went wrong connecting your account. Please try again.",
  plan_restricted: "This platform is available on Pro and Agency plans. Upgrade to connect it.",
}

interface PlatformTile {
  key: string
  label: string
  Icon: IconType
  iconColor: string
  connected: boolean
  handle: string | null
  description: string
  connectHref: string
  showDisconnect: boolean
}

export function SocialConnections({ brandId }: { brandId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [plan, setPlan] = useState<UserPlan>("starter")
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
        // Leave as "starter" — the most conservative real default for a
        // gated feature now that Free is gone (Starter doesn't include
        // Zernio social platforms, same conservative intent as before).
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
    const twitterSuccess = searchParams.get("twitter_success")
    const twitterError = searchParams.get("twitter_error")

    if (success === "1") {
      setBanner({ type: "success", message: "Instagram connected successfully." })
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
    } else if (twitterSuccess === "1") {
      setBanner({ type: "success", message: "Twitter/X connected successfully." })
      router.replace(pathname)
    } else if (twitterError) {
      setBanner({ type: "error", message: ERROR_MESSAGES[twitterError] ?? ERROR_MESSAGES.server_error })
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
        twitter_connected: prev?.twitter_connected ?? false,
        twitter_username: prev?.twitter_username ?? null,
      }))
      setConfirmDisconnect(false)
    } catch {
      setActionError("Network error. Please try again.")
    } finally {
      setDisconnecting(false)
    }
  }, [brandId])

  const platforms: PlatformTile[] = [
    {
      key: "instagram",
      label: "Instagram",
      Icon: FaInstagram,
      iconColor: "#E1306C",
      connected: !!status?.connected,
      handle: status?.connected ? `@${status.ig_username ?? "unknown"}` : null,
      description: "Connect an Instagram Business or Creator account to schedule and publish posts there.",
      connectHref: `/api/v1/social/instagram/connect?brandId=${brandId}`,
      showDisconnect: true,
    },
    {
      key: "threads",
      label: "Threads",
      Icon: FaThreads,
      iconColor: "#000000",
      connected: !!status?.threads_connected,
      handle: status?.threads_connected ? `@${status.threads_username ?? "unknown"}` : null,
      description: "Connect Threads to schedule and publish posts there.",
      connectHref: `/api/v1/social/threads/connect?brandId=${brandId}`,
      showDisconnect: false,
    },
    {
      key: "pinterest",
      label: "Pinterest",
      Icon: FaPinterest,
      iconColor: "#E60023",
      connected: !!status?.pinterest_connected,
      handle: status?.pinterest_connected ? `@${status.pinterest_username ?? "unknown"}` : null,
      description: "Connect Pinterest to schedule and publish pins there.",
      connectHref: `/api/v1/social/pinterest/connect?brandId=${brandId}`,
      showDisconnect: false,
    },
    {
      key: "linkedin",
      label: "LinkedIn",
      Icon: FaLinkedin,
      iconColor: "#0A66C2",
      connected: !!status?.linkedin_connected,
      handle: status?.linkedin_connected ? (status.linkedin_username ?? "Connected") : null,
      description: "Connect LinkedIn to schedule and publish posts there.",
      connectHref: `/api/v1/social/linkedin/connect?brandId=${brandId}`,
      showDisconnect: false,
    },
    {
      key: "youtube",
      label: "YouTube",
      Icon: FaYoutube,
      iconColor: "#FF0000",
      connected: !!status?.youtube_connected,
      handle: status?.youtube_connected ? (status.youtube_channel_name ?? "Connected") : null,
      description: "Connect YouTube to schedule video uploads there.",
      connectHref: `/api/v1/social/youtube/connect?brandId=${brandId}`,
      showDisconnect: false,
    },
    {
      key: "twitter",
      label: "Twitter / X",
      Icon: FaXTwitter,
      iconColor: "#000000",
      connected: !!status?.twitter_connected,
      handle: status?.twitter_connected ? (status.twitter_username ?? "Connected") : null,
      description: "Connect Twitter/X to schedule and publish posts there.",
      connectHref: `/api/v1/social/twitter/connect?brandId=${brandId}`,
      showDisconnect: false,
    },
  ]

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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {platforms.map((platform) => {
          const gated = !platform.connected && !hasZernioAccess
          const isInstagramDisconnecting = platform.showDisconnect && confirmDisconnect

          return (
            <div
              key={platform.key}
              className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <platform.Icon className="h-4 w-4 flex-shrink-0" style={{ color: platform.iconColor }} />
                  <span className="truncate text-sm font-medium">{platform.label}</span>
                </div>
                <span
                  className={cn(
                    "h-2.5 w-2.5 flex-shrink-0 rounded-full",
                    loading
                      ? "bg-muted-foreground/20"
                      : platform.connected
                        ? "bg-green-500"
                        : gated
                          ? "bg-amber-400"
                          : "bg-muted-foreground/30"
                  )}
                  title={loading ? "Checking…" : platform.connected ? "Connected" : gated ? "Upgrade required" : "Not connected"}
                />
              </div>

              {loading ? (
                <p className="text-xs text-muted-foreground">Checking…</p>
              ) : platform.connected ? (
                <p className="truncate text-xs text-muted-foreground">{platform.handle}</p>
              ) : gated ? (
                <div className="flex items-center gap-1.5">
                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                    Pro
                  </span>
                  <span className="truncate text-xs text-amber-700">Upgrade to connect</span>
                </div>
              ) : (
                <p className="line-clamp-2 text-xs text-muted-foreground">{platform.description}</p>
              )}

              <div className="mt-auto">
                {loading ? null : platform.connected ? (
                  platform.showDisconnect ? (
                    isInstagramDisconnecting ? (
                      <div className="flex flex-col gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 p-2">
                        <p className="text-xs text-muted-foreground">Disconnect Instagram?</p>
                        <div className="flex gap-1.5">
                          <Button
                            variant="destructive"
                            size="sm"
                            className="h-7 flex-1 px-2 text-xs"
                            disabled={disconnecting}
                            onClick={handleDisconnect}
                          >
                            {disconnecting ? "…" : "Yes"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 flex-1 px-2 text-xs"
                            onClick={() => setConfirmDisconnect(false)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-full justify-start px-2 text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => setConfirmDisconnect(true)}
                      >
                        Disconnect
                      </Button>
                    )
                  ) : (
                    <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                      Connected
                    </span>
                  )
                ) : gated ? (
                  <Button size="sm" variant="outline" className="h-7 w-full text-xs" asChild>
                    <Link href="/settings?tab=billing">Upgrade</Link>
                  </Button>
                ) : (
                  <Button size="sm" className="h-7 w-full text-xs" asChild>
                    <a href={platform.connectHref}>Connect</a>
                  </Button>
                )}
              </div>

              {platform.showDisconnect && actionError && (
                <p className="text-xs text-destructive">{actionError}</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
