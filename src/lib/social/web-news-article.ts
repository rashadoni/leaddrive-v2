import dns from "node:dns/promises"
import net from "node:net"

const MAX_ARTICLE_BYTES = 3_000_000
const FETCH_TIMEOUT_MS = 8_000
const MAX_REDIRECTS = 3
const MAX_ARTICLE_AGE_MS = 90 * 24 * 60 * 60 * 1_000
const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1_000

export type VerifiedWebNewsArticle = {
  url: string
  publisherName: string
  publisherDomain: string
  headline: string
  description: string | null
  authorName: string | null
  imageUrl: string | null
  publishedAt: Date
  matchedCorpus: string
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    hellip: "…",
    lt: "<",
    nbsp: " ",
    quot: "\"",
  }
  return value
    .replace(/&#(\d+);/gu, (_match, raw: string) => String.fromCodePoint(Number(raw)))
    .replace(/&#x([0-9a-f]+);/giu, (_match, raw: string) => String.fromCodePoint(Number.parseInt(raw, 16)))
    .replace(/&([a-z]+);/giu, (match, entity: string) => named[entity.toLowerCase()] ?? match)
}

function flattenJsonLd(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd)
  const item = record(value)
  if (Object.keys(item).length === 0) return []
  const graph = Array.isArray(item["@graph"]) ? item["@graph"].flatMap(flattenJsonLd) : []
  return [item, ...graph]
}

function jsonLdTypes(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string")
  return []
}

function isNewsArticle(value: Record<string, unknown>): boolean {
  return jsonLdTypes(value["@type"]).some(type =>
    /^(?:newsarticle|reportagenewsarticle|analysisnewsarticle)$/iu.test(type),
  )
}

function imageFromJsonLd(value: unknown): string | null {
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const image = imageFromJsonLd(item)
      if (image) return image
    }
    return null
  }
  const item = record(value)
  return stringValue(item.url) || stringValue(item.contentUrl)
}

function namedEntity(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null
  if (Array.isArray(value)) {
    return value.map(namedEntity).filter(Boolean).join(", ") || null
  }
  return stringValue(record(value).name)
}

function absoluteHttpUrl(value: string | null, baseUrl: string): string | null {
  if (!value) return null
  try {
    const url = new URL(value, baseUrl)
    return url.protocol === "https:" ? url.toString() : null
  } catch {
    return null
  }
}

