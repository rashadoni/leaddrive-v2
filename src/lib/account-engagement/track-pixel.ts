/**
 * C5 Account Engagement — Phase 4: first-party web-tracking pixel helpers.
 *
 * Pure (no Prisma / no request access) → unit-testable. The public
 * /api/v1/public/track route uses these to (a) drop obvious bots before any
 * DB work and (b) classify a page-view URL into a high-intent vs research
 * SignalKind. Attribution (visitor → contact → company → account) and the
 * signal write are handled by the route via the shared Phase-2 recorder.
 */
import type { SignalKind } from "./types"

/**
 * URL path fragments that signal active buying intent. A page view on any of
 * these → page_view_high_intent; everything else → page_view_research.
 * Matched case-insensitively against the URL path (substring).
 */
export const HIGH_INTENT_PATH_PATTERNS: readonly string[] = [
  "pricing",
  "/demo",
  "request-demo",
  // ru-market slugs (C3): leading slash anchors a path segment so that e.g.
  // "/оценка" (assessment) does NOT match "/цен" the way a bare "цен" would.
  // Matched against the DECODED path — see classifyPageUrl.
  "/тариф",
  "/цен",
  "/прайс",
  "/купить",
  "/корзин",
  "/демо",
  "/заказ",
  "/buy",
  "/checkout",
  "/trial",
  "free-trial",
  "/quote",
  "get-started",
  "contact-sales",
  "/upgrade",
  "book-a-call",
  "schedule",
]

/**
 * Classify a page-view URL into an intent SignalKind. Invalid/empty URLs fall
 * back to the conservative research kind. Only the path + query are inspected
 * (host is ignored — the tenant is already resolved by orgId).
 */
export function classifyPageUrl(url: string | null | undefined): SignalKind {
  if (typeof url !== "string" || !url.trim()) return "page_view_research"
  let path = url.trim().toLowerCase()
  // Reduce to path+query when a full URL is supplied; tolerate bare paths.
  try {
    const u = new URL(url, "https://placeholder.local")
    path = (u.pathname + u.search).toLowerCase()
  } catch {
    // keep the raw lowercased string
  }
  // Cyrillic slugs arrive percent-encoded in URL paths — decode so the
  // ru-market fragments above can match. Malformed escapes keep the raw form.
  try {
    path = decodeURIComponent(path)
  } catch {
    // keep the encoded form
  }
  for (const frag of HIGH_INTENT_PATH_PATTERNS) {
    if (path.includes(frag)) return "page_view_high_intent"
  }
  return "page_view_research"
}

/**
 * Bot / non-human user-agent patterns. Conservative substring match (lowercase)
 * — the cost of dropping a rare real visitor is far lower than letting crawlers
 * inflate intent. An empty/missing UA is treated as a bot.
 */
export const BOT_UA_PATTERNS: readonly string[] = [
  "bot",
  "crawl",
  "spider",
  "slurp",
  "headless",
  "phantom",
  "puppeteer",
  "playwright",
  "selenium",
  "curl",
  "wget",
  "python-requests",
  "axios",
  "go-http-client",
  "scrapy",
  "httpclient",
  "facebookexternalhit",
  "preview",
  "monitor",
  "pingdom",
  "uptimerobot",
]

export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (typeof ua !== "string" || !ua.trim()) return true
  const lower = ua.toLowerCase()
  return BOT_UA_PATTERNS.some((p) => lower.includes(p))
}
