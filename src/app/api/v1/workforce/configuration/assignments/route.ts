import { NextRequest, NextResponse } from "next/server"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { prisma } from "@/lib/prisma"
import { isValidTimezone } from "@/lib/timezone"
import { withWorkforceSessionAdminAuth } from "@/lib/with-workforce-rls-auth"
import {
  WorkforceConfigurationManagementError,
  WorkforceShiftAssignmentScheduleSchema,
  scheduleWorkforceShiftAssignment,
} from "@/lib/workforce/configuration-management"
import { workforceConfigurationRequestAuditContext } from "@/lib/workforce/configuration-route"

const assignmentSelect = {
  id: true,
  agentId: true,
  templateId: true,
  effectiveFrom: true,
  effectiveTo: true,
  assignedByUserId: true,
  createdAt: true,
  updatedAt: true,
} as const

/** Read-only administrative timeline; employees cannot select their own shift. */
export const GET = withWorkforceSessionAdminAuth(async (_req: NextRequest, auth) => {
  try {
    const assignments = await prisma.workforceShiftAssignment.findMany({
      where: { organizationId: auth.orgId },
      orderBy: [{ agentId: "asc" }, { effectiveFrom: "asc" }],
      select: assignmentSelect,
    })
    return NextResponse.json({ success: true, data: { assignments } })
  } catch (error) {
    console.error("[workforce/configuration/assignments GET]", error)
    return NextResponse.json({ error: "Failed to load Workforce shift assignments" }, { status: 500 })
  }
})

/**
 * Writes only a future effective-dated assignment. The organization date is
 * derived server-side so a browser cannot schedule into its own past/today.
 */
export const POST = withWorkforceSessionAdminAuth(async (req: NextRequest, auth) => {
  const parsed = WorkforceShiftAssignmentScheduleSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid Workforce shift assignment" }, { status: 400 })
  }
  try {
    const settings = await getMtmSettings(auth.orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const assignment = await scheduleWorkforceShiftAssignment({
      organizationId: auth.orgId,
      assignment: parsed.data,
      currentDateKey: currentDateKey(new Date(), timezone),
      audit: workforceConfigurationRequestAuditContext(req, auth.userId),
    })
    return NextResponse.json({ success: true, data: { assignment } }, { status: 201 })
  } catch (error) {
    if (error instanceof WorkforceConfigurationManagementError) {
      const status = error.code === "WORKFORCE_CONFIGURATION_ASSIGNMENT_AGENT_NOT_FOUND"
        || error.code === "WORKFORCE_CONFIGURATION_ASSIGNMENT_TEMPLATE_NOT_FOUND"
        ? 404
        : 409
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    console.error("[workforce/configuration/assignments POST]", error)
    return NextResponse.json({ error: "Failed to schedule Workforce shift assignment" }, { status: 500 })
  }
})
