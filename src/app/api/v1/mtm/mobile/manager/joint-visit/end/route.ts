import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { closeManagerJointSessions } from "@/lib/mtm/joint-visit"
import { jointState, organizationTimezone } from "@/lib/mtm/joint-visit-manager"

/**
 * POST /api/v1/mtm/mobile/manager/joint-visit/end — «Закончить совместный
 * визит». Closes the manager's open session; ratings already given, and the
 * visits still within their rating window, stay where they were.
 */
export const POST = withMobileRls(async (req, auth) => {
  const forbidden = requireMobileCapability(auth, "TEAM_READ")
  if (forbidden) return forbidden
  try {
    const timezone = await organizationTimezone(auth.orgId)
    const ended = await closeManagerJointSessions(prisma, {
      organizationId: auth.orgId,
      managerAgentId: auth.agentId,
      now: new Date(),
      timezone,
    })
    if (ended > 0) {
      await writeMtmAudit({
        organizationId: auth.orgId,
        agentId: auth.agentId,
        action: "JOINT_VISIT_END",
        entity: "agent",
        entityId: auth.agentId,
        metadataKind: "joint_visit",
        newData: { channel: "mobile" },
        req,
      }).catch((error) => console.warn("[MTM/mobile/manager/joint-visit/end POST] audit failed", error))
    }
    return NextResponse.json({ success: true, data: await jointState(auth) })
  } catch (error) {
    console.error("[MTM/mobile/manager/joint-visit/end POST]", error)
    return NextResponse.json({ success: false, error: "Failed to end the joint visit", code: "MTM_JOINT_VISIT_UNAVAILABLE" }, { status: 500 })
  }
}, { requiredCapability: "route-field" })
