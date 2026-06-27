"use client"

import { useState } from "react"
import { useParams } from "next/navigation"
import { Loader2, ArrowLeft, Camera, Video, Users } from "lucide-react"
import Link from "next/link"
import {
  useInfluencer,
  useUpdateInfluencer,
  useOutreachMessages,
  useGenerateOutreach,
  usePartnerships,
  useGenerateBrief,
} from "@/hooks/useInfluencers"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { InfluencerStatus, OutreachChannel, PartnershipStatus } from "@/types/app"
import type { OutreachMessageRow, InfluencerPartnershipRow } from "@/types/database"

type Tab = "overview" | "outreach" | "brief" | "performance"

function FitScoreBadge({ score }: { score: number | null }) {
  if (score === null) return null
  const color = score >= 70
    ? "bg-green-100 text-green-700"
    : score >= 40
    ? "bg-yellow-100 text-yellow-700"
    : "bg-red-100 text-red-700"
  return <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${color}`}>{score}/100 fit score</span>
}

function PlatformIcon({ platform }: { platform: string }) {
  if (platform === "instagram") return <Camera className="h-4 w-4" />
  if (platform === "youtube") return <Video className="h-4 w-4" />
  return <Users className="h-4 w-4" />
}

function formatFollowers(count: number | null): string {
  if (!count) return "—"
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`
  return count.toString()
}

const STATUS_OPTIONS: InfluencerStatus[] = [
  "discovered", "contacted", "replied", "negotiating", "partnered", "rejected", "completed"
]

