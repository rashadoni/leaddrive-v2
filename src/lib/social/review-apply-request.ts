import { NextRequest, NextResponse } from "next/server"

function firstForwardedValue(value: string | null): string | null {
  const first = value?.split(",", 1)[0]?.trim().toLowerCase()
  return first || null
}

/**
 * Next standalone builds req.nextUrl from its internal bind address
 * (127.0.0.1:3001 in production), so it is not the browser-visible origin
 * behind nginx. The canonical nginx config overwrites Host and
 * X-Forwarded-Proto before proxying; use those public request values while
 * deliberately ignoring the client-spoofable X-Forwarded-Host header.
 */
function publicRequestOrigin(req: NextRequest): string | null {
  const host = req.headers.get("host")?.trim()
  if (!host) return req.nextUrl.origin
  if (host.length > 512 || /[\\/?#@\s,]/u.test(host)) return null

  const forwardedProtocol = firstForwardedValue(req.headers.get("x-forwarded-proto"))
  const requestProtocol = req.nextUrl.protocol.replace(/:$/u, "").toLowerCase()
  const protocol = forwardedProtocol ?? requestProtocol
  if (protocol !== "http" && protocol !== "https") return null

  try {
    const parsed = new URL(`${protocol}://${host}`)
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      return null
    }
    return parsed.origin
  } catch {
    return null
  }
}

/**
 * Auto-review apply is an interactive administrator action. It is deliberately
 * unavailable to API keys/mobile bearer tokens and rejects explicit
 * cross-origin mutation requests before parsing a body.
 */
export function guardInteractiveJsonMutation(req: NextRequest): NextResponse | null {
  if (req.headers.has("authorization")) {
    return NextResponse.json({ error: "interactive_session_required" }, { status: 403 })
  }
  const contentType = req.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
  if (contentType !== "application/json") {
    return NextResponse.json({ error: "application_json_required" }, { status: 415 })
  }
  const fetchSite = req.headers.get("sec-fetch-site")?.trim().toLowerCase()
  if (fetchSite && fetchSite !== "same-origin") {
    return NextResponse.json({ error: "cross_origin_request_rejected" }, { status: 403 })
  }
  const origin = req.headers.get("origin")
  if (origin) {
    try {
      const expectedOrigin = publicRequestOrigin(req)
      if (!expectedOrigin || new URL(origin).origin !== expectedOrigin) {
        return NextResponse.json({ error: "cross_origin_request_rejected" }, { status: 403 })
      }
    } catch {
      return NextResponse.json({ error: "cross_origin_request_rejected" }, { status: 403 })
    }
  }
  return null
}
