"use client"

import { useState, useEffect, useLayoutEffect, useRef } from "react"
import { useParams } from "next/navigation"
import { Search, Plus, Loader2, Users, Video, Camera, Wand2, Sparkles, AlertCircle, Trash2, TrendingUp, Star, UserPlus } from "lucide-react"
import { FaLinkedin } from "react-icons/fa6"
import {
  useInfluencers,
  useDiscoverInfluencer,
  useAutoDiscoverInfluencers,
  useClearInfluencers,
} from "@/hooks/useInfluencers"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import Link from "next/link"
import type { InfluencerRow } from "@/types/database"

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Single source of truth for follower-count tiers, shared by the badge
// (getTier) and the filter tabs (FILTER_TABS/filterInfluencers) below so
// they can never drift out of sync. Boundaries reflect realistic budget
// tiers for a small Indian D2C brand, not generic global influencer-
// marketing bands -- most affordable collabs for this app's users happen
// well under 20k followers, so that range gets its own "Micro" tier
// instead of being lumped in with 100k-follower accounts.
type TierKey = "nano" | "micro" | "mid" | "macro" | "mega"

const TIER_BANDS: { key: TierKey; label: string; color: string; dot: string; min: number; max: number }[] = [
  { key: "nano", label: "Nano", color: "bg-gray-100 text-gray-600", dot: "bg-gray-400", min: 0, max: 5_000 },
  { key: "micro", label: "Micro", color: "bg-blue-100 text-blue-700", dot: "bg-blue-500", min: 5_000, max: 20_000 },
  { key: "mid", label: "Mid", color: "bg-teal-100 text-teal-700", dot: "bg-teal-500", min: 20_000, max: 100_000 },
  { key: "macro", label: "Macro", color: "bg-purple-100 text-purple-700", dot: "bg-purple-500", min: 100_000, max: 1_000_000 },
  { key: "mega", label: "Mega", color: "bg-orange-100 text-orange-700", dot: "bg-orange-500", min: 1_000_000, max: Infinity },
]

function getTier(followerCount: number | null): { label: string; color: string; dot: string } {
  if (!followerCount) return { label: "Unknown", color: "bg-gray-100 text-gray-500", dot: "bg-gray-300" }
  const band = TIER_BANDS.find((b) => followerCount >= b.min && followerCount < b.max) ?? TIER_BANDS[TIER_BANDS.length - 1]
  return { label: band.label, color: band.color, dot: band.dot }
}

// Normalize: old scores stored as 0-100, new scores as 1-10
function normalizeScore(score: number | null): number | null {
  if (score === null) return null
  return score > 10 ? Math.round(score / 10) : score
}

function FitScoreBadge({ score }: { score: number | null }) {
  const normalized = normalizeScore(score)
  if (normalized === null) return null
  const { label, color } =
    normalized >= 8
      ? { label: "Excellent fit", color: "bg-green-100 text-green-700 border-green-200" }
      : normalized >= 5
      ? { label: "Good fit", color: "bg-yellow-100 text-yellow-700 border-yellow-200" }
      : { label: "Possible fit", color: "bg-gray-100 text-gray-500 border-gray-200" }
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${color}`}>
      <span>{normalized}/10</span>
      <span className="font-normal opacity-75">· {label}</span>
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
  if (platform === "instagram") return <Camera className="h-3 w-3" />
  if (platform === "youtube") return <Video className="h-3 w-3" />
  if (platform === "linkedin") return <FaLinkedin className="h-3 w-3" style={{ color: "#0A66C2" }} />
  return <span className="text-[10px] font-medium uppercase">{platform.slice(0, 2)}</span>
}

// Instagram's real brand gradient -- reused for the platform badge and the
// small avatar-corner platform dot on each card, so "this came from
// Instagram" reads as a recognizable mark rather than a generic camera icon.
const INSTAGRAM_GRADIENT = "linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)"

// Instagram is the only platform real discovery covers today (Apify
// hashtag scraping, lib/ai/apify-hashtag-scraper.ts) -- both discovery
// forms used to offer a platform <select>, but with a single option left
// in it a dropdown just adds a pointless click. This replaces it with a
// static, Instagram-branded badge instead, which also makes clear this
// isn't a live, changeable choice.
function InstagramPlatformBadge() {
  return (
    <div
      className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white shadow-sm"
      style={{ background: INSTAGRAM_GRADIENT }}
    >
      <Camera className="h-4 w-4" />
      Instagram
    </div>
  )
}

function formatFollowers(count: number | null): string {
  if (!count) return "–"
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`
  return count.toString()
}

