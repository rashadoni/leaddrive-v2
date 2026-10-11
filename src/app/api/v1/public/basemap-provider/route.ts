import { NextResponse } from "next/server"
import { basemapProviderFromEnv } from "@/lib/mtm/basemap-provider"

// Read from the running server's environment on every question: an answer
// frozen at build time is the one thing this route exists to avoid.
export const dynamic = "force-dynamic"

/**
 * GET /api/v1/public/basemap-provider
 *
 * Whose tiles the MTM maps fall back to, and whether that backup is the
 * background now — as the running deployment says it at this moment
 * (src/lib/mtm/basemap-provider.ts). The same thing every page is told in
 * its <meta> when it is loaded; a page that is already open asks here, so
 * that an operator's switch reaches it without a reload
 * (src/lib/mtm/basemap-provider-store.ts).
 *
 * Public, like the tile address itself: the address carries the provider's
 * browser-facing key, which every map of every visitor sends to that provider
 * anyway — the stranger's page of a location link included. No tenant, no
 * session, no database.
 */
export async function GET() {
  return NextResponse.json(
    { success: true, data: basemapProviderFromEnv() },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, private", Pragma: "no-cache" } },
  )
}
