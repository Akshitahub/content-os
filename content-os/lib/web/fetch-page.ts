/**
 * Lightweight server-side page fetcher for AI extraction features
 * (brand-from-URL, product-from-URL). Deliberately dependency-free —
 * uses regex-based extraction instead of a full HTML parser, since we
 * only need "good enough" text + meta tags to feed an LLM, not a DOM.
 */

import dns from "node:dns/promises"
import { isIP } from "node:net"

export class PageFetchError extends Error {}

// Blocks SSRF against private/internal networks and cloud metadata
// endpoints (169.254.169.254 in particular — AWS/GCP/Azure instance
// credentials). Any authenticated user can submit a URL here, so this
// can't rely on the caller being trusted.
const BLOCKED_IP_RANGES = [
  /^127\./,                              // loopback
  /^10\./,                               // RFC1918
  /^172\.(1[6-9]|2\d|3[01])\./,          // RFC1918
  /^192\.168\./,                         // RFC1918
  /^169\.254\./,                         // link-local incl. cloud metadata
  /^0\./,                                // "this" network
  /^::1$/,                               // IPv6 loopback
  /^f[cd][0-9a-f]{2}:/i,                 // IPv6 unique local (fc00::/7)
  /^fe80:/i,                             // IPv6 link-local
]

function isBlockedIp(ip: string): boolean {
  return BLOCKED_IP_RANGES.some((re) => re.test(ip))
}

async function assertPublicHost(hostname: string): Promise<void> {
  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) throw new PageFetchError("That URL points to a private or internal address.")
    return
  }
  if (hostname.toLowerCase() === "localhost") {
    throw new PageFetchError("That URL points to a private or internal address.")
  }
  let addresses: string[]
  try {
    const results = await dns.lookup(hostname, { all: true })
    addresses = results.map((r) => r.address)
  } catch {
    throw new PageFetchError("Couldn't resolve that URL's host.")
  }
  if (addresses.length === 0 || addresses.some(isBlockedIp)) {
    throw new PageFetchError("That URL points to a private or internal address.")
  }
}

export interface FetchedPage {
  url: string
  title: string
  metaDescription: string
  ogTitle: string
  ogDescription: string
  ogImages: string[]
  jsonLd: unknown[]
  /** Cleaned, truncated visible text content of the page */
  text: string
  /** Raw HTML (used for image extraction) */
  html: string
}

const MAX_TEXT_LENGTH = 6000
const FETCH_TIMEOUT_MS = 10000

function extractMetaContent(html: string, attr: "name" | "property", key: string): string {
  const re = new RegExp(
    `<meta[^>]*${attr}=["']${key}["'][^>]*content=["']([^"']*)["']`,
    "i"
  )
  const reReversed = new RegExp(
    `<meta[^>]*content=["']([^"']*)["'][^>]*${attr}=["']${key}["']`,
    "i"
  )
  const match = html.match(re) || html.match(reReversed)
  return match?.[1]?.trim() ?? ""
}

function extractJsonLd(html: string): unknown[] {
  const blocks: unknown[] = []
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim())
      blocks.push(parsed)
    } catch {
      // skip malformed JSON-LD blocks
    }
  }
  return blocks
}

function stripTagsToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|p|div|li|h[1-6]|tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
}

const MAX_REDIRECTS = 5
const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  // Do NOT set Accept-Encoding manually — Node's fetch (undici) disables
  // its automatic response decompression when this header is set
  // explicitly, causing res.text() to return raw gzip/brotli bytes
  // instead of decoded HTML. Let fetch negotiate + decompress itself.
  "Connection": "keep-alive",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Cache-Control": "max-age=0",
}

export async function fetchPage(url: string): Promise<FetchedPage> {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new PageFetchError("That doesn't look like a valid URL.")
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new PageFetchError("Only http/https URLs are supported.")
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  let res: Response
  try {
    // Redirects are followed manually (not `redirect: "follow"`) so every
    // hop — not just the URL the user typed — is re-checked against
    // private/internal IP ranges. A malicious or compromised site could
    // otherwise pass the initial check and then 302 straight to
    // 169.254.169.254 or an internal service.
    for (let hop = 0; ; hop++) {
      await assertPublicHost(parsedUrl.hostname)

      res = await fetch(parsedUrl.toString(), {
        signal: controller.signal,
        headers: FETCH_HEADERS,
        redirect: "manual",
      })

      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        if (hop >= MAX_REDIRECTS) {
          throw new PageFetchError("That page redirected too many times.")
        }
        const nextUrl = new URL(res.headers.get("location")!, parsedUrl)
        if (!["http:", "https:"].includes(nextUrl.protocol)) {
          throw new PageFetchError("That page redirected to an unsupported URL.")
        }
        parsedUrl = nextUrl
        continue
      }
      break
    }
  } catch (err) {
    if (err instanceof PageFetchError) throw err
    if (err instanceof Error && err.name === "AbortError") {
      throw new PageFetchError("That page took too long to respond.")
    }
    throw new PageFetchError("Couldn't reach that URL. Check it's correct and publicly accessible.")
  } finally {
    clearTimeout(timeout)
  }

  // TEMPORARY DIAGNOSTIC — remove once decompression fix is confirmed in
  // Vercel logs. Never logs the page URL's query string or any response
  // body beyond a short preview.
  console.log(
    "[fetch-page] response received:",
    "status=", res.status,
    "content-type=", res.headers.get("content-type"),
    "content-encoding=", res.headers.get("content-encoding")
  )

  if (!res.ok) {
    throw new PageFetchError(`That page returned an error (${res.status}). Check the URL is correct.`)
  }

  const contentType = res.headers.get("content-type") ?? ""
  if (!contentType.includes("text/html")) {
    throw new PageFetchError("That URL doesn't point to a webpage.")
  }

  const html = await res.text()

  // TEMPORARY DIAGNOSTIC — remove once decompression fix is confirmed.
  console.log("[fetch-page] decoded text preview:", html.slice(0, 200))

  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  const ogImageMatches = [...html.matchAll(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["']/gi)]

  return {
    url: parsedUrl.toString(),
    title: titleMatch?.[1]?.trim() ?? "",
    metaDescription: extractMetaContent(html, "name", "description"),
    ogTitle: extractMetaContent(html, "property", "og:title"),
    ogDescription: extractMetaContent(html, "property", "og:description"),
    ogImages: ogImageMatches.map((m) => m[1]).filter(Boolean),
    jsonLd: extractJsonLd(html),
    text: stripTagsToText(html).slice(0, MAX_TEXT_LENGTH),
    html: html.slice(0, 200_000),
  }
}
