import { z } from "zod"
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { accompaniableAgent, closeManagerJointSessions } from "@/lib/mtm/joint-visit"
import { jointState, openSession, organizationTimezone } from "@/lib/mtm/joint-visit-manager"

/**
 * «Иду на визит с агентом» — the manager's side of a joint visit
 * (src/lib/mtm/joint-visit.ts; owner-approved mockup, 2026-10-20).
 *
 * GET  — the open session, and every visit the manager can see or rate from
 *        it: the agent's visits since the session started, and the visits
 *        agents marked as joint with this manager whose rating window is
 *        still open (until the end of the day after the check-in).
 * POST — start a session with one agent of the manager's team. Another open
 *        session of his is closed first: he is with one agent at a time.
 */

const StartSchema = z.object({ agentId: z.string().trim().min(1).max(128) }).strict()

function refuse(status: number, code: string, error: string) {
  return NextResponse.json({ success: false, error, code }, { status })
}

/** GET /api/v1/mtm/mobile/manager/joint-visit — the manager's joint visit now. */
export const GET = withMobileRls(async (_req, auth) => {
  const forbidden = requireMobileCapability(auth, "TEAM_READ")
  if (forbidden) return forbidden
  try {
    return NextResponse.json({ success: true, data: await jointState(auth) })
  } catch (error) {
    console.error("[MTM/mobile/manager/joint-visit GET]", error)
    return refuse(500, "MTM_JOINT_VISIT_UNAVAILABLE", "Failed to load the joint visit")
  }
}, { requiredCapability: "route-field" })

/** POST /api/v1/mtm/mobile/manager/joint-visit — «Иду на визит с агентом». */
export const POST = withMobileRls(async (req, auth) => {
  const forbidden = requireMobileCapability(auth, "TEAM_READ")
  if (forbidden) return forbidden

  const parsed = StartSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return refuse(400, "MTM_JOINT_VISIT_INVALID", "Choose the agent")

  try {
    const agent = await accompaniableAgent(prisma, {
      organizationId: auth.orgId,
      managerAgentId: auth.agentId,
      managerRole: auth.role,
      agentId: parsed.data.agentId,
    })
    if (!agent) return refuse(403, "MTM_JOINT_VISIT_AGENT_FORBIDDEN", "This agent is not in your team")

    const now = new Date()
    const timezone = await organizationTimezone(auth.orgId)
    const current = await openSession(auth, now, timezone)
    // A second press, or the same choice again: the session already open.
    if (current?.agent.id === agent.id) {
      return NextResponse.json({ success: true, data: await jointState(auth) })
    }

    let sessionId: string
    try {
      sessionId = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await closeManagerJointSessions(tx, { organizationId: auth.orgId, managerAgentId: auth.agentId, now, timezone })
        const session = await tx.mtmJointFieldSession.create({
          data: { organizationId: auth.orgId, managerAgentId: auth.agentId, agentId: agent.id, startedAt: now },
          select: { id: true },
        })
        return session.id
      })
    } catch (error) {
      // Two presses at once: the one open session per manager is the
      // database's rule; the second answers with what the first opened.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return NextResponse.json({ success: true, data: await jointState(auth) })
      }
      throw error
    }

    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: auth.agentId,
      action: "JOINT_VISIT_START",
      entity: "agent",
      entityId: agent.id,
      metadataKind: "joint_visit",
      newData: { sessionId, agentId: agent.id, channel: "mobile" },
      req,
    }).catch((error) => console.warn("[MTM/mobile/manager/joint-visit POST] audit failed", error))

    return NextResponse.json({ success: true, data: await jointState(auth) }, { status: 201 })
  } catch (error) {
    console.error("[MTM/mobile/manager/joint-visit POST]", error)
    return refuse(500, "MTM_JOINT_VISIT_UNAVAILABLE", "Failed to start the joint visit")
  }
}, { requiredCapability: "route-field" })
