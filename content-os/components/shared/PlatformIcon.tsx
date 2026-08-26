import type { ComponentType } from "react"
import { FaInstagram, FaTiktok, FaFacebook, FaYoutube, FaLinkedin, FaXTwitter } from "react-icons/fa6"
import { PLATFORM_COLORS } from "@/lib/design/constants"

/**
 * Real brand marks (react-icons/fa6, already a dependency — see the
 * Influencers page's FaLinkedin usage) instead of emoji or generic
 * lucide stand-ins. Colored via PLATFORM_COLORS' existing hex values so
 * this can never disagree with the badge/pill coloring already used
 * elsewhere for the same platforms.
 */
const PLATFORM_ICON_COMPONENTS: Record<string, ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  instagram: FaInstagram,
  tiktok: FaTiktok,
  facebook: FaFacebook,
  youtube: FaYoutube,
  linkedin: FaLinkedin,
  twitter: FaXTwitter,
}

interface PlatformIconProps {
  platform: string
  className?: string
}

/** Falls back to a two-letter initial chip for any platform without a
 * mapped brand icon, rather than rendering nothing. */
export function PlatformIcon({ platform, className }: PlatformIconProps) {
  const Icon = PLATFORM_ICON_COMPONENTS[platform]
  if (!Icon) {
    return <span className={`text-[10px] font-medium uppercase text-muted-foreground ${className ?? ""}`}>{platform.slice(0, 2)}</span>
  }
  const hex = PLATFORM_COLORS[platform]?.hex ?? "#6b7280"
  return <Icon className={className} style={{ color: hex }} />
}
