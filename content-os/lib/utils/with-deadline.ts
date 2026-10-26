// A route's own hard stop, kept below its maxDuration. If Vercel kills a
// function at maxDuration, none of the route's code runs after that: no
// credit refund, no failure log, and the client gets Vercel's plain-text
// error page instead of our JSON. Racing the slow part against a deadline
// that fires first means the route's normal catch/refund path always runs.
// (The losing work keeps running in the background until the instance
// stops -- harmless, its result is just discarded.)

export class DeadlineExceededError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} exceeded its ${Math.round(ms / 1000)}s deadline`)
    this.name = "DeadlineExceededError"
  }
}

export function withDeadline<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineExceededError(label, ms)), Math.max(0, ms))
  })
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer))
}

/** User-facing message for a route that hit its own deadline. */
export const GENERATION_TIMED_OUT_MESSAGE = "Generation timed out, please try again."
