import type { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"

/**
 * Return CORS headers that reflect the widget's allowedOrigins whitelist.
 * - If the widget has allowedOrigins configured, only a matching origin is echoed.
 * - If allowedOrigins is empty, we echo the request origin (so the visitor's site works),
 *   but we still never return a literal "*" for credentialed-looking flows.
 *
 * We infer the widget from either:
 *   - `?key=` query string (config/GET requests), or
 *   - the JSON body's `key` field (POST session), or
 *   - the session's organization via `?sessionId=` (message polling).
 *
 * When we can't resolve a widget (missing key, OPTIONS preflight, etc.) we fall back
 * to a permissive echo — browsers will still enforce same-origin for non-simple requests,
 * and CORS here exists mainly to *allow* legitimate cross-site embeds.
 */
export async function buildWidgetCorsHeaders(
  req: NextRequest,
  origin: string | null,
): Promise<Record<string, string>> {
  const allowed = await resolveAllowedOrigins(req)

  let allowOrigin = origin || ""
  if (allowed && allowed.length > 0) {
    allowOrigin = origin && allowed.includes(origin) ? origin : allowed[0] || ""
  } else if (!allowOrigin) {
    allowOrigin = "*"
  }

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  }
}

/** Base domain the app and all tenant subdomains are served under (e.g. "leaddrivecrm.org"). */
const OWN_BASE_DOMAIN = (process.env.NEXT_PUBLIC_BASE_DOMAIN || "leaddrivecrm.org")
  .replace(/^\./, "")
  .toLowerCase()

/**
 * True when `host` is one of the app's own domains: the base domain itself
 * (leaddrivecrm.org) or any subdomain of it (app./www./{tenant}.leaddrivecrm.org).
 */
function isOwnAppHost(host: string): boolean {
  const h = host.toLowerCase().replace(/:\d+$/, "")
  return h === OWN_BASE_DOMAIN || h.endsWith(`.${OWN_BASE_DOMAIN}`)
}

/**
 * Check whether an origin is allowed for a widget. Requests originating from one of
 * the app's OWN domains (the admin dashboard preview, the marketing site, or a tenant
 * subdomain) are ALWAYS allowed — the allowedOrigins whitelist only gates third-party
 * embeds.
 *
 * The own-domain check is derived from static config (NEXT_PUBLIC_BASE_DOMAIN), NOT from
 * request headers. nginx forwards a client-supplied X-Forwarded-Host untouched and its
 * default_server accepts an arbitrary Host, so trusting either header would let a
 * non-browser client pair `Origin: https://evil.test` with a matching forged host and
 * slip past the whitelist.
 */
export function isOriginAllowed(
  origin: string | null,
  allowedOrigins: string[],
): boolean {
  if (!origin) return true
  try {
    if (isOwnAppHost(new URL(origin).hostname)) return true
  } catch {}
  if (allowedOrigins.length === 0) return true
  return allowedOrigins.includes(origin)
}

async function resolveAllowedOrigins(req: NextRequest): Promise<string[] | null> {
  try {
    const url = new URL(req.url)
    const key = url.searchParams.get("key")
    if (key) {
      // RLS: pre-org resolution by public widget key — runs before any tenant
      // context exists (CORS headers are built at the top of every public
      // web-chat route, including OPTIONS preflights). Bypass-scoped lookup only.
      const w = await runWithRlsBypass(() =>
        prisma.webChatWidget.findUnique({
          where: { publicKey: key },
          select: { allowedOrigins: true },
        })
      )
      return w?.allowedOrigins ?? null
    }
    const sessionId = url.searchParams.get("sessionId")
    if (sessionId) {
      // RLS: same pre-org resolution, keyed by the visitor's sessionId.
      const w = await runWithRlsBypass(async () => {
        const s = await prisma.webChatSession.findUnique({
          where: { id: sessionId },
          select: { organizationId: true },
        })
        if (!s) return null
        return await prisma.webChatWidget.findUnique({
          where: { organizationId: s.organizationId },
          select: { allowedOrigins: true },
        })
      })
      return w?.allowedOrigins ?? null
    }
  } catch {}
  return null
}
