"use client"

import { useState, useCallback, useEffect } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { AtSign } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { isApiError } from "@/types/api"

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
}

const ERROR_MESSAGES: Record<string, string> = {
  oauth_denied: "Connection was cancelled.",
  token_exchange_failed: "Could not complete the connection with Meta. Please try again.",
  no_pages: "No Facebook Page was found for your account. Create a Facebook Page first, then try again.",
  no_boards: "No Pinterest board was found for your account. Create a board first, then try again.",
  server_error: "Something went wrong connecting your account. Please try again.",
}

export function SocialConnections({ brandId }: { brandId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  const [loading, setLoading] = useState(true)
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

  // Surface the success/error banner from the OAuth callback redirect, then
  // strip the query params so a refresh doesn't re-show it.
  useEffect(() => {
    const success = searchParams.get("ig_success")
    const error = searchParams.get("ig_error")
    const threadsSuccess = searchParams.get("threads_success")
    const threadsError = searchParams.get("threads_error")
    const pinterestSuccess = searchParams.get("pinterest_success")
    const pinterestError = searchParams.get("pinterest_error")

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
            <AtSign className="h-4 w-4" /> Instagram &amp; Facebook
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
            <AtSign className="h-4 w-4" /> Threads
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
            <AtSign className="h-4 w-4" /> Pinterest
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
    </div>
  )
}
