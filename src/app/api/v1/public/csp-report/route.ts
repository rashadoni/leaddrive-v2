/**
 * POST /api/v1/public/csp-report
 *
 * Sink for Content-Security-Policy-Report-Only violations (see withCspHeaders in
 * middleware.ts). Browsers POST here — automatically, unauthenticated — whenever
 * the observe-mode CSP would have blocked something. We log each DISTINCT
 * violation once (grep `[csp-report]` in PM2 logs) so that after a day of real
 * traffic we know exactly what an enforcing policy would break (landing inline
 * scripts, /embed frames, cdn.jsdelivr.net, Unlayer, …) before flipping enforce.
 *
 * Public + rate-limited: lives under /api/v1/public/ so middleware skips auth
 * (browsers can't send a session) and applies the public POST rate-limit. This
 * endpoint only writes to the log — no DB, no side effects — and never throws.
 */
import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

export const runtime = "nodejs"

// In-process dedup: a single broken resource on a busy page would otherwise
// flood the log. We only care about the SET of distinct violations during the
// observe window. PM2 runs one fork, so module state persists across requests.
const seen = new Map<string, number>()

function pick(r: unknown): { directive: string; blocked: string; doc: string } {
  const rec = (r ?? {}) as Record<string, unknown>
  // CSP L2 report-uri wraps as { "csp-report": {...} }; Reporting API as { body: {...} }.
  const b = (rec["csp-report"] ?? rec["body"] ?? rec) as Record<string, unknown>
  const s = (...keys: string[]): string => {
    for (const k of keys) {
      const v = b[k]
      if (typeof v === "string" && v) return v
    }
    return "?"
  }
  return {
    directive: s("effective-directive", "violated-directive", "effectiveDirective"),
    blocked: s("blocked-uri", "blockedURL"),
    doc: s("document-uri", "documentURL"),
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const text = await req.text()
    if (!text || text.length > 16_384) return new NextResponse(null, { status: 204 })
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      return new NextResponse(null, { status: 204 })
    }
    // Reporting API posts an array of reports; report-uri posts a single object.
    const reports = Array.isArray(json) ? json : [json]
    for (const r of reports.slice(0, 20)) {
      const { directive, blocked, doc } = pick(r)
      // Drop the query string: keeps the dedup key stable and avoids logging any
      // tokens that might ride in a document URL.
      const docPath = doc.split("?")[0]
      const key = `${directive}|${blocked}|${docPath}`
      const n = (seen.get(key) ?? 0) + 1
      seen.set(key, n)
      if (n === 1) {
        console.warn(`[csp-report] directive=${directive} blocked=${blocked} doc=${docPath}`)
      }
      if (seen.size > 2000) seen.clear() // safety cap against unbounded growth
    }
  } catch {
    // Telemetry sink — never throw.
  }
  return new NextResponse(null, { status: 204 })
}