function canonicalFromHtml(html: string, pageUrl: string): string {
  const canonicalTag = [...html.matchAll(/<link\b[^>]*>/giu)].find(match =>
    /\brel\s*=\s*(["'])canonical\1/iu.test(match[0]),
  )?.[0]
  const raw = canonicalTag?.match(/\bhref\s*=\s*(["'])(.*?)\1/iu)?.[2] ?? null
  return absoluteHttpUrl(raw, pageUrl) ?? pageUrl
}

function normalizedImage(value: unknown, pageUrl: string): string | null {
  return absoluteHttpUrl(imageFromJsonLd(value), pageUrl)
}

export function parseVerifiedWebNewsArticle(
  html: string,
  pageUrl: string,
  now = new Date(),
): VerifiedWebNewsArticle | null {
  let page: URL
  try {
    page = new URL(pageUrl)
  } catch {
    return null
  }
  if (!isAzerbaijanNewsHost(page.hostname)) return null

  const scripts = html.matchAll(
    /<script\b[^>]*\btype\s*=\s*(["'])application\/ld\+json(?:\s*;\s*charset=[^"']+)?\1[^>]*>([\s\S]*?)<\/script>/giu,
  )
  const nodes: Record<string, unknown>[] = []
  for (const match of scripts) {
    try {
      nodes.push(...flattenJsonLd(JSON.parse(decodeHtmlEntities(match[2]).trim())))
    } catch {
      // One broken JSON-LD block must not hide a valid NewsArticle block later.
    }
  }
  const article = nodes.find(isNewsArticle)
  if (!article) return null

  const headline = stringValue(article.headline) || stringValue(article.name)
  const rawDate = stringValue(article.datePublished) || stringValue(article.dateCreated)
  if (!headline || !rawDate) return null

  const publishedAt = new Date(rawDate)
  if (!Number.isFinite(publishedAt.getTime())) return null
  if (publishedAt.getTime() < now.getTime() - MAX_ARTICLE_AGE_MS) return null
  if (publishedAt.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS) return null

  const canonicalUrl = canonicalFromHtml(html, pageUrl)
  let canonical: URL
  try {
    canonical = new URL(canonicalUrl)
  } catch {
    return null
  }
  if (!isAzerbaijanNewsHost(canonical.hostname)) return null

  const description = stringValue(article.description) || stringValue(article.abstract)
  const publisherName = namedEntity(article.publisher) || page.hostname.replace(/^www\./u, "")
  const authorName = namedEntity(article.author)
  const imageUrl = normalizedImage(article.image, canonical.toString())
  const matchedCorpus = [
    headline,
    description,
    authorName,
    publisherName,
  ].filter(Boolean).join("\n")

  return {
    url: canonical.toString(),
    publisherName,
    publisherDomain: canonical.hostname.replace(/^www\./u, ""),
    headline,
    description,
    authorName,
    imageUrl,
    publishedAt,
    matchedCorpus,
  }
}

export function isAzerbaijanNewsHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/u, "")
  if (host === "az" || host.endsWith(".az")) return true
  const configured = (process.env.GOOGLE_ALERTS_AZ_HOST_ALLOWLIST || "")
    .split(",")
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)
  return configured.some(allowed => host === allowed || host.endsWith(`.${allowed}`))
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number)
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return true
  const [a, b, c] = octets
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224
}

function isPrivateIp(address: string): boolean {
  if (net.isIPv4(address)) return isPrivateIpv4(address)
  if (!net.isIPv6(address)) return true
  const normalized = address.toLowerCase()
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1]
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4)
  return normalized === "::"
    || normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe8")
    || normalized.startsWith("fe9")
    || normalized.startsWith("fea")
    || normalized.startsWith("feb")
    || normalized.startsWith("ff")
    || normalized.startsWith("2001:db8:")
}

async function assertPublicAzerbaijanUrl(rawUrl: string): Promise<URL> {
  const url = new URL(rawUrl)
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("unsafe_url")
  }
  if (!isAzerbaijanNewsHost(url.hostname)) throw new Error("outside_azerbaijan")
  if (net.isIP(url.hostname)) {
    if (isPrivateIp(url.hostname)) throw new Error("private_address")
    return url
  }

  const addresses = await Promise.race([
    dns.lookup(url.hostname, { all: true, verbatim: true }),
    new Promise<never>((_resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("dns_timeout")), 3_000)
      timeout.unref()
    }),
  ])
  if (addresses.length === 0 || addresses.some(item => isPrivateIp(item.address))) {
    throw new Error("private_address")
  }
  return url
}

async function readLimitedHtml(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ARTICLE_BYTES) {
    throw new Error("article_too_large")
  }
  if (!response.body) return ""

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let html = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_ARTICLE_BYTES) {
      await reader.cancel()
      throw new Error("article_too_large")
    }
    html += decoder.decode(value, { stream: true })
  }
  return html + decoder.decode()
}

export async function fetchVerifiedWebNewsArticle(
  rawUrl: string,
  options: {
    now?: Date
    fetchImpl?: typeof fetch
  } = {},
): Promise<VerifiedWebNewsArticle | null> {
  const fetchImpl = options.fetchImpl ?? fetch
  let current = await assertPublicAzerbaijanUrl(rawUrl)

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetchImpl(current, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "LeadDrive-News-Monitor/1.0",
      },
    })

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      if (!location || redirect === MAX_REDIRECTS) return null
      current = await assertPublicAzerbaijanUrl(new URL(location, current).toString())
      continue
    }
    if (!response.ok) return null
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
    if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return null
    }
    const html = await readLimitedHtml(response)
    return parseVerifiedWebNewsArticle(html, current.toString(), options.now)
  }
  return null
}
