"use client"

import { useState, useCallback, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import Link from "next/link"
import { isApiError } from "@/types/api"

interface ConnectionStatus {
  connected: boolean
  facebook_connected: boolean
  instagram_connected: boolean
}

export function CompetitorAnalysis({ brandId }: { brandId: string }) {
  const [connection, setConnection] = useState<ConnectionStatus | null>(null)
  const [checkingConnection, setCheckingConnection] = useState(false)
  const [connectionError, setConnectionError] = useState(false)

  const checkConnection = useCallback(async () => {
    setCheckingConnection(true)
    setConnectionError(false)
    try {
      const res = await fetch(`/api/v1/brands/${brandId}/social-connections`)
      const json: unknown = await res.json()
      if (res.ok && !isApiError(json)) {
        setConnection((json as { data: ConnectionStatus }).data)
      } else {
        setConnectionError(true)
      }
    } catch {
      setConnectionError(true)
    } finally {
      setCheckingConnection(false)
    }
  }, [brandId])

  useEffect(() => {
    checkConnection()
  }, [checkConnection])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Competitor analysis</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Looks up real follower counts, posting frequency, and engagement rates for public Instagram Business/
          Creator accounts you don&apos;t own.
        </p>

        {checkingConnection && (
          <p className="text-sm text-muted-foreground">Checking your connection…</p>
        )}

        {!checkingConnection && connectionError && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-1.5">
            <p className="text-sm text-amber-900">Couldn&apos;t check your connection status.</p>
            <button
              type="button"
              onClick={checkConnection}
              className="text-xs font-semibold text-amber-700 underline underline-offset-2 hover:text-amber-900"
            >
              Try again
            </button>
          </div>
        )}

        {!checkingConnection && !connectionError && connection && !connection.instagram_connected && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-1.5">
            <p className="text-sm text-amber-900">Connect Instagram first to run competitor analysis.</p>
            <Link
              href={`/brands/${brandId}`}
              className="text-xs font-semibold text-amber-700 underline underline-offset-2 hover:text-amber-900"
            >
              Go to brand settings →
            </Link>
          </div>
        )}

        {/* Instagram's Business Discovery API — the only way to look up an
            account you don't own — requires a direct Meta access token.
            Zernio (the unified API this app's Instagram connection now goes
            through) doesn't expose an equivalent: confirmed against its full
            API reference, no endpoint exists for looking up accounts outside
            the connected profile. This isn't a "not connected" state — it's
            genuinely unavailable regardless of connection status, so it gets
            its own message rather than reusing the connect prompt above. */}
        {!checkingConnection && !connectionError && connection?.instagram_connected && (
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-sm font-medium">Competitor analysis isn&apos;t currently available.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              This feature depended on a Meta-specific capability our current Instagram integration doesn&apos;t
              support. We&apos;re looking into alternatives.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
