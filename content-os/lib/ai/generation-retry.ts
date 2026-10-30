import { addTextUsage, sumCostUsd, type TextUsage } from "./pricing"
import { OffTopicError, offTopicMessage } from "./quality-gate"

/** The model returned fewer slides / frames than asked for, twice. */
export class ShortGenerationError extends Error {
  usage: TextUsage | undefined = undefined
  costUsd: number | null = null
  constructor(readonly got: number, readonly wanted: number, readonly unit: string) {
    super(`The AI returned ${got} of ${wanted} ${unit}.`)
    this.name = "ShortGenerationError"
  }
}

/**
 * Runs a generation; with fewer items than asked for, regenerates ONCE, and
 * if that is short too, throws ShortGenerationError -- never silently
 * returns fewer. Usage and cost of both runs are summed.
 */
export async function regenerateIfShort<R extends { usage: TextUsage | undefined; costUsd: number | null }>(
  run: () => Promise<R>,
  countOf: (result: R) => number,
  wanted: number,
  unit: string,
): Promise<R> {
  const first = await run()
  const got = countOf(first)
  if (got >= wanted) return first
  console.log(`[generation-retry] ${got} of ${wanted} ${unit} -- regenerating once`)
  const second = await run()
  const merged = { ...second, usage: addTextUsage(first.usage, second.usage), costUsd: sumCostUsd(first.costUsd, second.costUsd) }
  const gotAgain = countOf(second)
  if (gotAgain < wanted) {
    const err = new ShortGenerationError(gotAgain, wanted, unit)
    err.usage = merged.usage
    err.costUsd = merged.costUsd
    throw err
  }
  return merged
}

/** The user-facing message for an off-topic or short generation, else null. */
export function generationErrorMessage(err: unknown): string | null {
  if (err instanceof OffTopicError) return offTopicMessage(err.topic)
  if (err instanceof ShortGenerationError) return `We only got ${err.got} of the ${err.wanted} ${err.unit} you asked for, even after retrying. Please try again.`
  return null
}
