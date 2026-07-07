"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { InfluencerRow, InfluencerPartnershipRow, OutreachMessageRow } from "@/types/database"
import type { InfluencerStatus } from "@/types/app"

// ─── Keys ─────────────────────────────────────────────────────────────────────

export const influencerKeys = {
  all: (brandId: string) => ["influencers", brandId] as const,
  detail: (brandId: string, influencerId: string) => ["influencers", brandId, influencerId] as const,
  outreach: (brandId: string, influencerId: string) => ["influencers", brandId, influencerId, "outreach"] as const,
  briefs: (brandId: string, influencerId: string) => ["influencers", brandId, influencerId, "briefs"] as const,
  partnerships: (brandId: string, influencerId: string) => ["influencers", brandId, influencerId, "partnerships"] as const,
}

// ─── List ──────────────────────────────────────────────────────────────────────

export function useInfluencers(brandId: string) {
  return useQuery({
    queryKey: influencerKeys.all(brandId),
    queryFn: async (): Promise<InfluencerRow[]> => {
      const res = await fetch(`/api/v1/brands/${brandId}/influencers`)
      if (!res.ok) throw new Error("Failed to fetch influencers")
      const json = await res.json() as { data: InfluencerRow[] }
      return json.data
    },
    enabled: !!brandId,
  })
}

// ─── Single ────────────────────────────────────────────────────────────────────

export function useInfluencer(brandId: string, influencerId: string) {
  return useQuery({
    queryKey: influencerKeys.detail(brandId, influencerId),
    queryFn: async (): Promise<InfluencerRow> => {
      const res = await fetch(`/api/v1/brands/${brandId}/influencers/${influencerId}`)
      if (!res.ok) throw new Error("Failed to fetch influencer")
      const json = await res.json() as { data: InfluencerRow }
      return json.data
    },
    enabled: !!brandId && !!influencerId,
  })
}

// ─── Auto-discover ─────────────────────────────────────────────────────────────

export function useAutoDiscoverInfluencers(brandId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      platform: "instagram" | "tiktok" | "youtube" | "linkedin"
      count?: number
    }): Promise<{ data: InfluencerRow[]; count: number }> => {
      const res = await fetch(`/api/v1/brands/${brandId}/influencers/auto-discover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
      if (!res.ok) {
        const err = await res.json() as { error?: { message?: string } }
        throw new Error(err.error?.message ?? "Auto-discovery failed")
      }
      return res.json() as Promise<{ data: InfluencerRow[]; count: number }>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: influencerKeys.all(brandId) }),
  })
}

// ─── Discover (scrape + score + save) ─────────────────────────────────────────

export function useDiscoverInfluencer(brandId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { handle: string; platform: "instagram" | "tiktok" | "youtube" | "linkedin" }): Promise<InfluencerRow> => {
      const res = await fetch(`/api/v1/brands/${brandId}/influencers/discover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
      if (!res.ok) {
        const err = await res.json() as { error?: { message?: string } }
        throw new Error(err.error?.message ?? "Discovery failed")
      }
      const json = await res.json() as { data: InfluencerRow }
      return json.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: influencerKeys.all(brandId) }),
  })
}

// ─── Create manually ───────────────────────────────────────────────────────────

export function useCreateInfluencer(brandId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: Partial<InfluencerRow>): Promise<InfluencerRow> => {
      const res = await fetch(`/api/v1/brands/${brandId}/influencers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
      if (!res.ok) throw new Error("Failed to create influencer")
      const json = await res.json() as { data: InfluencerRow }
      return json.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: influencerKeys.all(brandId) }),
  })
}

// ─── Update ────────────────────────────────────────────────────────────────────

export function useUpdateInfluencer(brandId: string, influencerId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { status?: InfluencerStatus; notes?: string | null; niche?: string | null }): Promise<InfluencerRow> => {
      const res = await fetch(`/api/v1/brands/${brandId}/influencers/${influencerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
      if (!res.ok) throw new Error("Failed to update influencer")
      const json = await res.json() as { data: InfluencerRow }
      return json.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: influencerKeys.all(brandId) })
      qc.invalidateQueries({ queryKey: influencerKeys.detail(brandId, influencerId) })
    },
  })
}

// ─── Delete ────────────────────────────────────────────────────────────────────

