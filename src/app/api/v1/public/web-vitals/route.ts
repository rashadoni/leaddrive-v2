/**
 * POST /api/v1/public/web-vitals — sink for the browser's page-speed beacon
 * (src/lib/telemetry/web-vitals.ts, src/components/web-vitals-reporter.tsx).
 *
 * Public like the CSP report sink: sendBeacon fires while the tab is closing,
 * when a session check cannot be relied on, and the body holds only timings
 * and a normalised route. Rate-limited per address in src/proxy.ts with its
 * own bucket, so an office behind one address does not use up the 10/min
 * public lead-form bucket. Writes one log line — no DB — and never throws.
 */
import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { parseWebVitalsBeacon, webVitalsLogLine } from "@/lib/telemetry/web-vitals"

export const runtime = "nodejs"

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // Only the CRM's own pages report; a cross-site POST is dropped silently.
    const site = req.headers.get("sec-fetch-site")
    if (site && site !== "same-origin") return new NextResponse(null, { status: 204 })
    const beacon = parseWebVitalsBeacon(await req.text())
    if (beacon) process.stdout.write(`${webVitalsLogLine(beacon)}\n`)
  } catch {
    // Telemetry sink — never throw.
  }
  return new NextResponse(null, { status: 204 })
}
