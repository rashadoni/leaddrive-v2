export type GoogleAlertCandidate = {
  title: string
  snippet: string | null
  url: string
}

export type ParsedGoogleAlertEmail = {
  query: string
  candidates: GoogleAlertCandidate[]
}

const GOOGLE_HOST = /(^|\.)google\.[a-z.]+$/iu
const MAX_CANDIDATES = 12

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    hellip: "…",
    laquo: "«",
    lt: "<",
    nbsp: " ",
    quot: "\"",
    raquo: "»",
  }
  return value
    .replace(/&#(\d+);/gu, (_match, raw: string) => String.fromCodePoint(Number(raw)))
    .replace(/&#x([0-9a-f]+);/giu, (_match, raw: string) => String.fromCodePoint(Number.parseInt(raw, 16)))
    .replace(/&([a-z]+);/giu, (match, entity: string) => named[entity.toLowerCase()] ?? match)
}

function plainText(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<style[\s\S]*?<\/style>/giu, " ")
      .replace(/<script[\s\S]*?<\/script>/giu, " ")
      .replace(/<br\s*\/?>/giu, " ")
      .replace(/<[^>]+>/gu, " "),
  ).replace(/\s+/gu, " ").trim()
}

export function googleAlertQueryFromSubject(subject: string | null | undefined): string | null {
  if (!subject) return null
  const decoded = decodeHtmlEntities(subject).trim()
  const match = decoded.match(/^\s*google\s+alert(?:s)?\s*[-–—:]\s*(.+?)\s*$/iu)
  return match?.[1]?.trim() || null
}

export function unwrapGoogleAlertUrl(rawHref: string): string | null {
  const decoded = decodeHtmlEntities(rawHref).trim()
  if (!decoded || /^(?:mailto|javascript|data):/iu.test(decoded)) return null

  let parsed: URL
  try {
    parsed = new URL(decoded)
  } catch {
    return null
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return null

  if (GOOGLE_HOST.test(parsed.hostname)) {
    const target = parsed.searchParams.get("url")
      || parsed.searchParams.get("q")
      || parsed.searchParams.get("u")
    if (!target) return null
    try {
      parsed = new URL(target)
    } catch {
      return null
    }
  }

  if (!["http:", "https:"].includes(parsed.protocol) || GOOGLE_HOST.test(parsed.hostname)) return null
  parsed.hash = ""
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(?:utm_.+|gclid|fbclid|ved|usg)$/iu.test(key)) parsed.searchParams.delete(key)
  }
  return parsed.toString()
}

function snippetAfterAnchor(html: string, anchorEnd: number): string | null {
  const boundary = html.slice(anchorEnd, anchorEnd + 900).split(/<a\b/iu)[0] ?? ""
  const snippet = plainText(boundary)
    .replace(/^(?:\s*[-–—|·]\s*)+/u, "")
    .slice(0, 420)
    .trim()
  return snippet.length >= 20 ? snippet : null
}

export function parseGoogleAlertEmail(input: {
  subject?: string | null
  html?: string | null
  text?: string | null
}): ParsedGoogleAlertEmail | null {
  const query = googleAlertQueryFromSubject(input.subject)
  if (!query) return null

  const html = input.html || ""
  const candidates: GoogleAlertCandidate[] = []
  const seen = new Set<string>()
  const anchorPattern = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/giu

  for (const match of html.matchAll(anchorPattern)) {
    const url = unwrapGoogleAlertUrl(match[2])
    if (!url || seen.has(url)) continue
    const title = plainText(match[3]).slice(0, 300)
    if (title.length < 4) continue
    seen.add(url)
    candidates.push({
      title,
      snippet: snippetAfterAnchor(html, (match.index ?? 0) + match[0].length),
      url,
    })
    if (candidates.length >= MAX_CANDIDATES) break
  }

  // Plain-text alerts are a fallback only. The article page remains the source
  // of truth, so a bare URL is acceptable here and is verified later.
  if (candidates.length === 0 && input.text) {
    const urls = input.text.match(/https?:\/\/[^\s<>"')\]]+/giu) ?? []
    for (const rawUrl of urls) {
      const url = unwrapGoogleAlertUrl(rawUrl.replace(/[.,;:!?]+$/u, ""))
      if (!url || seen.has(url)) continue
      seen.add(url)
      candidates.push({ title: query, snippet: null, url })
      if (candidates.length >= MAX_CANDIDATES) break
    }
  }

  return { query, candidates }
}

export function isAuthenticatedGoogleAlertSender(input: {
  headerFrom?: string | null
  authenticationResults?: string | null
}): boolean {
  const from = input.headerFrom?.toLowerCase() ?? ""
  if (!/(?:^|[<\s])googlealerts-noreply@google\.com(?:[>\s]|$)/u.test(from)) return false

  const auth = input.authenticationResults?.toLowerCase() ?? ""
  return /\bdkim=pass\b/u.test(auth) && /\b(?:header\.)?d=google\.com\b/u.test(auth)
}
