"use client"

import { useState } from "react"
import { LayoutGrid, Share2, BarChart3, Users } from "lucide-react"
import { SocialConnections } from "@/components/brands/SocialConnections"
import { AnalyticsDashboard } from "@/components/brands/AnalyticsDashboard"
import { CompetitorAnalysis } from "@/components/brands/CompetitorAnalysis"

type BrandDetailTab = "overview" | "connections" | "analytics" | "competitors"

const TABS: { id: BrandDetailTab; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "connections", label: "Connections", icon: Share2 },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "competitors", label: "Competitors", icon: Users },
]

export function BrandDetailTabs({ brandId, children }: { brandId: string; children: React.ReactNode }) {
  const [activeTab, setActiveTab] = useState<BrandDetailTab>("overview")

  return (
    <div>
      <div className="mb-6 flex gap-0.5 overflow-x-auto border-b pb-px">
        {TABS.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === "overview" && children}
      {activeTab === "connections" && <SocialConnections brandId={brandId} />}
      {activeTab === "analytics" && <AnalyticsDashboard brandId={brandId} />}
      {activeTab === "competitors" && <CompetitorAnalysis brandId={brandId} />}
    </div>
  )
}
