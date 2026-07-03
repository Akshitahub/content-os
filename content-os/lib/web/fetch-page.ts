/**
 * Lightweight server-side page fetcher for AI extraction features
 * (brand-from-URL, product-from-URL). Deliberately dependency-free —
 * uses regex-based extraction instead of a full HTML parser, since we
 * only need "good enough" text + meta tags to feed an LLM, not a DOM.
 */

export class PageFetchError extends Error {}

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
    res = await fetch(parsedUrl.toString(), {
      signal: controller.signal,
      headers: {
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
      },
      redirect: "follow",
    })
  } catch (err) {
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
