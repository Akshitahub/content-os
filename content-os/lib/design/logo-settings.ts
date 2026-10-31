/**
 * The brand's logo settings as a frame takes them (lib/image/story-frame-
 * compositor.ts placeMark): the logo, its contrast variant, where it goes
 * and whether it's shown. Client-safe.
 */
export const LOGO_POSITION_OPTIONS = ["auto", "top-left", "top-right", "bottom-left", "bottom-right"] as const
export type LogoPositionOption = (typeof LOGO_POSITION_OPTIONS)[number]

export interface FrameLogo {
  logo_url: string | null
  logo_variant_url: string | null
  logo_position: LogoPositionOption
  show_logo: boolean
}

export function frameLogo(brand: { logo_url?: string | null; logo_variant_url?: string | null; logo_position?: string | null; logo_on_posts?: boolean | null }): FrameLogo {
  return {
    logo_url: brand.logo_url ?? null,
    logo_variant_url: brand.logo_variant_url ?? null,
    logo_position: (LOGO_POSITION_OPTIONS as readonly string[]).includes(brand.logo_position ?? "") ? brand.logo_position as LogoPositionOption : "auto",
    show_logo: brand.logo_on_posts !== false,
  }
}
