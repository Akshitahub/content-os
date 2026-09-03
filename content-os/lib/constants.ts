/**
 * Temporary kill switch for AI reel video generation (Kling, via PiAPI) —
 * flip to true once the PiAPI account is topped up. This only gates the
 * video-rendering step and its dedicated UI entry points
 * (components/generate/CreatePicker.tsx's "Reel" card,
 * components/shared/GenerateVideoAction.tsx's "Generate video" button).
 * Reel *script* (text) generation is unaffected — it's Groq-only and never
 * touches PiAPI — so it stays enabled throughout.
 */
export const REELS_ENABLED = false

/**
 * Same kill-switch pattern as REELS_ENABLED above, for social platforms —
 * Zernio bills per connected account, and the business wants to limit that
 * cost exposure to Instagram only during this initial phase, independent
 * of PLAN_LIMITS.zernioSocialPlatforms (the separate Pro/Agency plan-tier
 * gate — this list applies on top of that, to every plan). Expand as the
 * business scales into the other five already-migrated platforms
 * (Threads/Pinterest/LinkedIn/YouTube/Twitter).
 *
 * Enforced on both sides: the six connect routes
 * (app/api/v1/social/*\/connect/route.ts) check this before ever calling
 * createZernioProfile/getZernioConnectUrl — the step that actually starts
 * incurring Zernio's per-account cost — and
 * components/brands/SocialConnections.tsx disables the Connect button for
 * anything not listed here. The backend check is what actually controls
 * cost; the UI check alone wouldn't stop a direct API call.
 */
export const ENABLED_SOCIAL_PLATFORMS: readonly string[] = ["instagram"]

export const WHATSAPP_NUMBER = "917827774878" // +91 78277 74878, no leading +
// Single source for the support WhatsApp link — other components should import this rather than hand-building their own wa.me URL.
export const WHATSAPP_LINK = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent("Hi SocioPosts, I'd like to know more.")}`
export const CONTACT_EMAIL = "socioposts@gmail.com"
