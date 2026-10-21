import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { openJointSessionsForAgent } from "@/lib/mtm/joint-visit"
import { organizationTimezone } from "@/lib/mtm/joint-visit-manager"

/**
 * GET /api/v1/mtm/mobile/joint-visit — the agent's side of a joint visit
 * (src/lib/mtm/joint-visit.ts): which managers are in the field with him right
 * now. The app keeps the answer, so «Этот визит — вместе с руководителем?»
 * is asked at an offline check-in too; the server checks the answer again
 * when the check-in arrives. Ratings are never part of it.
 */
export const GET = withMobileRls(async (_req, auth) => {
  const forbidden = requireMobileCapability(auth, "FIELD_EXECUTE")
  if (forbidden) return forbidden
  try {
    const now = new Date()
    const timezone = await organizationTimezone(auth.orgId)
    const sessions = await openJointSessionsForAgent(prisma, {
      organizationId: auth.orgId,
      agentId: auth.agentId,
      now,
      timezone,
    })
    return NextResponse.json({
      success: true,
      data: {
        now: now.toISOString(),
        managers: sessions.map((session) => ({
          id: session.manager.id,
          name: session.manager.name,
          sessionId: session.id,
          startedAt: session.startedAt.toISOString(),
        })),
      },
    })
  } catch (error) {
    console.error("[MTM/mobile/joint-visit GET]", error)
    return NextResponse.json({ success: false, error: "Failed to load the joint visit", code: "MTM_JOINT_VISIT_UNAVAILABLE" }, { status: 500 })
  }
}, { requiredCapability: "route-field" })
