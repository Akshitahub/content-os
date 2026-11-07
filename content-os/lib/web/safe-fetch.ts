/**
 * Outbound fetching of URLs we don't control -- anything a user typed, a
 * scraped page linked to, or the database holds -- without letting it reach
 * private / internal networks or cloud metadata (169.254.169.254).
 *
 * The check runs on the IP actually connected to: undici's connect.lookup
 * resolves the host and refuses if ANY address is blocked, so a host can't
 * pass a pre-check and then re-resolve to an internal address (DNS
 * rebinding). Redirects are followed by hand through the same agent, so
 * every hop is checked too. One timeout covers connecting and reading the
 * whole body; the body is capped at maxBytes.
 *
 * Server-only (node:dns, undici).
 */
import dns from "node:dns"
import { isIP } from "node:net"
import { Agent, fetch, type Response } from "undici"

export type SafeFetchErrorCode =
  | "invalid_url"
  | "blocked"
  | "dns"
  | "timeout"
  | "too_large"
  | "content_type"
  | "redirect"
  | "too_many_redirects"
  | "network"

export class SafeFetchError extends Error {
  constructor(public readonly code: SafeFetchErrorCode, message: string) {
    super(message)
    this.name = "SafeFetchError"
  }
}

const MAX_REDIRECTS = 5

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".")
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const v = Number(p)
    if (v > 255) return null
    n = n * 256 + v
  }
  return n
}

/** Expands an IPv6 address to 8 numbers, or null if it isn't one. */
function ipv6Hextets(ip: string): number[] | null {
  let s = ip
  // A trailing dotted IPv4 ("::ffff:1.2.3.4") becomes two hextets.
  const v4 = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/)
  if (v4) {
    const n = ipv4ToInt(v4[2]!)
    if (n === null) return null
    s = `${v4[1]}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`
  }
  const halves = s.split("::")
  if (halves.length > 2) return null
  const parse = (part: string) => (part ? part.split(":") : [])
  const head = parse(halves[0]!)
  const tail = halves.length === 2 ? parse(halves[1]!) : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null
  const all = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail]
  const out: number[] = []
  for (const h of all) {
    if (!/^[0-9a-f]{1,4}$/.test(h)) return null
    out.push(parseInt(h, 16))
  }
  return out.length === 8 ? out : null
}

// [network, prefix length] for IPv4.
const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4], // multicast; 240/4 and 255.255.255.255 are caught by "and above"
]

function isBlockedV4(n: number): boolean {
  if (n >= ipv4ToInt("224.0.0.0")!) return true
  return BLOCKED_V4.some(([net, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    return ((n & mask) >>> 0) === ((ipv4ToInt(net)! & mask) >>> 0)
  })
}

/**
 * True for any address we must never connect to. Normalised first:
 * lowercased, brackets / zone id dropped, and an IPv4-mapped IPv6 address
 * ("::ffff:a.b.c.d", in either notation) checked as the IPv4 it maps to.
 * Anything that doesn't parse as an IP is blocked.
 */
export function isBlockedIp(ip: string): boolean {
  const s = ip.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "")
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  const v4 = ipv4ToInt(mapped ? mapped[1]! : s)
  if (v4 !== null) return isBlockedV4(v4)

  const h = ipv6Hextets(s)
  if (!h) return true
  // IPv4-mapped in hex form (::ffff:7f00:1).
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) return isBlockedV4(((h[6]! << 16) | h[7]!) >>> 0)
  if (h.every((x) => x === 0)) return true // ::
  if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return true // ::1
  if ((h[0]! & 0xfe00) === 0xfc00) return true // fc00::/7
  if ((h[0]! & 0xffc0) === 0xfe80) return true // fe80::/10
  return false
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void

/** dns.lookup for undici's connect: every address checked, any blocked one refuses the connection. */
function guardedLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, [])
    const list = addresses as dns.LookupAddress[]
    if (list.length === 0) return callback(Object.assign(new Error(`No addresses for ${hostname}`), { code: "ENOTFOUND" }), [])
    if (list.some((a) => isBlockedIp(a.address))) {
      return callback(new SafeFetchError("blocked", "That URL points to a private or internal address."), [])
    }
    if (options.all) return callback(null, list)
    callback(null, list[0]!.address, list[0]!.family)
  })
}

