"use client"

import { useState } from "react"
import { useParams } from "next/navigation"
import { Search, Plus, Loader2, Users, Video, Camera } from "lucide-react"
import { useInfluencers, useDiscoverInfluencer, useDeleteInfluencer } from "@/hooks/useInfluencers"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import Link from "next/link"
import type { InfluencerRow } from "@/types/database"

function FitScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-muted-foreground">Not scored</span>
  const color = score >= 70
    ? "bg-green-100 text-green-700"
    : score >= 40
    ? "bg-yellow-100 text-yellow-700"
    : "bg-red-100 text-red-700"
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>{score}/100</span>
}

function PlatformIcon({ platform }: { platform: string }) {
  if (platform === "instagram") return <Camera className="h-3.5 w-3.5" />
  if (platform === "youtube") return <Video className="h-3.5 w-3.5" />
  return <span className="text-xs font-medium uppercase">{platform.slice(0, 2)}</span>
}

function formatFollowers(count: number | null): string {
  if (!count) return "—"
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`
  return count.toString()
}

function DiscoverForm({ brandId }: { brandId: string }) {
  const [handle, setHandle] = useState("")
  const [platform, setPlatform] = useState<"instagram" | "tiktok" | "youtube">("instagram")
  const discover = useDiscoverInfluencer(brandId)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!handle.trim()) return
    await discover.mutateAsync({ handle: handle.trim(), platform })
    setHandle("")
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <select
        value={platform}
        onChange={e => setPlatform(e.target.value as "instagram" | "tiktok" | "youtube")}
        className="rounded-md border bg-background px-3 py-2 text-sm"
      >
        <option value="instagram">Instagram</option>
        <option value="tiktok">TikTok</option>
        <option value="youtube">YouTube</option>
      </select>
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Handle (without @)"
          value={handle}
          onChange={e => setHandle(e.target.value)}
          className="pl-9"
        />
      </div>
      <Button type="submit" disabled={discover.isPending || !handle.trim()}>
        {discover.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Discover
      </Button>
    </form>
  )
}

function InfluencerCard({ influencer, brandId }: { influencer: InfluencerRow; brandId: string }) {
  return (
    <Link href={`/brands/${brandId}/influencers/${influencer.id}`} className="block">
      <Card className="h-full transition-all hover:shadow-md hover:-translate-y-0.5 cursor-pointer">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              {influencer.avatar_url ? (
                // eslint-disable-next-line @next/next-app/no-img-element
                <img src={influencer.avatar_url} alt={influencer.handle} className="h-10 w-10 rounded-full object-cover" />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  {influencer.handle.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div>
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <PlatformIcon platform={influencer.platform} />
                  @{influencer.handle}
                </div>
                {influencer.full_name && <p className="text-xs text-muted-foreground">{influencer.full_name}</p>}
              </div>
            </div>
            <FitScoreBadge score={influencer.fit_score} />
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {influencer.bio && (
            <p className="mb-2 line-clamp-2 text-xs text-muted-foreground">{influencer.bio}</p>
          )}
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{formatFollowers(influencer.follower_count)} followers</span>
            <span className={`rounded-full px-2 py-0.5 text-xs capitalize ${
              influencer.status === "partnered" ? "bg-green-100 text-green-700" :
              influencer.status === "contacted" ? "bg-blue-100 text-blue-700" :
              influencer.status === "rejected" ? "bg-red-100 text-red-700" :
              "bg-muted text-muted-foreground"
            }`}>
              {influencer.status}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

export default function InfluencersPage() {
  const params = useParams()
  const brandId = params.brandId as string
  const { data: influencers, isLoading, error } = useInfluencers(brandId)

  if (isLoading) {
    return (
      <div className="px-4 py-6 md:p-8 animate-pulse">
        <div className="mb-8 h-8 w-40 rounded-lg bg-muted" />
        <div className="mb-6 h-16 rounded-lg bg-muted" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="rounded-lg border bg-card p-5 space-y-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-muted shrink-0" />
                <div className="space-y-1.5 flex-1">
                  <div className="h-3.5 w-28 rounded bg-muted" />
                  <div className="h-3 w-20 rounded bg-muted" />
                </div>
              </div>
              <div className="h-3 w-full rounded bg-muted" />
              <div className="h-3 w-2/3 rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8 text-center text-destructive">
        <p>Failed to load influencers.</p>
      </div>
    )
  }

  return (
    <div className="px-4 py-6 md:p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-7 w-7 text-primary" />
            Influencers
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Discover, score, and manage influencer partnerships for your brand.
          </p>
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm">Discover an influencer</CardTitle>
        </CardHeader>
        <CardContent>
          <DiscoverForm brandId={brandId} />
        </CardContent>
      </Card>

      {(!influencers || influencers.length === 0) ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-lg border border-dashed text-center">
          <Users className="h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium">No influencers yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Enter a handle above to discover your first influencer.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {influencers.map(inf => (
            <InfluencerCard key={inf.id} influencer={inf} brandId={brandId} />
          ))}
        </div>
      )}
    </div>
  )
}
