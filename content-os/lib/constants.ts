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
