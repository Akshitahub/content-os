/**
 * A customer's photo (UGC, used only once its creator said yes -- migration
 * 069) is credited in the caption: "📸 @handle" on its own last line.
 * Client-safe (no server imports) -- FullPostGenerator appends it too.
 */

type Credited = { source?: string | null; creator_handle?: string | null }

/** The repost credit, or null for the brand's own photo. */
export function photoCredit(p: Credited | null | undefined): string | null {
  const handle = p?.source === "ugc" ? p.creator_handle?.replace(/^@/, "").trim() : null
  return handle ? `📸 @${handle}` : null
}

/** The caption with a credit line on its own last line (once). */
export function withCreditLine(caption: string, credit: string | null | undefined): string {
  if (!credit || caption.includes(credit)) return caption
  return `${caption.trimEnd()}\n\n${credit}`
}

/** The caption with the photo's credit (once). */
export const withPhotoCredit = (caption: string, p: Credited | null | undefined): string => withCreditLine(caption, photoCredit(p))
