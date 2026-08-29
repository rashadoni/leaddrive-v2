import { NextRequest, NextResponse } from "next/server"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { prisma } from "@/lib/prisma"
import { isValidTimezone } from "@/lib/timezone"
import { withWorkforceSessionAdminAuth } from "@/lib/with-workforce-rls-auth"
import {
  scheduleWorkforceSiteAssignment,
  WorkforceSiteAssignmentManagementError,
  WorkforceSiteAssignmentScheduleSchema,
} from "@/lib/workforce/site-management"
import { workforceConfigurationRequestAuditContext } from "@/lib/workforce/configuration-route"

const assignmentSelect = {
  id: true,
  agentId: true,
  siteId: true,
  kind: true,
  effectiveFrom: true,
  effectiveTo: true,
  assignedByUserId: true,
  createdAt: true,
} as const

/** Administrative timeline; it has no Route/customer fallback. */
export const GET = withWorkforceSessionAdminAuth(async (_req: NextRequest, auth) => {
  try {
    const assignments = await prisma.workforceSiteAssignment.findMany({
      where: { organizationId: auth.orgId },
      orderBy: [{ agentId: "asc" }, { kind: "asc" }, { effectiveFrom: "asc" }],
      select: assignmentSelect,
    })
    return NextResponse.json({ success: true, data: { assignments } })
  } catch (error) {
    console.error("[workforce/configuration/site-assignments GET]", error)
    return NextResponse.json({ error: "Failed to load Workforce site assignments" }, { status: 500 })
  }
})

/** Schedules a future assignment from server-derived organization date. */
export const POST = withWorkforceSessionAdminAuth(async (req: NextRequest, auth) => {
  const parsed = WorkforceSiteAssignmentScheduleSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid Workforce site assignment" }, { status: 400 })
  }
  try {
    const settings = await getMtmSettings(auth.orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const assignment = await scheduleWorkforceSiteAssignment({
      organizationId: auth.orgId,
      assignedByUserId: auth.userId,
      assignment: parsed.data,
      currentDateKey: currentDateKey(new Date(), timezone),
      audit: workforceConfigurationRequestAuditContext(req, auth.userId),
    })
    return NextResponse.json({ success: true, data: { assignment } }, { status: 201 })
  } catch (error) {
    if (error instanceof WorkforceSiteAssignmentManagementError) {
      const status = error.code === "WORKFORCE_SITE_ASSIGNMENT_AGENT_NOT_FOUND"
        || error.code === "WORKFORCE_SITE_ASSIGNMENT_SITE_NOT_FOUND"
        ? 404
        : 409
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    console.error("[workforce/configuration/site-assignments POST]", error)
    return NextResponse.json({ error: "Failed to schedule Workforce site assignment" }, { status: 500 })
  }
})
