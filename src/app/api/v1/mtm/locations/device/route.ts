import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { isAgentInRouteScope, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { checkRateLimit } from "@/lib/rate-limit"

// Asked for when the card's block is opened and when the employee's row
// changes. A dispatcher going down the list opens about a card a second —
// the same rhythm, and the same allowance, as the card's street lookup.
const RATE_LIMIT = { maxRequests: 60, windowMs: 60_000 }

/**
 * What a version looks like — the shape `safeApkVersion` accepts in
 * src/lib/mtm/mobile-gps-telemetry.ts («2.4.1», «2.4.1+153»). The phone sends
 * the field as free text of up to 64 characters; only what reads as a version
 * is shown to a dispatcher as one.
 */
const APP_VERSION_SHAPE = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:\+\d{1,10})?$/
/** The only platforms the registration writes (route-field/device-tokens). */
const PLATFORMS: ReadonlySet<string> = new Set(["android", "ios"])

type TokenRow = Prisma.MtmDeviceTokenGetPayload<{
  select: { platform: true; appVersion: true; lastSeenAt: true }
}>

function agentNotFound() {
  return NextResponse.json({ error: "Agent not found" }, { status: 404 })
}

/**
 * GET /api/v1/mtm/locations/device?agentId=
 *
 * What the selected employee's phone said about itself when it last
 * registered for notifications, for the «device» block of the live map's
 * card: whether there is an address a notification can be sent to, the
 * platform, the application's version and when that was reported. The battery,
 * the accuracy and the last contact are not here — the roster row already
 * carries them, and the card shows them without asking.
 *
 * Only those four values leave the server. The token is the address a push is
 * sent to and the device id tells one installation from another: neither is a
 * dispatcher's business, and neither is selected.
 *
 * Nothing else about a phone is stored — not the permission it was given, not
 * whether its GPS is switched off, not its model — so nothing else is
 * answered, and the card must not word a guess as one of them.
 */
export const GET = withRouteFieldWebRlsAuth("read", async (req, auth) => {
  const orgId = auth.orgId
  const agentId = new URL(req.url).searchParams.get("agentId")?.trim() || ""
  try {
    const actor = await resolveMtmRouteActor(prisma, {
      organizationId: orgId,
      userId: auth.userId,
      webRole: auth.role,
      // The web-only wrapper has already rejected mobile JWTs.
      agentId: null,
    })
    // The live map itself is the managers' screen (see GET /api/v1/mtm/locations).
    if (!actor || actor.role === "AGENT") {
      return NextResponse.json({ error: "Manager access required" }, { status: 403 })
    }
    if (!checkRateLimit(`mtm-live-map-device:${orgId}:${auth.userId}`, RATE_LIMIT)) {
      return NextResponse.json(
        { error: "Refresh rate limit exceeded", retryAfterSeconds: 60 },
        { status: 429, headers: { "Retry-After": "60" } },
      )
    }
    if (!agentId) {
      return NextResponse.json({ error: "agentId is required" }, { status: 400 })
    }
    // Somebody else's employee and one who does not exist get the same
    // answer, and for the first nothing is read at all.
    if (!isAgentInRouteScope(actor, agentId)) return agentNotFound()
    const agent = await prisma.mtmAgent.findFirst({
      where: { id: agentId, organizationId: orgId, status: "ACTIVE" },
      select: { id: true },
    })
    if (!agent) return agentNotFound()

    // A token FCM has given up on is kept, marked, for the history; it is not
    // a phone that can be reached. Of several live ones the newest speaks.
    const token = await prisma.mtmDeviceToken.findFirst({
      where: { organizationId: orgId, agentId, disabledAt: null },
      orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
      select: { platform: true, appVersion: true, lastSeenAt: true },
    }) as TokenRow | null

    const appVersion = token?.appVersion?.trim() ?? ""
    // Each registration stamps the row, so this is when the phone last said the rest.
    const registered = token ? token.lastSeenAt : null

    return NextResponse.json({
      success: true,
      data: {
        notificationsConnected: Boolean(token),
        platform: token && PLATFORMS.has(token.platform) ? token.platform : null,
        appVersion: APP_VERSION_SHAPE.test(appVersion) ? appVersion : null,
        registeredAt: registered instanceof Date && Number.isFinite(registered.getTime()) ? registered.toISOString() : null,
      },
    })
  } catch (e) {
    console.error("[MTM/locations/device GET]", e)
    return NextResponse.json({ error: "Failed to load device", code: "MTM_LIVE_MAP_DEVICE_FAILED" }, { status: 500 })
  }
})
