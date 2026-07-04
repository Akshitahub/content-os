export interface RenderReelVideoInput {
  jobId: string
  scenes: { imageUrl: string; audioUrl: string | null; text: string; durationSeconds: number }[]
  musicUrl: string
}

export type RenderReelVideoResult =
  | { success: true; videoUrl: string }
  | { success: false; error: string }

/**
 * STUBBED — intentionally not implemented in this task.
 *
 * Remotion cannot render inside a Vercel serverless function: its
 * rendering stack requires bundling headless Chromium + FFmpeg (150MB+),
 * well over Vercel's 50MB function size limit. This is a hard limit
 * confirmed against Remotion's own docs
 * (https://www.remotion.dev/docs/miscellaneous/vercel-functions) — not a
 * timeout problem that more async/polling can solve.
 *
 * To make this real, pick one:
 * 1. Remotion Lambda (Remotion's own recommended path) — deploy a
 *    Remotion Lambda function + a "site" bundle to AWS, then trigger
 *    renders here via `@remotion/lambda-client` and poll S3/webhooks for
 *    the finished file. Requires an AWS account and real (small, per-
 *    render) AWS cost.
 * 2. A self-hosted renderer — run `@remotion/renderer` on a persistent
 *    Node process/container you control (not Vercel serverless), and
 *    have this function call out to it (e.g. over HTTP).
 *
 * Everything upstream of this call — scene image/voiceover generation,
 * the Remotion composition (remotion/ReelComposition.tsx), job tracking,
 * and the polling UI — is fully built and working. Only this function
 * needs a real implementation once a hosting approach is chosen.
 */
export async function renderReelVideo(_input: RenderReelVideoInput): Promise<RenderReelVideoResult> {
  return {
    success: false,
    error:
      "Video rendering isn't wired up yet — it requires deploying Remotion Lambda (AWS) or a self-hosted renderer. See lib/video/render-trigger.ts for what's needed.",
  }
}
