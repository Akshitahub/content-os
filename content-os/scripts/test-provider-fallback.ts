// Dev-only, offline check of lib/ai/provider-fallback.ts: two local
// stand-in servers play Groq and OpenAI (no real model calls, no database).
// Simulates Groq's daily token limit and the other failure modes and checks
// the call completes on OpenAI -- or doesn't fall over when it shouldn't.
// Run manually: `npx tsx scripts/test-provider-fallback.ts`. Exits non-zero
// if any case fails.
//
// NOT reachable in production: a standalone script, never served by
// Next.js. The NODE_ENV guard is defense-in-depth only, same as
// scripts/test-fact-guard.ts.
import http from "http"
import type { AddressInfo } from "net"

if (process.env.NODE_ENV === "production") {
  console.error("[test-provider-fallback] refusing to run with NODE_ENV=production -- this is a dev-only check.")
  process.exit(1)
}

type Reply = { status: number; body: unknown; headers?: Record<string, string> }
const groqQueue: Reply[] = []
const openaiQueue: Reply[] = []
const openaiRequests: Record<string, unknown>[] = []
let groqCalls = 0

const completion = (model: string, content: string) => ({
  id: "x", object: "chat.completion", created: 0, model,
  choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
})
const groqError = (status: number, message: string, retryAfter?: string): Reply => ({
  status, body: { error: { message, type: "tokens", code: "rate_limit_exceeded" } }, headers: retryAfter ? { "retry-after": retryAfter } : {},
})

function server(handler: (body: Record<string, unknown>) => Reply): Promise<string> {
  const srv = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on("data", (c) => chunks.push(c))
    req.on("end", () => {
      const reply = handler(JSON.parse(Buffer.concat(chunks).toString() || "{}"))
      res.writeHead(reply.status, { "content-type": "application/json", ...(reply.headers ?? {}) })
      res.end(JSON.stringify(reply.body))
    })
  })
  return new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`)))
}

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` -- got ${JSON.stringify(detail)}`}`)
  if (!ok) failures++
}

