import type { BrandRow } from "@/types/database"
import type { BrandTypography } from "./fonts"
import { isMissingBrandBrainColumn, parseBrandBrain } from "@/lib/brand-brain-profile"

/**
 * First generation for a brand with no saved fonts: store the fonts
 * resolveTypography just picked in brand_brain.visual, so every later
 * carousel, story, post and ad uses the same pair. Fail-soft -- a missing
 * brand_brain column (migration 060 not run) or any write error is logged
 * and ignored; the generation itself already has its fonts.
 */
export async function rememberBrandTypography(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  brand: Pick<BrandRow, "id" | "brand_brain">,
  typography: BrandTypography,
): Promise<void> {
  if (typography.source === "brand") return
  try {
    const brain = parseBrandBrain(brand.brand_brain)
    if (brain.visual?.heading_font) return
    const next = { ...brain, visual: { ...brain.visual, heading_font: typography.heading, body_font: typography.body } }
    const { error } = await supabase.from("brands").update({ brand_brain: next }).eq("id", brand.id)
    if (error && !isMissingBrandBrainColumn(error)) console.error("[brand-typography] couldn't save brand fonts (non-fatal):", error.message)
    // Keep the in-memory row in step for anything later in this request.
    if (!error) (brand as { brand_brain: unknown }).brand_brain = next
  } catch (err) {
    console.error("[brand-typography] couldn't save brand fonts (non-fatal):", err instanceof Error ? err.message : err)
  }
}
