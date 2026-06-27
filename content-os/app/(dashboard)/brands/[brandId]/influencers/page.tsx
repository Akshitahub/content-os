"use client"

import { useState } from "react"
import { useParams } from "next/navigation"
import { Search, Plus, Loader2, Users, Video, Camera, Wand2 } from "lucide-react"
import {
  useInfluencers,
  useDiscoverInfluencer,
  useAutoDiscoverInfluencers,
} from "@/hooks/useInfluencers"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import Link from "next/link"
import type { InfluencerRow } from "@/types/database"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTier(followerCount: number | null): { label: string; color: string } {
  if (!followerCount) return { label: "Unknown", color: "bg-gray-100 text-gray-500" }
  if (followerCount < 10_000) return { label: "Nano", color: "bg-gray-100 text-gray-600" }
  if (followerCount < 100_000) return { label: "Micro", color: "bg-blue-100 text-blue-700" }
  if (followerCount < 1_000_000) return { label: "Macro", color: "bg-purple-100 text-purple-700" }
  return { label: "Mega", color: "bg-orange-100 text-orange-700" }
}

function FitScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-muted-foreground">Not scored</span>
  const color =
    score >= 70
      ? "bg-green-100 text-green-700"
      : score >= 40
      ? "bg-yellow-100 text-yellow-700"
      : "bg-red-100 text-red-700"
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {score}/100
    </span>
  )
}

function TierBadge({ followerCount }: { followerCount: number | null }) {
  const { label, color } = getTier(followerCount)
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {label}
    </span>
  )
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

// ─── Auto-discover form ───────────────────────────────────────────────────────

