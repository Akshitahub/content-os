// Start/end timing lines for generation routes, so real gpt-5.5 (caption /
// copy) and gpt-image-2 (image) latencies show up in Vercel's logs:
//
//   [gen-timing] route=post-image event=start
//   [gen-timing] route=post-image event=end status=200 totalMs=41234 imageMs=40876
//
// captionMs = time spent in the text model step(s) (hook + caption, story/
// carousel copy, vision caption); imageMs = time spent in the image
// pipeline (all attempts). Steps that run concurrently are timed
// separately, so captionMs + imageMs can exceed totalMs. Never logs prompts
// or generated content.

export type GenerationStep = "caption" | "image"

export interface GenerationTimer {
  /** Times `work` and adds it to the named step's total. Returns/throws exactly what `work` does. */
  step<T>(name: GenerationStep, work: Promise<T>): Promise<T>
  /** Adds an already-measured duration (e.g. summed across Autopilot slots). */
  add(name: GenerationStep, ms: number): void
}

export async function timedGenerationRoute(route: string, handler: (timer: GenerationTimer) => Promise<Response>): Promise<Response> {
  const startedAt = Date.now()
  const totals: Partial<Record<GenerationStep, number>> = {}
  const add = (name: GenerationStep, ms: number) => { totals[name] = (totals[name] ?? 0) + ms }
  const timer: GenerationTimer = {
    add,
    async step(name, work) {
      const s = Date.now()
      try {
        return await work
      } finally {
        add(name, Date.now() - s)
      }
    },
  }
  const steps = () => (Object.entries(totals) as [GenerationStep, number][]).map(([k, v]) => `${k}Ms=${v}`).join(" ")

  console.log(`[gen-timing] route=${route} event=start`)
  try {
    const res = await handler(timer)
    console.log(`[gen-timing] route=${route} event=end status=${res.status} totalMs=${Date.now() - startedAt} ${steps()}`.trimEnd())
    return res
  } catch (err) {
    console.log(`[gen-timing] route=${route} event=end status=threw totalMs=${Date.now() - startedAt} ${steps()}`.trimEnd())
    throw err
  }
}