// ─── Sliding tabs (shared by the mode toggle + tier filter row) ───────────────

// One reusable sliding-indicator control for every tab-like choice on this
// page -- the mode toggle (Find Influencers / Find Customers) and the tier
// filter row both used to be flat color-swap buttons with no sense of
// motion or weight behind the active choice. Measures the active button's
// own box (not a hardcoded width) so labels of any length still get a
// pixel-accurate pill under them, and re-measures on resize since this
// page's tab labels wrap on narrow viewports.
function SlidingTabs<T extends string>({
  tabs,
  active,
  onChange,
  variant = "filter",
}: {
  tabs: { id: T; label: string }[]
  active: T
  onChange: (id: T) => void
  /** "filter" = compact muted/foreground tabs (the tier filter row).
   * "segmented" = a boxed track with a solid pill (the mode toggle). */
  variant?: "filter" | "segmented"
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const btnRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const [indicator, setIndicator] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  useLayoutEffect(() => {
    function measure() {
      const btn = btnRefs.current.get(active)
      const container = containerRef.current
      if (!btn || !container) return
      const c = container.getBoundingClientRect()
      const b = btn.getBoundingClientRect()
      setIndicator({ left: b.left - c.left, top: b.top - c.top, width: b.width, height: b.height })
    }
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [active, tabs.length])

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-wrap gap-1 ${variant === "segmented" ? "rounded-full border bg-muted/60 p-1" : ""}`}
    >
      {indicator && (
        <div
          className={`absolute rounded-full bg-violet-600 shadow-sm transition-[left,top,width,height] duration-200 ease-out ${
            variant === "segmented" ? "" : "shadow-violet-200"
          }`}
          style={{ left: indicator.left, top: indicator.top, width: indicator.width, height: indicator.height }}
        />
      )}
      {tabs.map((tab) => (
        <button
          key={tab.id}
          ref={(el) => {
            if (el) btnRefs.current.set(tab.id, el)
          }}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`relative z-10 rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${
            active === tab.id ? "text-white" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

// ─── Auto-discover form ───────────────────────────────────────────────────────

type DiscoveryMode = "influencer_partner" | "prospect_customer"

const MODE_META: Record<DiscoveryMode, { label: string; accentBar: string; chip: string; chipIcon: typeof Star }> = {
  influencer_partner: { label: "Creator", accentBar: "bg-gradient-to-r from-violet-500 to-fuchsia-500", chip: "bg-violet-50 text-violet-700", chipIcon: Star },
  prospect_customer: { label: "Prospect", accentBar: "bg-gradient-to-r from-emerald-500 to-teal-500", chip: "bg-emerald-50 text-emerald-700", chipIcon: UserPlus },
}

const DISCOVERY_MODE_TABS: { id: DiscoveryMode; label: string }[] = [
  { id: "influencer_partner", label: "Find Influencers" },
  { id: "prospect_customer", label: "Find Customers" },
]

// Inline "Are you sure? Yes, clear it / Cancel" confirmation, same pattern
// as components/shared/DeleteConfirmButton.tsx -- not reused directly
// since this needs its own copy ("clear your list" is a bulk action on a
// whole discovery mode, not one row) rather than that component's fixed
// "Delete" wording.
function ClearListButton({ brandId, discoveryType }: { brandId: string; discoveryType: DiscoveryMode }) {
  const [confirming, setConfirming] = useState(false)
  const clearInfluencers = useClearInfluencers(brandId)

  async function handleConfirm() {
    try {
      await clearInfluencers.mutateAsync(discoveryType)
      setConfirming(false)
    } catch {
      // error surfaced below via clearInfluencers.error; stay in the
      // confirming state so retrying doesn't require re-clicking "Clear list"
    }
  }

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-2 duration-150 animate-in fade-in">
        <span className="text-xs text-muted-foreground">
          Clear your whole {discoveryType === "prospect_customer" ? "customers" : "influencers"} list?
        </span>
        <Button variant="destructive" size="sm" disabled={clearInfluencers.isPending} onClick={handleConfirm}>
          {clearInfluencers.isPending ? "Clearing…" : "Yes, clear it"}
        </Button>
        <Button variant="ghost" size="sm" disabled={clearInfluencers.isPending} onClick={() => setConfirming(false)}>
          Cancel
        </Button>
        {clearInfluencers.error && (
          <p className="w-full text-xs text-destructive">
            {clearInfluencers.error instanceof Error ? clearInfluencers.error.message : "Failed to clear list."}
          </p>
        )}
      </div>
    )
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => setConfirming(true)}
      className="gap-1.5 text-muted-foreground hover:text-destructive"
    >
      <Trash2 className="h-3.5 w-3.5" />
      Clear list &amp; search again
    </Button>
  )
}

function AutoDiscoverForm({
  brandId,
  discoveryType,
  onDiscoveryTypeChange,
  hasExistingList,
}: {
  brandId: string
  discoveryType: DiscoveryMode
  onDiscoveryTypeChange: (v: DiscoveryMode) => void
  hasExistingList: boolean
}) {
  const [count, setCount] = useState(25)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const autoDiscover = useAutoDiscoverInfluencers(brandId)

  async function handleAutoDiscover() {
    setSuccessMsg(null)
    const result = await autoDiscover.mutateAsync({ platform: "instagram", count, discoveryType })
    setSuccessMsg(
      `Found ${result.count} influencer${result.count !== 1 ? "s" : ""} and added them to your list.`,
    )
  }

  return (
    <Card className="relative mb-4 overflow-hidden rounded-xl border-violet-200/70 bg-gradient-to-br from-violet-50 via-white to-fuchsia-50/40 shadow-sm">
      {/* Decorative watermark -- purely visual, gives the flagship action on
          this page a "designed" backdrop instead of a bare white card. */}
      <Wand2 className="pointer-events-none absolute -right-4 -top-4 h-28 w-28 rotate-12 text-violet-600/[0.06]" />
      <CardHeader className="relative pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600 text-white shadow-sm">
            <Wand2 className="h-4 w-4" />
          </span>
          Auto-discover influencers
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          We&apos;ll find relevant creators in your niche automatically
        </p>
      </CardHeader>
      <CardContent className="relative space-y-3">
        <SlidingTabs tabs={DISCOVERY_MODE_TABS} active={discoveryType} onChange={onDiscoveryTypeChange} variant="segmented" />
        <div className="flex flex-wrap items-center gap-2">
          <InstagramPlatformBadge />
          <select
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            disabled={autoDiscover.isPending}
            className="h-[42px] rounded-lg border bg-background px-3 text-sm shadow-sm transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value={10}>10 influencers</option>
            <option value={25}>25 influencers</option>
            <option value={50}>50 influencers</option>
            <option value={100}>100 influencers</option>
          </select>
          <Button
            onClick={handleAutoDiscover}
            disabled={autoDiscover.isPending}
            className="gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-600 shadow-sm shadow-violet-200 transition-all hover:from-violet-700 hover:to-fuchsia-700 hover:shadow-md"
          >
            {autoDiscover.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching…
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4" />
                Find influencers for me →
              </>
            )}
          </Button>
        </div>
        {autoDiscover.isPending && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground duration-150 animate-in fade-in">
            <Loader2 className="h-3 w-3 animate-spin" />
            Searching for creators on Instagram… This takes 30-60 seconds
          </p>
        )}
        {successMsg && (
          <p className="text-xs font-medium text-green-700 duration-200 animate-in fade-in slide-in-from-top-1">{successMsg}</p>
        )}
        {autoDiscover.error && (
          <p className="text-xs text-destructive duration-200 animate-in fade-in slide-in-from-top-1">
            {autoDiscover.error instanceof Error
              ? autoDiscover.error.message
              : "Auto-discovery failed."}
          </p>
        )}
        {hasExistingList && !autoDiscover.isPending && (
          <ClearListButton brandId={brandId} discoveryType={discoveryType} />
        )}
      </CardContent>
    </Card>
  )
}