function AutoDiscoverForm({ brandId }: { brandId: string }) {
  const [platform, setPlatform] = useState<"instagram" | "tiktok" | "youtube">("instagram")
  const [count, setCount] = useState(10)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const autoDiscover = useAutoDiscoverInfluencers(brandId)

  async function handleAutoDiscover() {
    setSuccessMsg(null)
    const result = await autoDiscover.mutateAsync({ platform, count })
    setSuccessMsg(
      `Found ${result.count} influencer${result.count !== 1 ? "s" : ""} and added them to your list.`,
    )
  }

  return (
    <Card className="mb-4 border-violet-200 bg-violet-50/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Wand2 className="h-4 w-4 text-violet-600" />
          Auto-discover influencers
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          We&apos;ll find relevant creators in your niche automatically
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as "instagram" | "tiktok" | "youtube")}
            disabled={autoDiscover.isPending}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="instagram">Instagram</option>
            <option value="tiktok">TikTok</option>
            <option value="youtube">YouTube</option>
          </select>
          <select
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            disabled={autoDiscover.isPending}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value={5}>5 influencers</option>
            <option value={10}>10 influencers</option>
            <option value={20}>20 influencers</option>
          </select>
          <Button
            onClick={handleAutoDiscover}
            disabled={autoDiscover.isPending}
            className="bg-violet-600 hover:bg-violet-700"
          >
            {autoDiscover.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Searching…
              </>
            ) : (
              <>
                <Wand2 className="mr-2 h-4 w-4" />
                Find influencers for me →
              </>
            )}
          </Button>
        </div>
        {autoDiscover.isPending && (
          <p className="animate-pulse text-xs text-muted-foreground">
            Searching for creators on {platform}… This takes 30-60 seconds
          </p>
        )}
        {successMsg && <p className="text-xs font-medium text-green-700">{successMsg}</p>}
        {autoDiscover.error && (
          <p className="text-xs text-destructive">
            {autoDiscover.error instanceof Error
              ? autoDiscover.error.message
              : "Auto-discovery failed."}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Manual discover form ─────────────────────────────────────────────────────

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
        onChange={(e) => setPlatform(e.target.value as "instagram" | "tiktok" | "youtube")}
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
          onChange={(e) => setHandle(e.target.value)}
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

// ─── Influencer card ──────────────────────────────────────────────────────────

function InfluencerCard({ influencer, brandId }: { influencer: InfluencerRow; brandId: string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const niche = (influencer as any).niche as string | null | undefined
  return (
    <Link href={`/brands/${brandId}/influencers/${influencer.id}`} className="block">
      <Card className="h-full cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              {influencer.avatar_url ? (
                // eslint-disable-next-line @next/next-app/no-img-element
                <img
                  src={influencer.avatar_url}
                  alt={influencer.handle}
                  className="h-10 w-10 rounded-full object-cover"
                />
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
                {influencer.full_name && (
                  <p className="text-xs text-muted-foreground">{influencer.full_name}</p>
                )}
              </div>
            </div>
            <FitScoreBadge score={influencer.fit_score} />
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {influencer.bio && (
            <p className="mb-2 line-clamp-2 text-xs text-muted-foreground">{influencer.bio}</p>
          )}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <TierBadge followerCount={influencer.follower_count} />
              {niche && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">
                  {niche}
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              {formatFollowers(influencer.follower_count)}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

// ─── Filters + sort ───────────────────────────────────────────────────────────

type FilterTab = "all" | "strong_fit" | "micro" | "macro"
type SortKey = "fit_score" | "followers" | "recent"

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "strong_fit", label: "Strong Fit" },
  { id: "micro", label: "Micro" },
  { id: "macro", label: "Macro" },
]

function filterInfluencers(influencers: InfluencerRow[], filter: FilterTab): InfluencerRow[] {
  switch (filter) {
    case "strong_fit":
      return influencers.filter((i) => (i.fit_score ?? 0) >= 70)
    case "micro":
      return influencers.filter(
        (i) =>
          i.follower_count !== null && i.follower_count >= 10_000 && i.follower_count < 100_000,
      )
    case "macro":
      return influencers.filter(
        (i) =>
          i.follower_count !== null &&
          i.follower_count >= 100_000 &&
          i.follower_count < 1_000_000,
      )
    default:
      return influencers
  }
}

function sortInfluencers(influencers: InfluencerRow[], sort: SortKey): InfluencerRow[] {
  return [...influencers].sort((a, b) => {
    if (sort === "fit_score") return (b.fit_score ?? 0) - (a.fit_score ?? 0)
    if (sort === "followers") return (b.follower_count ?? 0) - (a.follower_count ?? 0)
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InfluencersPage() {
  const params = useParams()
  const brandId = params.brandId as string
  const { data: influencers, isLoading, error } = useInfluencers(brandId)
  const [filter, setFilter] = useState<FilterTab>("all")
  const [sort, setSort] = useState<SortKey>("fit_score")

  if (isLoading) {
    return (
      <div className="animate-pulse px-4 py-6 md:p-8">
        <div className="mb-8 h-8 w-40 rounded-lg bg-muted" />
        <div className="mb-4 h-36 rounded-lg bg-muted" />
        <div className="mb-6 h-16 rounded-lg bg-muted" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="space-y-3 rounded-lg border bg-card p-5">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 shrink-0 rounded-full bg-muted" />
                <div className="flex-1 space-y-1.5">
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

  const filtered = filterInfluencers(influencers ?? [], filter)
  const sorted = sortInfluencers(filtered, sort)

  return (
    <div className="px-4 py-6 md:p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <Users className="h-7 w-7 text-primary" />
            Influencers
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Discover, score, and manage influencer partnerships for your brand.
          </p>
        </div>
      </div>

      <AutoDiscoverForm brandId={brandId} />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">Or discover manually</CardTitle>
        </CardHeader>
        <CardContent>
          <DiscoverForm brandId={brandId} />
        </CardContent>
      </Card>

      {influencers && influencers.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  filter === tab.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-md border bg-background px-3 py-1.5 text-xs"
          >
            <option value="fit_score">Sort: Fit Score</option>
            <option value="followers">Sort: Followers</option>
            <option value="recent">Sort: Recently Added</option>
          </select>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-lg border border-dashed text-center">
          <Users className="mb-3 h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm font-medium">
            {filter === "all" ? "No influencers yet" : `No ${filter.replace("_", " ")} influencers`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {filter === "all"
              ? "Use auto-discover or enter a handle above."
              : "Try a different filter."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((inf) => (
            <InfluencerCard key={inf.id} influencer={inf} brandId={brandId} />
          ))}
        </div>
      )}
    </div>
  )
}