// One agent for the process: the lookup guard applies to every connection it opens.
const agent = new Agent({ connect: { lookup: guardedLookup as never } })

function assertAllowedUrl(raw: string | URL): URL {
  let url: URL
  try {
    url = new URL(String(raw))
  } catch {
    throw new SafeFetchError("invalid_url", "That doesn't look like a valid URL.")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeFetchError("invalid_url", "Only http/https URLs are supported.")
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new SafeFetchError("blocked", "That URL points to a private or internal address.")
  }
  // A literal IP never goes through lookup, so it's checked here.
  if (isIP(host) && isBlockedIp(host)) {
    throw new SafeFetchError("blocked", "That URL points to a private or internal address.")
  }
  return url
}

/** The SafeFetchError behind an undici failure (it wraps errors from lookup / connect in `cause`). */
function toSafeFetchError(err: unknown, signal: AbortSignal): SafeFetchError {
  if (err instanceof SafeFetchError) return err
  for (let e: unknown = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    if (e instanceof SafeFetchError) return e
    const code = (e as { code?: unknown }).code
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") return new SafeFetchError("dns", "Couldn't resolve that URL's host.")
  }
  if (signal.aborted) return new SafeFetchError("timeout", "That URL took too long to respond.")
  return new SafeFetchError("network", "Couldn't reach that URL.")
}

export interface SafeFetchOptions {
  maxBytes: number
  timeoutMs: number
  /** Checked against the response's content-type before the body is read; false throws. */
  accept?: (contentType: string) => boolean
  headers?: Record<string, string>
}

export interface SafeFetchResult {
  /** The final URL, after redirects. */
  url: string
  res: Response
  /** The whole body. Empty, and not read, for a non-2xx response. */
  body: Buffer
}

export async function safeFetch(rawUrl: string | URL, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  let url = assertAllowedUrl(rawUrl)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs)
  try {
    let res: Response
    for (let hop = 0; ; hop++) {
      try {
        res = await fetch(url, { dispatcher: agent, redirect: "manual", headers: opts.headers, signal: controller.signal })
      } catch (err) {
        throw toSafeFetchError(err, controller.signal)
      }
      const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null
      if (!location) break
      await res.body?.cancel().catch(() => {})
      if (hop >= MAX_REDIRECTS) throw new SafeFetchError("too_many_redirects", "That URL redirected too many times.")
      let next: URL
      try {
        next = new URL(location, url)
      } catch {
        throw new SafeFetchError("redirect", "That URL redirected to an invalid address.")
      }
      if (next.protocol !== "http:" && next.protocol !== "https:") {
        throw new SafeFetchError("redirect", "That URL redirected to an unsupported URL.")
      }
      url = assertAllowedUrl(next)
    }

    if (!res.ok) {
      await res.body?.cancel().catch(() => {})
      return { url: url.toString(), res, body: Buffer.alloc(0) }
    }

    const contentType = res.headers.get("content-type") ?? ""
    if (opts.accept && !opts.accept(contentType)) {
      await res.body?.cancel().catch(() => {})
      throw new SafeFetchError("content_type", `Unexpected content type: ${contentType || "none"}`)
    }

    const declared = Number(res.headers.get("content-length"))
    if (Number.isFinite(declared) && declared > opts.maxBytes) {
      await res.body?.cancel().catch(() => {})
      throw new SafeFetchError("too_large", "That file is too large.")
    }

    const chunks: Buffer[] = []
    let total = 0
    if (res.body) {
      const reader = res.body.getReader()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          total += value.byteLength
          if (total > opts.maxBytes) {
            controller.abort()
            throw new SafeFetchError("too_large", "That file is too large.")
          }
          chunks.push(Buffer.from(value))
        }
      } catch (err) {
        throw toSafeFetchError(err, controller.signal)
      }
    }
    return { url: url.toString(), res, body: Buffer.concat(chunks, total) }
  } finally {
    // Only now: the timeout covers the body read too.
    clearTimeout(timer)
  }
}
