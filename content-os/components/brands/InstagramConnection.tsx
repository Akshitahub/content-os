"use client"

import { useState, useCallback, useEffect } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { AtSign } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { isApiError } from "@/types/api"

interface ConnectionStatus {
  connected: boolean
  ig_username: string | null
  connected_at: string | null
}

const ERROR_MESSAGES: Record<string, string> = {
  oauth_denied: "Instagram connection was cancelled.",
  token_exchange_failed: "Could not complete the connection with Meta. Please try again.",
  no_pages: "No Facebook Page was found for your account. Connect a Facebook Page to a Business or Creator Instagram account first.",
  no_instagram_account: "No Instagram Business or Creator account is linked to your Facebook Page. Convert your Instagram account to a Business/Creator account and link it to a Facebook Page, then try again.",
  server_error: "Something went wrong connecting Instagram. Please try again.",
}

export function InstagramConnection({ brandId }: { brandId: string }) {
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

    if (success) {
      setBanner({ type: "success", message: "Instagram connected successfully." })
      router.replace(pathname)
    } else if (error) {
      setBanner({ type: "error", message: ERROR_MESSAGES[error] ?? ERROR_MESSAGES.server_error })
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
      setStatus({ connected: false, ig_username: null, connected_at: null })
      setConfirmDisconnect(false)
    } catch {
      setActionError("Network error. Please try again.")
    } finally {
      setDisconnecting(false)
    }
  }, [brandId])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <AtSign className="h-4 w-4" /> Instagram
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
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

        {loading ? (
          <p className="text-sm text-muted-foreground">Checking connection status…</p>
        ) : status?.connected ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-md border px-4 py-3">
              <div>
                <p className="text-sm font-medium">@{status.ig_username ?? "unknown"}</p>
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
                <p className="text-sm text-muted-foreground">Disconnect Instagram?</p>
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
                Requires an Instagram Business or Creator account linked to a Facebook Page.
              </p>
            </div>
            <Button size="sm" asChild>
              <a href={`/api/v1/social/instagram/connect?brandId=${brandId}`}>Connect Instagram</a>
            </Button>
          </div>
        )}

        {actionError && <p className="text-sm text-destructive">{actionError}</p>}
      </CardContent>
    </Card>
  )
}