export function useDeleteInfluencer(brandId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (influencerId: string): Promise<void> => {
      const res = await fetch(`/api/v1/brands/${brandId}/influencers/${influencerId}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete influencer")
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: influencerKeys.all(brandId) }),
  })
}

// ─── Outreach ─────────────────────────────────────────────────────────────────

export function useOutreachMessages(brandId: string, influencerId: string) {
  return useQuery({
    queryKey: influencerKeys.outreach(brandId, influencerId),
    queryFn: async (): Promise<OutreachMessageRow[]> => {
      const res = await fetch(`/api/v1/brands/${brandId}/influencers/${influencerId}/outreach`)
      if (!res.ok) throw new Error("Failed to fetch outreach messages")
      const json = await res.json() as { data: OutreachMessageRow[] }
      return json.data
    },
    enabled: !!brandId && !!influencerId,
  })
}

export function useGenerateOutreach(brandId: string, influencerId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { channel: "dm" | "email" | "whatsapp"; campaignGoal?: string }): Promise<OutreachMessageRow> => {
      const res = await fetch(`/api/v1/brands/${brandId}/influencers/${influencerId}/outreach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
      if (!res.ok) {
        const err = await res.json() as { error?: { message?: string } }
        throw new Error(err.error?.message ?? "Failed to generate outreach")
      }
      const json = await res.json() as { data: OutreachMessageRow }
      return json.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: influencerKeys.outreach(brandId, influencerId) }),
  })
}

export function useUpdateOutreachMessage(brandId: string, influencerId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { messageId: string; message_text: string; subject?: string | null }): Promise<OutreachMessageRow> => {
      const res = await fetch(`/api/v1/brands/${brandId}/influencers/${influencerId}/outreach`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
      if (!res.ok) {
        const err = await res.json() as { error?: { message?: string } }
        throw new Error(err.error?.message ?? "Failed to update message")
      }
      const json = await res.json() as { data: OutreachMessageRow }
      return json.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: influencerKeys.outreach(brandId, influencerId) }),
  })
}

export function useSendOutreachEmail(brandId: string, influencerId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { messageId: string; email?: string }): Promise<{ sent: boolean }> => {
      const res = await fetch(`/api/v1/brands/${brandId}/influencers/${influencerId}/outreach/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
      if (!res.ok) {
        const err = await res.json() as { error?: { message?: string } }
        throw new Error(err.error?.message ?? "Failed to send email")
      }
      const json = await res.json() as { data: { sent: boolean } }
      return json.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: influencerKeys.outreach(brandId, influencerId) })
      qc.invalidateQueries({ queryKey: influencerKeys.detail(brandId, influencerId) })
    },
  })
}

// ─── Briefs / Partnerships ─────────────────────────────────────────────────────

export function usePartnerships(brandId: string, influencerId: string) {
  return useQuery({
    queryKey: influencerKeys.partnerships(brandId, influencerId),
    queryFn: async (): Promise<InfluencerPartnershipRow[]> => {
      const res = await fetch(`/api/v1/brands/${brandId}/influencers/${influencerId}/partnerships`)
      if (!res.ok) throw new Error("Failed to fetch partnerships")
      const json = await res.json() as { data: InfluencerPartnershipRow[] }
      return json.data
    },
    enabled: !!brandId && !!influencerId,
  })
}

export function useGenerateBrief(brandId: string, influencerId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { campaignName: string; productId?: string }): Promise<InfluencerPartnershipRow> => {
      const res = await fetch(`/api/v1/brands/${brandId}/influencers/${influencerId}/brief`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
      if (!res.ok) {
        const err = await res.json() as { error?: { message?: string } }
        throw new Error(err.error?.message ?? "Failed to generate brief")
      }
      const json = await res.json() as { data: InfluencerPartnershipRow }
      return json.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: influencerKeys.partnerships(brandId, influencerId) })
      qc.invalidateQueries({ queryKey: influencerKeys.briefs(brandId, influencerId) })
    },
  })
}

export function useUpdatePartnership(brandId: string, influencerId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      partnershipId: string
      status?: "draft" | "sent" | "active" | "completed" | "cancelled"
      actual_reach?: number | null
      actual_engagement?: number | null
      conversions?: number | null
      roi_notes?: string | null
    }): Promise<InfluencerPartnershipRow> => {
      const res = await fetch(`/api/v1/brands/${brandId}/influencers/${influencerId}/partnerships`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
      if (!res.ok) throw new Error("Failed to update partnership")
      const json = await res.json() as { data: InfluencerPartnershipRow }
      return json.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: influencerKeys.partnerships(brandId, influencerId) }),
  })
}
