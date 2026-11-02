import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { isDateKey } from "@/lib/mtm/mobile-week"
import { accompaniableAgent } from "@/lib/mtm/joint-visit"
import { jointState, organizationTimezone } from "@/lib/mtm/joint-visit-manager"
import {
  JointVisitPlanError,
  JointVisitPlanInputSchema,
  createJointVisitPlans,
  jointPlanDay,
  jointPlanWindow,
} from "@/lib/mtm/joint-visit-plan"
import { notifyAgentOfJointVisitPlan } from "@/lib/mtm/joint-visit-notify"

/**
 * Planning a joint visit ahead (src/lib/mtm/joint-visit-plan.ts; owner,
 * 2026-10-30).
 *
 * GET  ?agentId=&date= — the agent's route that day as the planner shows it:
 *      every stop, whether it can still be joined, who already joins it; and
 *      which days can be planned.
 * POST — plan: the chosen stops of that route and the extra clients, which go
 *      onto the route first. The agent is told at once.
 */

function refuse(status: number, code: string, error: string) {
  return NextResponse.json({ success: false, error, code }, { status })
}

const forbiddenAgent = () => refuse(403, "MTM_JOINT_VISIT_AGENT_FORBIDDEN", "This agent is not in your team")

/** GET /api/v1/mtm/mobile/manager/joint-visit/plans?agentId=&date= */
export const GET = withMobileRls(async (req, auth) => {
  const forbidden = requireMobileCapability(auth, "TEAM_READ")
  if (forbidden) return forbidden
  const params = new URL(req.url).searchParams
  const agentId = params.get("agentId")?.trim() ?? ""
  const date = params.get("date")?.trim() ?? ""
  if (!agentId || !isDateKey(date)) return refuse(400, "MTM_JOINT_PLAN_INVALID", "Choose the agent and the day")
  try {
    const agent = await accompaniableAgent(prisma, {
      organizationId: auth.orgId,
      managerAgentId: auth.agentId,
      managerRole: auth.role,
      agentId,
    })
    if (!agent) return forbiddenAgent()
    const timezone = await organizationTimezone(auth.orgId)
    const window = jointPlanWindow(new Date(), timezone)
    return NextResponse.json({
      success: true,
      data: {
        agent,
        window: { from: window.today, to: window.last },
        ...await jointPlanDay(prisma, { organizationId: auth.orgId, managerAgentId: auth.agentId, agentId, date }),
      },
    })
  } catch (error) {
    console.error("[MTM/mobile/manager/joint-visit/plans GET]", error)
    return refuse(500, "MTM_JOINT_VISIT_UNAVAILABLE", "Failed to load the agent's route")
  }
}, { requiredCapability: "route-field" })

/** POST /api/v1/mtm/mobile/manager/joint-visit/plans — plan joint visits with one agent on one day. */
export const POST = withMobileRls(async (req, auth) => {
  const forbidden = requireMobileCapability(auth, "TEAM_READ")
  if (forbidden) return forbidden
  const parsed = JointVisitPlanInputSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return refuse(400, "MTM_JOINT_PLAN_INVALID", "Choose the agent, the day and at least one client")
  const input = parsed.data

  try {
    const agent = await accompaniableAgent(prisma, {
      organizationId: auth.orgId,
      managerAgentId: auth.agentId,
      managerRole: auth.role,
      agentId: input.agentId,
    })
    if (!agent) return forbiddenAgent()

    const now = new Date()
    const timezone = await organizationTimezone(auth.orgId)
    let result: Awaited<ReturnType<typeof createJointVisitPlans>>
    try {
      result = await prisma.$transaction((tx: Prisma.TransactionClient) => createJointVisitPlans(tx, {
        organizationId: auth.orgId,
        managerAgentId: auth.agentId,
        managerUserId: auth.userId || null,
        agentId: agent.id,
        date: input.date,
        routePointIds: input.routePointIds,
        extras: input.extras,
        now,
        timezone,
      }))
    } catch (error) {
      if (error instanceof JointVisitPlanError) return refuse(error.status, error.code, error.message)
      // Two presses at once: one live plan per manager and stop is the
      // database's rule; the second answers with what the first planned.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return NextResponse.json({ success: true, data: { created: [], ...await jointState(auth) } })
      }
      throw error
    }

    if (result.created.length > 0) {
      // Best effort: a lost notice never undoes the plan.
      await notifyAgentOfJointVisitPlan({
        organizationId: auth.orgId,
        managerAgentId: auth.agentId,
        agentId: agent.id,
        kind: "planned",
        date: input.date,
        today: jointPlanWindow(now, timezone).today,
        planIds: result.created.map((plan) => plan.id),
        clients: result.created,
      }).catch((error) => console.warn("[MTM/mobile/manager/joint-visit/plans POST] agent notice failed", error))

      await writeMtmAudit({
        organizationId: auth.orgId,
        agentId: agent.id,
        action: "JOINT_VISIT_PLAN",
        entity: "route",
        entityId: result.routeId,
        metadataKind: "joint_visit",
        newData: {
          managerAgentId: auth.agentId,
          date: input.date,
          routePointIds: result.created.map((plan) => plan.routePointId),
          extras: result.created.filter((plan) => plan.source === "EXTRA").length,
          channel: "mobile",
        },
        req,
      }).catch((error) => console.warn("[MTM/mobile/manager/joint-visit/plans POST] audit failed", error))
    }

    return NextResponse.json(
      { success: true, data: { created: result.created.map((plan) => plan.id), ...await jointState(auth) } },
      { status: result.created.length > 0 ? 201 : 200 },
    )
  } catch (error) {
    console.error("[MTM/mobile/manager/joint-visit/plans POST]", error)
    return refuse(500, "MTM_JOINT_VISIT_UNAVAILABLE", "Failed to plan the joint visit")
  }
}, { requiredCapability: "route-field" })
