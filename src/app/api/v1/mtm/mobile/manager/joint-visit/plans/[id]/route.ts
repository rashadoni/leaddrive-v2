import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { jointState, organizationTimezone } from "@/lib/mtm/joint-visit-manager"
import { JointVisitPlanError, cancelJointVisitPlan, jointPlanWindow, routeDayKey } from "@/lib/mtm/joint-visit-plan"
import { notifyAgentOfJointVisitPlan } from "@/lib/mtm/joint-visit-notify"

/**
 * DELETE /api/v1/mtm/mobile/manager/joint-visit/plans/:id — the manager takes
 * back a joint visit he planned. Only his own, and only before the visit took
 * place; an extra client he had added leaves the agent's route with it. The
 * agent is told.
 */
export const DELETE = withMobileRls(async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const forbidden = requireMobileCapability(auth, "TEAM_READ")
  if (forbidden) return forbidden
  const { id } = await params
  try {
    const now = new Date()
    let cancelled: Awaited<ReturnType<typeof cancelJointVisitPlan>>
    try {
      cancelled = await prisma.$transaction((tx: Prisma.TransactionClient) => cancelJointVisitPlan(tx, {
        organizationId: auth.orgId,
        managerAgentId: auth.agentId,
        planId: id,
        now,
      }))
    } catch (error) {
      if (error instanceof JointVisitPlanError) {
        return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.status })
      }
      throw error
    }

    const timezone = await organizationTimezone(auth.orgId)
    const date = routeDayKey(cancelled.date)
    await notifyAgentOfJointVisitPlan({
      organizationId: auth.orgId,
      managerAgentId: auth.agentId,
      agentId: cancelled.agentId,
      kind: "cancelled",
      date,
      today: jointPlanWindow(now, timezone).today,
      planIds: [cancelled.id],
      clients: [cancelled],
    }).catch((error) => console.warn("[MTM/mobile/manager/joint-visit/plans DELETE] agent notice failed", error))

    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: cancelled.agentId,
      action: "JOINT_VISIT_PLAN_CANCEL",
      entity: "agent",
      entityId: cancelled.agentId,
      metadataKind: "joint_visit",
      newData: { managerAgentId: auth.agentId, planId: cancelled.id, date, channel: "mobile" },
      req,
    }).catch((error) => console.warn("[MTM/mobile/manager/joint-visit/plans DELETE] audit failed", error))

    return NextResponse.json({ success: true, data: await jointState(auth) })
  } catch (error) {
    console.error("[MTM/mobile/manager/joint-visit/plans DELETE]", error)
    return NextResponse.json({ success: false, error: "Failed to cancel the joint visit", code: "MTM_JOINT_VISIT_UNAVAILABLE" }, { status: 500 })
  }
}, { requiredCapability: "route-field" })
