// Dev-only, offline check of lib/ai/provider-fallback.ts: text runs on Groq
// only. A local stand-in plays Groq; a second one listens where OpenAI would
// be, and every case checks it never receives a request -- daily limits, long
// waits, 413s, 5xx and timeouts all throw Groq's own error, and only a short
// per-minute 429 is waited out and retried on Groq. No real model calls, no
// database. Run manually: `npx tsx scripts/test-provider-fallback.ts`. Exits
// non-zero if any case fails.
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
let groqCalls = 0
let openaiRequests = 0

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
  // Where OpenAI would be: anything arriving here is a failure.
  const openaiUrl = await server((body) => {
    openaiRequests++
    return { status: 200, body: completion(String(body.model), '{"ok":"openai"}') }
  })
  process.env.GROQ_BASE_URL = groqUrl
  process.env.OPENAI_BASE_URL = openaiUrl
  process.env.GROQ_API_KEY = "test-groq"
  process.env.OPENAI_API_KEY = "test-openai"

  const { createTextCompletion, suggestedWaitMs, isShortRateLimit } = await import("@/lib/ai/provider-fallback")
  const { createCreativeCompletion } = await import("@/lib/ai/creative-completion")
  const { MODELS } = await import("@/lib/ai/models")

  const request = { model: MODELS.creative, messages: [{ role: "user" as const, content: "hi" }], temperature: 0.4, max_tokens: 900, response_format: { type: "json_object" as const } }
  const reset = () => { groqQueue.length = 0; groqCalls = 0 }
  const fails = (p: Promise<unknown>) => p.then(() => "resolved", (e) => ({ status: (e as { status?: number }).status ?? null, message: String((e as Error).message) }))

  // 1. Groq answers -> on Groq.
  reset()
  const ok = await createTextCompletion(request, { stage: "story", timeout: 5000 })
  check("Groq answers -> provider groq", ok.provider === "groq" && ok.model === MODELS.creative && ok.response.choices[0]?.message?.content === '{"ok":"groq"}', ok)

  // 2. The daily token limit -> Groq's own error, nothing sent to OpenAI.
  reset()
  groqQueue.push(groqError(429, "Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 199500, Requested 6800. Please try again in 7m12.5s.", "433"))
  const daily = await fails(createTextCompletion(request, { stage: "story", timeout: 5000 }))
  check("daily limit -> the Groq 429 is thrown", typeof daily === "object" && daily.status === 429 && /TPD/.test(daily.message) && groqCalls === 1, daily)

  // 3. A short per-minute 429 -> waited out and retried on Groq once.
  reset()
  groqQueue.push(groqError(429, "Rate limit reached ... on tokens per minute (TPM): Limit 8000, Used 7900, Requested 600. Please try again in 1.2s.", "2"))
  const short = await createTextCompletion(request, { stage: "story", timeout: 5000 })
  check("short per-minute 429 -> retried on Groq", short.provider === "groq" && groqCalls === 2, { provider: short.provider, groqCalls })

  // 4. A short 429 twice -> thrown after the one retry.
  reset()
  groqQueue.push(groqError(429, "... tokens per minute (TPM) ... Please try again in 0.5s."), groqError(429, "... tokens per minute (TPM) ... Please try again in 0.5s."))
  const twice = await fails(createTextCompletion(request, { stage: "story", timeout: 5000 }))
  check("short 429 twice -> thrown after one retry", typeof twice === "object" && twice.status === 429 && groqCalls === 2, { twice, groqCalls })

  // 5. A long per-minute wait -> thrown at once, no waiting.
  reset()
  groqQueue.push(groqError(429, "... tokens per minute (TPM) ... Please try again in 45s."))
  const long = await fails(createTextCompletion(request, { stage: "story", timeout: 5000 }))
  check("long per-minute wait -> thrown at once", typeof long === "object" && long.status === 429 && groqCalls === 1, { long, groqCalls })

  // 6. 413, 5xx, a bad request -> thrown, never retried elsewhere.
  for (const [status, label] of [[413, "413 request too large"], [503, "Groq 503"], [400, "400 bad request"]] as const) {
    reset()
    groqQueue.push({ status, body: { error: { message: status === 413 ? "Request too large for model" : status === 503 ? "Service unavailable" : "Invalid JSON schema" } } })
    const r = await fails(createTextCompletion(request, { stage: "story", timeout: 5000 }))
    check(`${label} -> thrown`, typeof r === "object" && r.status === status, r)
  }

  // 7. Scoring / extraction (gpt-oss-20b) and vision (qwen) are Groq models too.
  reset()
  const scoring = await createTextCompletion({ ...request, model: MODELS.scoring }, { stage: "quality_gate", timeout: 5000 })
  check("scoring model runs on Groq", scoring.provider === "groq" && scoring.model === MODELS.scoring, scoring.model)

  // 8. A non-Groq model id (here OpenAI's image model) is refused, never sent to OpenAI.
  reset()
  const foreign = await fails(createTextCompletion({ ...request, model: "gpt-image-2" }, { stage: "story", timeout: 5000 }))
  check("a non-Groq model is refused", typeof foreign === "object" && /not a Groq model/.test(foreign.message) && groqCalls === 0, foreign)

  // 9. Through a real call site: createCreativeCompletion (stories / carousels / Autopilot).
  reset()
  groqQueue.push(groqError(429, "Rate limit reached for model `openai/gpt-oss-120b` ... on tokens per day (TPD) ... Please try again in 12m."))
  const creative = await fails(createCreativeCompletion({ stage: "story", logPrefix: "test", system: "s", user: "u", reasoningEffort: "medium", maxCompletionTokens: 4000, timeoutMs: 5000 }))
  check("createCreativeCompletion -> the Groq error, no fallback", typeof creative === "object" && /TPD/.test(creative.message), creative)

  check("suggestedWaitMs parses 4m19.2s", suggestedWaitMs(new Error("Please try again in 4m19.2s.")) === 259_200, suggestedWaitMs(new Error("Please try again in 4m19.2s.")))
  check("isShortRateLimit: per-day is never short", !isShortRateLimit(Object.assign(new Error("tokens per day (TPD) ... try again in 2s"), { status: 429 })))

  // The point of the whole file: OpenAI was never called.
  check("no request ever reached OpenAI", openaiRequests === 0, openaiRequests)

  console.log(`\n[test-provider-fallback] ${failures === 0 ? "all passed" : `${failures} failed`}`)
  process.exit(failures > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error("[test-provider-fallback] crashed:", err)
  process.exit(1)
})