// ─── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab({ brandId, influencerId }: { brandId: string; influencerId: string }) {
  const { data: influencer } = useInfluencer(brandId, influencerId)
  const update = useUpdateInfluencer(brandId, influencerId)
  const [notes, setNotes] = useState(influencer?.notes ?? "")
  const [status, setStatus] = useState<InfluencerStatus>((influencer?.status as InfluencerStatus) ?? "discovered")

  if (!influencer) return null

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-sm">Fit Analysis</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <FitScoreBadge score={influencer.fit_score} />
          {influencer.fit_reasoning && (
            <p className="text-sm text-muted-foreground leading-relaxed">{influencer.fit_reasoning}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Status</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <select
            value={status}
            onChange={e => setStatus(e.target.value as InfluencerStatus)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            {STATUS_OPTIONS.map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
          <textarea
            placeholder="Notes about this influencer..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none"
          />
          <Button
            size="sm"
            disabled={update.isPending}
            onClick={() => update.mutate({ status, notes })}
          >
            {update.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
            Save
          </Button>
        </CardContent>
      </Card>

      {influencer.bio && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Bio</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{influencer.bio}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Followers</p>
            <p className="mt-1 text-2xl font-bold">{formatFollowers(influencer.follower_count)}</p>
          </CardContent>
        </Card>
        {influencer.post_count !== null && (
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Posts</p>
              <p className="mt-1 text-2xl font-bold">{influencer.post_count.toLocaleString()}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

// ─── Outreach tab ──────────────────────────────────────────────────────────────

function OutreachTab({ brandId, influencerId }: { brandId: string; influencerId: string }) {
  const { data: messages, isLoading } = useOutreachMessages(brandId, influencerId)
  const generate = useGenerateOutreach(brandId, influencerId)
  const [channel, setChannel] = useState<OutreachChannel>("dm")
  const [goal, setGoal] = useState("")

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-sm">Generate outreach message</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <select
              value={channel}
              onChange={e => setChannel(e.target.value as OutreachChannel)}
              className="rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="dm">DM</option>
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
            <Input placeholder="Campaign goal (optional)" value={goal} onChange={e => setGoal(e.target.value)} />
          </div>
          <Button disabled={generate.isPending} onClick={() => generate.mutate({ channel, campaignGoal: goal || undefined })}>
            {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Generate message
          </Button>
        </CardContent>
      </Card>

      {isLoading && <div className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>}

      {messages?.map((msg: OutreachMessageRow) => (
        <Card key={msg.id}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm capitalize">{msg.channel} message</CardTitle>
              <span className="text-xs text-muted-foreground">{new Date(msg.created_at).toLocaleDateString()}</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {msg.subject && <p className="text-xs font-medium text-muted-foreground">Subject: {msg.subject}</p>}
            <p className="text-sm whitespace-pre-wrap">{msg.message_text}</p>
            {msg.tone && <p className="text-xs text-muted-foreground italic">Tone: {msg.tone}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ─── Brief tab ─────────────────────────────────────────────────────────────────

function BriefTab({ brandId, influencerId }: { brandId: string; influencerId: string }) {
  const { data: partnerships, isLoading } = usePartnerships(brandId, influencerId)
  const generate = useGenerateBrief(brandId, influencerId)
  const [campaignName, setCampaignName] = useState("")

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-sm">Generate collaboration brief</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Campaign name"
            value={campaignName}
            onChange={e => setCampaignName(e.target.value)}
          />
          <Button disabled={generate.isPending || !campaignName.trim()} onClick={() => generate.mutate({ campaignName })}>
            {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Generate brief
          </Button>
        </CardContent>
      </Card>

      {isLoading && <div className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>}

      {partnerships?.map((p: InfluencerPartnershipRow) => (
        <Card key={p.id}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">{p.campaign_name}</CardTitle>
              <span className={`rounded-full px-2 py-0.5 text-xs capitalize ${
                p.status === "active" ? "bg-green-100 text-green-700" :
                p.status === "completed" ? "bg-blue-100 text-blue-700" :
                "bg-muted text-muted-foreground"
              }`}>{p.status}</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {p.campaign_brief && <p className="text-muted-foreground">{p.campaign_brief}</p>}
            {p.deliverables.length > 0 && (
              <div>
                <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground mb-1">Deliverables</p>
                <ul className="list-disc list-inside space-y-0.5 text-sm">
                  {p.deliverables.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              </div>
            )}
            {p.key_hashtags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {p.key_hashtags.map(h => (
                  <span key={h} className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{h}</span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ─── Performance tab ───────────────────────────────────────────────────────────

function PerformanceTab({ brandId, influencerId }: { brandId: string; influencerId: string }) {
  const { data: partnerships, isLoading } = usePartnerships(brandId, influencerId)

  if (isLoading) return <div className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>

  const active = partnerships?.filter(p => ["active", "completed"].includes(p.status as PartnershipStatus)) ?? []

  if (active.length === 0) {
    return (
      <div className="flex h-40 flex-col items-center justify-center rounded-lg border border-dashed text-center">
        <p className="text-sm text-muted-foreground">No active or completed campaigns yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {active.map((p: InfluencerPartnershipRow) => (
        <Card key={p.id}>
          <CardHeader><CardTitle className="text-sm">{p.campaign_name}</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xs text-muted-foreground">Reach</p>
                <p className="text-xl font-bold">{p.actual_reach ? formatFollowers(p.actual_reach) : "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Engagement</p>
                <p className="text-xl font-bold">{p.actual_engagement?.toLocaleString() ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Conversions</p>
                <p className="text-xl font-bold">{p.conversions?.toLocaleString() ?? "—"}</p>
              </div>
            </div>
            {p.roi_notes && <p className="mt-3 text-sm text-muted-foreground">{p.roi_notes}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function InfluencerDetailPage() {
  const params = useParams()
  const brandId = params.brandId as string
  const influencerId = params.influencerId as string
  const [activeTab, setActiveTab] = useState<Tab>("overview")
  const { data: influencer, isLoading } = useInfluencer(brandId, influencerId)

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!influencer) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Influencer not found.</p>
        <Link href={`/brands/${brandId}/influencers`} className="text-primary text-sm mt-2 block">
          Back to influencers
        </Link>
      </div>
    )
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "outreach", label: "Outreach" },
    { id: "brief", label: "Brief" },
    { id: "performance", label: "Performance" },
  ]

  return (
    <div className="p-8">
      <div className="mb-6">
        <Link
          href={`/brands/${brandId}/influencers`}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All influencers
        </Link>

        <div className="flex items-center gap-4">
          {influencer.avatar_url ? (
            // eslint-disable-next-line @next/next-app/no-img-element
            <img src={influencer.avatar_url} alt={influencer.handle} className="h-16 w-16 rounded-full object-cover" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary">
              {influencer.handle.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div>
            <div className="flex items-center gap-2 text-xl font-bold">
              <PlatformIcon platform={influencer.platform} />
              @{influencer.handle}
            </div>
            {influencer.full_name && <p className="text-sm text-muted-foreground">{influencer.full_name}</p>}
            <div className="mt-1 flex items-center gap-2">
              <FitScoreBadge score={influencer.fit_score} />
              <span className={`rounded-full px-2 py-0.5 text-xs capitalize ${
                influencer.status === "partnered" ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"
              }`}>{influencer.status}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 border-b">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && <OverviewTab brandId={brandId} influencerId={influencerId} />}
      {activeTab === "outreach" && <OutreachTab brandId={brandId} influencerId={influencerId} />}
      {activeTab === "brief" && <BriefTab brandId={brandId} influencerId={influencerId} />}
      {activeTab === "performance" && <PerformanceTab brandId={brandId} influencerId={influencerId} />}
    </div>
  )
}