async function main() {
  const groqUrl = await server((body) => {
    groqCalls++
    return groqQueue.shift() ?? { status: 200, body: completion(String(body.model), '{"ok":"groq"}') }
  })
  const openaiUrl = await server((body) => {
    openaiRequests.push(body)
    return openaiQueue.shift() ?? { status: 200, body: completion(String(body.model), '{"ok":"openai"}') }
  })
  process.env.GROQ_BASE_URL = groqUrl
  process.env.OPENAI_BASE_URL = openaiUrl
  process.env.GROQ_API_KEY = "test-groq"
  process.env.OPENAI_API_KEY = "test-openai"

  const { createTextCompletion, runWithGenerationContext, generationFallbackCount, suggestedWaitMs } = await import("@/lib/ai/provider-fallback")
  const { createCreativeCompletion } = await import("@/lib/ai/creative-completion")
  const { MODELS } = await import("@/lib/ai/models")

  const request = { model: MODELS.creative, messages: [{ role: "user" as const, content: "hi" }], temperature: 0.4, max_tokens: 900, response_format: { type: "json_object" as const } }
  const reset = () => { groqQueue.length = 0; openaiRequests.length = 0; groqCalls = 0 }

  // 1. The real failure: Groq's DAILY token limit -> the call completes on OpenAI.
  reset()
  groqQueue.push(groqError(429, "Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 199500, Requested 6800. Please try again in 7m12.5s.", "433"))
  const daily = await runWithGenerationContext({ route: "test", contentType: "story" }, async () => {
    const r = await createTextCompletion(request, { stage: "story", timeout: 5000 })
    return { ...r, count: generationFallbackCount() }
  })
  check("daily limit -> completes on OpenAI", daily.provider === "openai" && daily.response.choices[0]?.message?.content === '{"ok":"openai"}', daily.provider)
  check("daily limit -> reason daily_limit, model gpt-5.4", daily.fallbackReason === "daily_limit" && daily.model === "gpt-5.4", [daily.fallbackReason, daily.model])
  check("Groq tried once (no pointless wait on a daily limit)", groqCalls === 1, groqCalls)
  const sent = openaiRequests[0] ?? {}
  check("OpenAI request adapted: max_completion_tokens, no temperature / max_tokens", sent.max_completion_tokens === 900 && !("temperature" in sent) && !("max_tokens" in sent), sent)
  check("fallback counted in the generation context", daily.count === 1, daily.count)

  // 2. A short per-minute 429 is waited out on Groq, no fallback.
  reset()
  groqQueue.push(groqError(429, "Rate limit reached ... on tokens per minute (TPM): Limit 8000, Used 7000, Requested 6000. Please try again in 1.2s.", "1"))
  const short = await createTextCompletion(request, { stage: "story", timeout: 5000 })
  check("short per-minute 429 -> retried on Groq", short.provider === "groq" && groqCalls === 2 && openaiRequests.length === 0, { provider: short.provider, groqCalls })

  // 3. Short 429 twice -> falls over.
  reset()
  groqQueue.push(groqError(429, "Rate limit ... per minute. Please try again in 1.1s."), groqError(429, "Rate limit ... per minute. Please try again in 1.3s."))
  const twice = await createTextCompletion(request, { stage: "story", timeout: 5000 })
  check("short 429 twice -> OpenAI (rate_limit)", twice.provider === "openai" && twice.fallbackReason === "rate_limit", twice.fallbackReason)

  // 4. A long suggested wait (> 20s) falls over at once.
  reset()
  groqQueue.push(groqError(429, "Rate limit ... per minute. Please try again in 45.2s."))
  const long = await createTextCompletion(request, { stage: "story", timeout: 5000 })
  check("long per-minute wait -> OpenAI at once", long.provider === "openai" && groqCalls === 1, { provider: long.provider, groqCalls })

  // 5. One request over the per-minute cap (413) -> OpenAI.
  reset()
  groqQueue.push(groqError(413, "Request too large for model `openai/gpt-oss-120b` ... on tokens per minute (TPM): Limit 8000, Requested 8368"))
  const big = await createTextCompletion(request, { stage: "quality_gate", timeout: 5000 })
  check("413 request too large -> OpenAI", big.fallbackReason === "request_too_large", big.fallbackReason)

  // 6. A Groq 5xx -> OpenAI.
  reset()
  groqQueue.push({ status: 503, body: { error: { message: "Service Unavailable" } } })
  const down = await createTextCompletion(request, { stage: "story", timeout: 5000 })
  check("Groq 503 -> OpenAI (server_error)", down.fallbackReason === "server_error", down.fallbackReason)

  // 7. Scoring / extraction map to the mini model.
  reset()
  groqQueue.push(groqError(429, "... tokens per day (TPD) ... Please try again in 3h2m"))
  const scoring = await createTextCompletion({ ...request, model: MODELS.scoring }, { stage: "quality_gate", timeout: 5000 })
  check("scoring model falls over to gpt-5.4-mini", scoring.model === "gpt-5.4-mini", scoring.model)

  // 8. A bad request is NOT retried on OpenAI.
  reset()
  groqQueue.push({ status: 400, body: { error: { message: "Invalid JSON schema" } } })
  const bad = await createTextCompletion(request, { stage: "story", timeout: 5000 }).then(() => "resolved", (e) => (e as { status?: number }).status)
  check("400 bad request -> rethrown, no OpenAI call", bad === 400 && openaiRequests.length === 0, { bad, openai: openaiRequests.length })

  // 9. No OPENAI_API_KEY -> today's behaviour (the Groq error).
  reset()
  delete process.env.OPENAI_API_KEY
  groqQueue.push(groqError(429, "... tokens per day (TPD) ..."))
  const noKey = await createTextCompletion(request, { stage: "story", timeout: 5000 }).then(() => "resolved", (e) => (e as { status?: number }).status)
  check("no OPENAI_API_KEY -> the Groq 429 is thrown", noKey === 429 && openaiRequests.length === 0, noKey)
  process.env.OPENAI_API_KEY = "test-openai"

  // 9b. OpenAI failing too (e.g. out of credits) -> the caller still gets Groq's own error.
  reset()
  groqQueue.push(groqError(429, "... tokens per day (TPD) ..."))
  openaiQueue.push({ status: 429, body: { error: { message: "You have no credits remaining.", code: "credit_balance_exhausted" } } }, { status: 429, body: { error: { message: "You have no credits remaining.", code: "credit_balance_exhausted" } } })
  const bothDown = await createTextCompletion(request, { stage: "story", timeout: 5000 }).then(() => "resolved", (e) => String((e as Error).message))
  check("OpenAI fails too -> the Groq error is rethrown", /TPD/.test(bothDown), bothDown)
  openaiQueue.length = 0

  // 10. Through a real call site: createCreativeCompletion (stories / carousels / Autopilot).
  reset()
  groqQueue.push(groqError(429, "Rate limit reached for model `openai/gpt-oss-120b` ... on tokens per day (TPD) ... Please try again in 12m."))
  const creative = await createCreativeCompletion({ stage: "story", logPrefix: "test", system: "s", user: "u", reasoningEffort: "medium", maxCompletionTokens: 4000, timeoutMs: 5000 })
  check("createCreativeCompletion completes on OpenAI, priced at gpt-5.4", creative.model === "gpt-5.4" && creative.content === '{"ok":"openai"}' && creative.costUsd !== null && creative.costUsd > 0, creative)

  check("suggestedWaitMs parses 4m19.2s", suggestedWaitMs(new Error("Please try again in 4m19.2s.")) === 259_200, suggestedWaitMs(new Error("Please try again in 4m19.2s.")))

  console.log(`\n[test-provider-fallback] ${failures === 0 ? "all passed" : `${failures} failed`}`)
  process.exit(failures > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error("[test-provider-fallback] crashed:", err)
  process.exit(1)
})
