import type { Prisma } from "@prisma/client"
import { requireAttendanceSelf, lockAttendanceRequests } from "@/lib/mtm/attendance-self-access"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { z } from "zod"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { hasMobileCapability, requireMobilePermission } from "@/lib/mtm/mobile-capabilities"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { pushConfigured } from "@/lib/mtm/push-send"

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
 * The owner of this notification address. Field agents retain their existing
 * rule; other roles require explicit attendance enrollment. The handler's
 * freshly resolved identity is the sole source of the owner ID.
 */
/** A manager signed in to the app's manager tabs (2026-10-17) registers his
 * own address on his team grant; he need not be in attendance himself. */
function isTeamPrincipal(auth: MobileAuth): boolean {
  return ["MANAGER", "SUPERVISOR", "ADMIN"].includes(auth.role) && hasMobileCapability(auth.role, "TEAM_READ")
}

async function ownDeviceAgent(auth: MobileAuth): Promise<string | null> {
  if (isTeamPrincipal(auth)) {
    const card = await prisma.mtmAgent.findFirst({ where: { id: auth.agentId, organizationId: auth.orgId, status: "ACTIVE" }, select: { id: true } })
    return card?.id ?? null
  }
  if (auth.role !== "AGENT") {
    try {
      await requireAttendanceSelf(prisma, { organizationId: auth.orgId, agentId: auth.agentId, role: auth.role })
      return auth.agentId
    } catch (error) { if (error instanceof AttendanceRequestError) return null; throw error }
  }
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor?.agentId || actor.role !== "AGENT" || actor.agentId !== auth.agentId) return null
  return actor.agentId
}

/** Enrollment authorizes only an own notification address, never field
 * execution. Recheck under the same feature/employee locks as own requests. */
async function writeOwnToken(auth: MobileAuth, write: (tx: Prisma.TransactionClient) => Promise<NextResponse>): Promise<NextResponse> {
  try {
    if (auth.role === "AGENT" || isTeamPrincipal(auth)) return await write(prisma)
    return await prisma.$transaction(async tx => {
      const self = { organizationId: auth.orgId, agentId: auth.agentId, role: auth.role }
      await lockAttendanceRequests(tx, self)
      await requireAttendanceSelf(tx, self)
      return write(tx)
    })
  } catch (error) {
    if (error instanceof AttendanceRequestError) return NextResponse.json({ error: error.code, code: error.code }, { status: error.status })
    throw error
  }
}

export const POST = withMobileRls(async (req, auth) => {
  const permission = auth.role === "AGENT" ? requireMobilePermission(auth, "ROUTE_EXECUTE") : null
  if (permission) return permission
  const agentId = await ownDeviceAgent(auth)
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
  return writeOwnToken(auth, async tx => {
    const saved = await tx.mtmDeviceToken.upsert({
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
    await tx.mtmDeviceToken.updateMany({
      where: {
        organizationId: auth.orgId,
        deviceId: body.deviceId,
        token: { not: body.token },
        disabledAt: null,
      },
      data: { disabledAt: new Date() },
    })
  }

  // Whether this deployment can send at all. The app shows it on the
  // notifications screen: a phone whose address arrived but whose server has
  // no key is silent for a reason nobody could see from the phone, and an
  // agent who believes the phone will buzz stops opening the app.
  return NextResponse.json({ success: true, data: { ...saved, pushEnabled: pushConfigured() } })
  })
}, { requiredCapability: ["route-field", "personnel"] })

export const DELETE = withMobileRls(async (req, auth) => {
  const permission = auth.role === "AGENT" ? requireMobilePermission(auth, "ROUTE_EXECUTE") : null
  if (permission) return permission
  const agentId = await ownDeviceAgent(auth)
  if (!agentId) {
    return NextResponse.json({ error: "Forbidden", code: "MTM_ROUTE_FIELD_AGENT_REQUIRED" }, { status: 403 })
  }
  const parsed = removeSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid request" }, { status: 400 })
  }

  // Deleted, not disabled: a sign-out is the agent saying "not this phone any
  // more", and keeping the row would keep the address alive.
  return writeOwnToken(auth, async tx => {
    const removed = await tx.mtmDeviceToken.deleteMany({
      where: { organizationId: auth.orgId, agentId, token: parsed.data.token },
  })

  return NextResponse.json({ success: true, data: { removed: removed.count } })
  })
}, { requiredCapability: ["route-field", "personnel"] })
