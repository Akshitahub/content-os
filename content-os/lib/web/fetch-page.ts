/**
 * Lightweight server-side page fetcher for AI extraction features
 * (brand-from-URL, product-from-URL). Deliberately dependency-free —
 * uses regex-based extraction instead of a full HTML parser, since we
 * only need "good enough" text + meta tags to feed an LLM, not a DOM.
 */

import { safeFetch, SafeFetchError } from "@/lib/web/safe-fetch"

export class PageFetchError extends Error {}

// Any authenticated user can submit a URL here, so it goes through
// safeFetch (lib/web/safe-fetch.ts): private / internal addresses and cloud
// metadata endpoints are refused on every hop, checked on the IP actually
// connected to.

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
const MAX_PAGE_BYTES = 3 * 1024 * 1024

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

/** The user-facing message for a safeFetch failure -- the same wording this module always used. */
function pageFetchErrorFor(err: SafeFetchError): PageFetchError {
  switch (err.code) {
    case "invalid_url":
    case "blocked":
      return new PageFetchError(err.message)
    case "dns":
      return new PageFetchError("Couldn't resolve that URL's host.")
    case "timeout":
      return new PageFetchError("That page took too long to respond.")
    case "too_many_redirects":
      return new PageFetchError("That page redirected too many times.")
    case "redirect":
      return new PageFetchError("That page redirected to an unsupported URL.")
    case "content_type":
      return new PageFetchError("That URL doesn't point to a webpage.")
    case "too_large":
      return new PageFetchError("That page is too large to read.")
    default:
      return new PageFetchError("Couldn't reach that URL. Check it's correct and publicly accessible.")
  }
}

export async function fetchPage(url: string): Promise<FetchedPage> {
  let fetched: Awaited<ReturnType<typeof safeFetch>>
  try {
    fetched = await safeFetch(url, {
      maxBytes: MAX_PAGE_BYTES,
      timeoutMs: FETCH_TIMEOUT_MS,
      accept: (contentType) => contentType.includes("text/html"),
      headers: FETCH_HEADERS,
    })
  } catch (err) {
    if (err instanceof SafeFetchError) throw pageFetchErrorFor(err)
    throw new PageFetchError("Couldn't reach that URL. Check it's correct and publicly accessible.")
  }

  const { res } = fetched
  if (!res.ok) {
    throw new PageFetchError(`That page returned an error (${res.status}). Check the URL is correct.`)
  }

  const html = fetched.body.toString("utf8")
  const parsedUrl = new URL(fetched.url)

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
