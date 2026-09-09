import { NextResponse } from "next/server"
import { withMobileRls } from "@/lib/with-mobile-rls"

/**
 * GET /api/v1/mtm/mobile/ping
 *
 * Server discovery for the field-agent mobile app. Anonymous by necessity:
 * the app calls this from its ServerScreen before anyone has logged in, so a
 * 401 here would leave a new device unable to find the server at all.
 *
 * Because it is anonymous, it intentionally returns no tenant, product, build,
 * or protocol metadata. It used to read
 * `organization.findFirst({ orderBy: { createdAt: "asc" } })` and return that
 * row's name; a later hardening pass replaced the row with constants, but even
 * a static version string is unnecessary reconnaissance data on a public
 * endpoint. The released Android client already treats the optional display
 * name as a convenience and falls back to the entered host.
  */
export function GET() {
  return NextResponse.json(
    { success: true, data: {} },
    { headers: { "Cache-Control": "no-store" } },
  )
}

/**
 * POST /api/v1/mtm/mobile/ping
 *
 * Compatibility acknowledgement for older mobile clients. Presence is a GPS
 * fact, not a login/heartbeat fact: only an accepted coordinate from an
 * active workday may make an agent appear online on the manager map. Keeping
 * this endpoint write-free prevents a tablet left on a desk from pretending
 * that its owner is in the field.
 */
export const POST = withMobileRls(async (req, auth) => {
  void req
  void auth
  return NextResponse.json({ success: true, data: { presence: "GPS_REQUIRED" } })
})
