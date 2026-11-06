/**
 * Fails fast if a critical environment variable is missing, rather than
 * letting the app boot in a broken state and surface confusing runtime
 * errors deep inside some unrelated request. Called from next.config.ts,
 * so a missing critical var fails the build/boot outright instead of
 * being discovered lazily whenever the first request happens to touch it.
 *
 * Scoped to variables the app cannot function at all without. Optional,
 * feature-gated integrations (Kling, Zernio, Razorpay, Resend, remove.bg,
 * Meta/Pinterest/Threads, NVIDIA, CRON_SECRET) are deliberately NOT here —
 * each of those already fails gracefully per-route with a clear
 * "not configured" error (see e.g. lib/video/kling-client.ts) instead of
 * blocking the whole app from starting over a feature that's allowed to
 * be unconfigured.
 */
const REQUIRED_ENV_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GROQ_API_KEY",
] as const

/**
 * Read where used, never validated here -- the build and CI run without
 * them. The direct Instagram connector (lib/social/meta-instagram-client.ts,
 * lib/social/token-crypto.ts):
 *   SOCIAL_TOKEN_KEY          32 random bytes, base64 -- encrypts stored tokens
 *   INSTAGRAM_APP_ID          Instagram app id (Business Login for Instagram)
 *   INSTAGRAM_APP_SECRET      its secret
 *   INSTAGRAM_DIRECT_USER_IDS comma-separated user ids who connect directly
 */
export const OPTIONAL_ENV_VARS = [
  "SOCIAL_TOKEN_KEY",
  "INSTAGRAM_APP_ID",
  "INSTAGRAM_APP_SECRET",
  "INSTAGRAM_DIRECT_USER_IDS",
] as const

export function validateRequiredEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name])
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
      `See .env.local.example for what each one does — the app cannot start without these.`
    )
  }
}