// ─── Manual discover form ─────────────────────────────────────────────────────

function DiscoverForm({ brandId, discoveryType }: { brandId: string; discoveryType: DiscoveryMode }) {
  const [handle, setHandle] = useState("")
  const discover = useDiscoverInfluencer(brandId)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!handle.trim()) return
    await discover.mutateAsync({ handle: handle.trim(), platform: "instagram", discoveryType })
    setHandle("")
  }

  return (
    <Card className="mb-6 rounded-xl shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
          <Search className="h-4 w-4" />
          Or discover manually
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <InstagramPlatformBadge />
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Handle (without @)"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              className="h-[42px] pl-9 shadow-sm"
            />
          </div>
          <Button type="submit" disabled={discover.isPending || !handle.trim()} className="h-[42px] gap-1.5">
            {discover.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Discover
          </Button>
        </form>
        {/* Mirrors AutoDiscoverForm's error rendering exactly -- this form's
            discover.mutateAsync failure (the same plan-gate 403, or anything
            else) previously had no .catch() and nothing here ever read
            discover.error, so the input just sat there with no feedback at
            all on failure. */}
        {discover.error && (
          <p className="mt-2 text-xs text-destructive duration-200 animate-in fade-in slide-in-from-top-1">
            {discover.error instanceof Error
              ? discover.error.message
              : "Discovery failed."}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Stats strip ──────────────────────────────────────────────────────────────

// Compact "here's what you've built so far" summary above the list --
// scoped to whichever mode is active (matches what's actually on screen
// below it) rather than a global total that wouldn't line up with the
// tier breakdown shown alongside it.
function StatsStrip({ scoped, discoveryType }: { scoped: InfluencerRow[]; discoveryType: DiscoveryMode }) {
  if (scoped.length === 0) return null

  const excellentCount = scoped.filter((i) => (normalizeScore(i.fit_score) ?? 0) >= 8).length
  const avgFollowers =
    scoped.length > 0
      ? Math.round(scoped.reduce((sum, i) => sum + (i.follower_count ?? 0), 0) / scoped.length)
      : null

  const meta = MODE_META[discoveryType]
  const ModeIcon = meta.chipIcon

  const stats: { label: string; value: string; icon: typeof Users; tint: string }[] = [
    { label: discoveryType === "prospect_customer" ? "Prospects found" : "Creators found", value: String(scoped.length), icon: ModeIcon, tint: "text-violet-600" },
    { label: "Excellent fit", value: String(excellentCount), icon: Sparkles, tint: "text-green-600" },
    { label: "Avg. followers", value: formatFollowers(avgFollowers), icon: TrendingUp, tint: "text-blue-600" },
  ]

  return (
    <div className="mb-4 grid grid-cols-3 gap-3 duration-300 animate-in fade-in slide-in-from-top-1">
      {stats.map(({ label, value, icon: Icon, tint }) => (
        <Card key={label} className="rounded-xl border-none bg-muted/40 shadow-none">
          <CardContent className="flex items-center gap-3 p-3.5">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background shadow-sm ${tint}`}>
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-lg font-bold leading-none tracking-tight">{value}</p>
              <p className="mt-1 truncate text-[11px] text-muted-foreground">{label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ─── Influencer card ──────────────────────────────────────────────────────────

function InfluencerCard({ influencer, brandId, discoveryType }: { influencer: InfluencerRow; brandId: string; discoveryType: DiscoveryMode }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const niche = (influencer as any).niche as string | null | undefined
  const { dot: tierDot } = getTier(influencer.follower_count)
  const meta = MODE_META[discoveryType]

  return (
    <Link href={`/brands/${brandId}/influencers/${influencer.id}`} className="block">
      <Card className="group h-full overflow-hidden rounded-xl border-border/70 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-violet-200 hover:shadow-lg hover:shadow-violet-100">
        {/* Mode accent -- the same list only ever shows one discoveryType at
            a time, but this keeps "creator vs. prospect" legible at a
            glance while scrolling, and reinforces which search produced
            this card. */}
        <div className={`h-1 w-full ${meta.accentBar}`} />
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="relative shrink-0">
                {influencer.avatar_url ? (
                  // eslint-disable-next-line @next/next-app/no-img-element
                  <img
                    src={influencer.avatar_url}
                    alt={influencer.handle}
                    className="h-11 w-11 rounded-full object-cover ring-2 ring-violet-100 ring-offset-2 ring-offset-background"
                  />
                ) : (
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary ring-2 ring-violet-100 ring-offset-2 ring-offset-background">
                    {influencer.handle.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <span
                  className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-white shadow"
                  style={{ background: INSTAGRAM_GRADIENT }}
                >
                  <PlatformIcon platform={influencer.platform} />
                </span>
                <span className={`absolute -left-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card ${tierDot}`} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">@{influencer.handle}</div>
                {influencer.full_name && (
                  <p className="truncate text-xs text-muted-foreground">{influencer.full_name}</p>
                )}
              </div>
            </div>
            <FitScoreBadge score={influencer.fit_score} />
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          {influencer.bio && (
            <p className="line-clamp-2 text-xs text-muted-foreground">{influencer.bio}</p>
          )}
          {influencer.fit_reasoning && (
            <p className="line-clamp-2 rounded-md bg-muted/50 px-2 py-1.5 text-xs text-foreground/80">
              <span className="font-medium text-violet-700">Why this could work: </span>
              {influencer.fit_reasoning}
            </p>
          )}
          <div className="flex items-center justify-between gap-2 pt-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <TierBadge followerCount={influencer.follower_count} />
              {niche && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">
                  {niche}
                </span>
              )}
            </div>
            <span className="shrink-0 text-xs font-medium text-muted-foreground">
              {formatFollowers(influencer.follower_count)}
            </span>
          </div>
        </CardContent>
        {/* Only visible on hover -- a lightweight affordance that this card
            is clickable without adding a permanent, always-on footer row
            every card would otherwise carry. */}
        <div className="flex items-center justify-end gap-1 border-t px-4 py-1.5 text-[11px] font-medium text-violet-600 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          View profile →
        </div>
      </Card>
    </Link>
  )
}

// ─── Filters + sort ───────────────────────────────────────────────────────────

// Skips a "mega" filter tab -- an unlikely tier for this app's actual
// users, so it's not worth surfacing as a filter even though the badge
// (getTier, via TIER_BANDS above) still labels a 1M+ card correctly.
type FilterTab = "all" | "excellent_fit" | "good_fit" | "nano" | "micro" | "mid" | "macro"
type SortKey = "fit_score" | "followers" | "recent"

// Derived straight from a band's own min/max (via formatFollowers, same
// helper every other follower count on this page uses) rather than
// hardcoded strings, so a tab's numbers can never drift out of sync with
// the actual filter boundary the way the badge/filter mismatch this
// mirrors was already fixed to prevent. The lowest band reads as
// open-below ("<5K"); the last VISIBLE band (macro -- mega itself is
// excluded from the tabs below) reads as open-above ("100K+") since
// there's no next visible tier to bound it against.
function formatTierRange(band: { min: number; max: number }, isLastVisible: boolean): string {
  if (band.min === 0) return `<${formatFollowers(band.max)}`
  if (isLastVisible) return `${formatFollowers(band.min)}+`
  return `${formatFollowers(band.min)}-${formatFollowers(band.max)}`
}

const VISIBLE_TIER_BANDS = TIER_BANDS.filter((b): b is typeof b & { key: Exclude<TierKey, "mega"> } => b.key !== "mega")

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "excellent_fit", label: "Excellent fit (8+)" },
  { id: "good_fit", label: "Good fit (5–7)" },
  ...VISIBLE_TIER_BANDS.map((b, i) => ({
    id: b.key,
    label: `${b.label} (${formatTierRange(b, i === VISIBLE_TIER_BANDS.length - 1)})`,
  })),
]

function filterInfluencers(influencers: InfluencerRow[], filter: FilterTab): InfluencerRow[] {
  switch (filter) {
    case "excellent_fit":
      return influencers.filter((i) => normalizeScore(i.fit_score) !== null && (normalizeScore(i.fit_score) ?? 0) >= 8)
    case "good_fit":
      return influencers.filter((i) => {
        const s = normalizeScore(i.fit_score)
        return s !== null && s >= 5 && s < 8
      })
    case "all":
      return influencers
    default: {
      const band = TIER_BANDS.find((b) => b.key === filter)!
      return influencers.filter(
        (i) => i.follower_count !== null && i.follower_count >= band.min && i.follower_count < band.max,
      )
    }
  }
}

function sortInfluencers(influencers: InfluencerRow[], sort: SortKey): InfluencerRow[] {
  return [...influencers].sort((a, b) => {
    if (sort === "fit_score") return (normalizeScore(b.fit_score) ?? 0) - (normalizeScore(a.fit_score) ?? 0)
    if (sort === "followers") return (b.follower_count ?? 0) - (a.follower_count ?? 0)
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

// ─── Loading / empty states ────────────────────────────────────────────────────

function InfluencersPageSkeleton() {
  return (
    <div className="animate-pulse px-4 py-6 md:p-8">
      <div className="mb-8 h-8 w-40 rounded-lg bg-muted" />
      <div className="mb-4 grid grid-cols-3 gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-[62px] rounded-xl bg-muted/60" />
        ))}
      </div>
      <div className="mb-4 h-44 rounded-xl bg-muted" />
      <div className="mb-6 h-24 rounded-xl bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="space-y-3 rounded-xl border bg-card p-5">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 shrink-0 rounded-full bg-muted" />
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

function EmptyState({ filter, discoveryType }: { filter: FilterTab; discoveryType: DiscoveryMode }) {
  const modeLabel = discoveryType === "prospect_customer" ? "prospects" : "influencers"
  return (
    <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 text-center duration-300 animate-in fade-in">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-100 to-fuchsia-100">
        <Users className="h-8 w-8 text-violet-500" />
      </div>
      <p className="text-sm font-semibold">
        {filter === "all" ? `No ${modeLabel} yet` : `No ${filter.replace("_", " ")} results`}
      </p>
      <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
        {filter === "all"
          ? `Auto-discover will scan real Instagram accounts for you, or enter a handle you already know.`
          : "Try a different tier or fit filter -- your full list is still there."}
      </p>
      {filter === "all" && (
        <button
          type="button"
          onClick={() => document.getElementById("discover-section")?.scrollIntoView({ behavior: "smooth", block: "center" })}
          className="mt-4 text-xs font-semibold text-violet-600 transition-colors hover:text-violet-700"
        >
          ↑ Jump to auto-discover
        </button>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InfluencersPage() {
  const params = useParams()
  const brandId = params.brandId as string
  const { data: influencers, isLoading, error } = useInfluencers(brandId)
  const [filter, setFilter] = useState<FilterTab>("all")
  const [sort, setSort] = useState<SortKey>("fit_score")
  const [discoveryType, setDiscoveryType] = useState<DiscoveryMode>("influencer_partner")
  const autoDiscover = useAutoDiscoverInfluencers(brandId)
  const hasAutoTriggered = useRef(false)
  const [autoDiscoverMsg, setAutoDiscoverMsg] = useState<string | null>(null)
  const [autoDiscoverError, setAutoDiscoverError] = useState<string | null>(null)

  // Auto-trigger discovery the first time the page loads with zero saved
  // influencers. Kept to a smaller count than the manual "Discover" button
  // (10 vs. that button's default of 25) since this fires silently on page
  // load -- a much lower risk tolerance than something the user explicitly
  // clicked. sessionStorage remembers a failure per brand so a doomed
  // discovery (timeout, scraper block, etc.) doesn't silently re-run and
  // re-burn real scraping/AI cost on every fresh visit within the session;
  // the manual button stays available either way.
  useEffect(() => {
    const failedKey = `influencers-auto-discover-failed-${brandId}`
    if (
      !isLoading &&
      influencers !== undefined &&
      influencers.length === 0 &&
      !hasAutoTriggered.current &&
      sessionStorage.getItem(failedKey) === null
    ) {
      hasAutoTriggered.current = true
      autoDiscover
        .mutateAsync({ platform: "instagram", count: 10, discoveryType: "influencer_partner" })
        .then((result) => {
          setAutoDiscoverMsg(
            `Found ${result.count} influencer${result.count !== 1 ? "s" : ""} who could be a great fit for your brand.`,
          )
        })
        .catch(() => {
          sessionStorage.setItem(failedKey, "1")
          setAutoDiscoverError("Couldn't automatically find creators for you — try Discover below.")
        })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, influencers, brandId])

  if (isLoading) {
    return <InfluencersPageSkeleton />
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 p-8 text-center text-destructive">
        <AlertCircle className="h-8 w-8" />
        <p className="font-medium">Failed to load influencers.</p>
      </div>
    )
  }

  // Scope the list to whichever mode is active before the existing
  // filter/sort pipeline runs — influencer_partner behaves exactly as
  // before (every row already defaults to that discovery_type), while
  // prospect_customer additionally only ever surfaces fit_score >= 9.
  const scoped = (influencers ?? []).filter((i) => {
    const rowType = i.discovery_type ?? "influencer_partner"
    if (rowType !== discoveryType) return false
    if (discoveryType === "prospect_customer") {
      const s = normalizeScore(i.fit_score)
      return s !== null && s >= 9
    }
    return true
  })

  const filtered = filterInfluencers(scoped, filter)
  const sorted = sortInfluencers(filtered, sort)

  return (
    <div className="px-4 py-6 md:p-8">
      <div className="mb-6 flex items-center justify-between">
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

      <StatsStrip scoped={scoped} discoveryType={discoveryType} />

      {/* Auto-discovery in-progress banner (shown when triggered automatically) */}
      {autoDiscover.isPending && (influencers ?? []).length === 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 duration-200 animate-in fade-in">
          <Sparkles className="h-5 w-5 shrink-0 animate-pulse text-violet-600" />
          <div>
            <p className="text-sm font-medium text-violet-900">
              Finding influencers who&apos;d be a great fit for your brand…
            </p>
            <p className="text-xs text-violet-700">
              Scoring each one by niche match, audience, and engagement. This takes 30–60 seconds.
            </p>
          </div>
          <Loader2 className="ml-auto h-4 w-4 shrink-0 animate-spin text-violet-600" />
        </div>
      )}

      {autoDiscoverMsg && (
        <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800 duration-200 animate-in fade-in slide-in-from-top-1">
          {autoDiscoverMsg}
        </div>
      )}

      {autoDiscoverError && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 duration-200 animate-in fade-in slide-in-from-top-1">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {autoDiscoverError}
        </div>
      )}

      <div id="discover-section" className="scroll-mt-6">
        <AutoDiscoverForm
          brandId={brandId}
          discoveryType={discoveryType}
          onDiscoveryTypeChange={setDiscoveryType}
          hasExistingList={scoped.length > 0}
        />

        <DiscoverForm brandId={brandId} discoveryType={discoveryType} />
      </div>

      {influencers && influencers.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <SlidingTabs tabs={FILTER_TABS} active={filter} onChange={setFilter} variant="filter" />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-md border bg-background px-3 py-1.5 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="fit_score">Sort: Fit Score</option>
            <option value="followers">Sort: Followers</option>
            <option value="recent">Sort: Recently Added</option>
          </select>
        </div>
      )}

      {sorted.length === 0 ? (
        <EmptyState filter={filter} discoveryType={discoveryType} />
      ) : (
        <div key={`${filter}-${sort}`} className="grid gap-4 duration-200 animate-in fade-in slide-in-from-bottom-1 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((inf, i) => (
            <div key={inf.id} className="duration-300 animate-in fade-in slide-in-from-bottom-1" style={{ animationDelay: `${Math.min(i * 25, 250)}ms`, animationFillMode: "backwards" }}>
              <InfluencerCard influencer={inf} brandId={brandId} discoveryType={discoveryType} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
