import { z } from "zod"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { requireMobilePermission } from "@/lib/mtm/mobile-capabilities"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"

/**
 * Where a push can be delivered.
 *
 * Firebase gives the app a token for the installation and rotates it on its
 * own, so the app re-registers whenever it has a new one. The token is an
 * address, not a credential: it says which phone to knock on, and the payload
 * an agent receives still comes from this server under their own session.
 *
 * Signing out removes the row, because the next person to sign in on that
 * phone must not receive the previous agent's notifications.
 */

const registerSchema = z.object({
  token: z.string().trim().min(20).max(4096),
  platform: z.enum(["android", "ios"]).optional(),
  deviceId: z.string().trim().max(200).optional().nullable(),
  appVersion: z.string().trim().max(64).optional().nullable(),
})

const removeSchema = z.object({
  token: z.string().trim().min(20).max(4096),
})

type MobileAuth = Parameters<Parameters<typeof withMobileRls>[0]>[1]

/**
 * The agent this request belongs to, or null when the token is not a field
 * agent's. Takes the handler's own auth object so the narrowing the mobile
 * middleware already did is not thrown away and rebuilt by hand.
 */
async function fieldAgent(auth: MobileAuth): Promise<string | null> {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor?.agentId || actor.role !== "AGENT" || actor.agentId !== auth.agentId) return null
  return actor.agentId
}

export const POST = withMobileRls(async (req, auth) => {
  const permission = requireMobilePermission(auth, "ROUTE_EXECUTE")
  if (permission) return permission
  const agentId = await fieldAgent(auth)
  if (!agentId) {
    return NextResponse.json({ error: "Forbidden", code: "MTM_ROUTE_FIELD_AGENT_REQUIRED" }, { status: 403 })
  }
  const parsed = registerSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid request" }, { status: 400 })
  }
  const body = parsed.data

  // One row per token inside the tenant. The same phone handed to another
  // agent re-registers the token under the new owner rather than delivering
  // to both.
  const saved = await prisma.mtmDeviceToken.upsert({
    where: { organizationId_token: { organizationId: auth.orgId, token: body.token } },
    create: {
      organizationId: auth.orgId,
      agentId,
      token: body.token,
      platform: body.platform ?? "android",
      deviceId: body.deviceId ?? null,
      appVersion: body.appVersion ?? null,
    },
    update: {
      agentId,
      platform: body.platform ?? "android",
      deviceId: body.deviceId ?? null,
      appVersion: body.appVersion ?? null,
      lastSeenAt: new Date(),
      disabledAt: null,
    },
    select: { id: true, lastSeenAt: true },
  })

  // A device that changed its token leaves the old one behind; FCM would keep
  // accepting it for a while and the agent would get everything twice.
  if (body.deviceId) {
    await prisma.mtmDeviceToken.updateMany({
      where: {
        organizationId: auth.orgId,
        deviceId: body.deviceId,
        token: { not: body.token },
        disabledAt: null,
      },
      data: { disabledAt: new Date() },
    })
  }

  return NextResponse.json({ success: true, data: saved })
}, { requiredCapability: "route-field" })

export const DELETE = withMobileRls(async (req, auth) => {
  const permission = requireMobilePermission(auth, "ROUTE_EXECUTE")
  if (permission) return permission
  const agentId = await fieldAgent(auth)
  if (!agentId) {
    return NextResponse.json({ error: "Forbidden", code: "MTM_ROUTE_FIELD_AGENT_REQUIRED" }, { status: 403 })
  }
  const parsed = removeSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid request" }, { status: 400 })
  }

  // Deleted, not disabled: a sign-out is the agent saying "not this phone any
  // more", and keeping the row would keep the address alive.
  const removed = await prisma.mtmDeviceToken.deleteMany({
    where: { organizationId: auth.orgId, agentId, token: parsed.data.token },
  })

  return NextResponse.json({ success: true, data: { removed: removed.count } })
}, { requiredCapability: "route-field" })
