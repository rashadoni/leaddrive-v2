import { NextRequest, NextResponse } from "next/server"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { prisma } from "@/lib/prisma"
import { isValidTimezone } from "@/lib/timezone"
import { withWorkforceSessionScheduleConfigurationAuth } from "@/lib/with-workforce-rls-auth"
import {
  WorkforceConfigurationManagementError,
  WorkforceShiftTeamDefaultPublishSchema,
  publishWorkforceShiftTeamDefault,
} from "@/lib/workforce/configuration-management"
import { workforceConfigurationRequestAuditContext } from "@/lib/workforce/configuration-route"

const teamDefaultAssignmentSelect = {
  id: true,
  teamId: true,
  templateId: true,
  effectiveFrom: true,
  effectiveTo: true,
  assignedByUserId: true,
  createdAt: true,
  team: {
    select: { id: true, name: true, code: true, isActive: true },
  },
  template: {
    select: {
      id: true,
      code: true,
      name: true,
      timezone: true,
      teamId: true,
      status: true,
      isDefault: true,
    },
  },
} as const

/** Read-only timeline of future defaults for known historical Workforce teams. */
export const GET = withWorkforceSessionScheduleConfigurationAuth("SCHEDULE_READ", async (_req: NextRequest, auth) => {
  try {
    const teamDefaultAssignments = await prisma.workforceShiftTeamDefaultAssignment.findMany({
      where: { organizationId: auth.orgId },
      orderBy: [{ team: { name: "asc" } }, { effectiveFrom: "asc" }, { id: "asc" }],
      select: teamDefaultAssignmentSelect,
    })
    return NextResponse.json({ success: true, data: { teamDefaultAssignments } })
  } catch (error) {
    console.error("[workforce/configuration/shifts/team-default GET]", error)
    return NextResponse.json({ error: "Failed to load Workforce team default shifts" }, { status: 500 })
  }
})

/**
 * Publishes a reviewed future fallback for exactly one team. The service pins
 * its retry receipt and selection only against immutable workday-start team
 * membership; it never writes individual employee assignments.
 */
export const POST = withWorkforceSessionScheduleConfigurationAuth("SCHEDULE_WRITE", async (req: NextRequest, auth) => {
  const parsed = WorkforceShiftTeamDefaultPublishSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid Workforce team default shift" }, { status: 400 })
  }
  try {
    const settings = await getMtmSettings(auth.orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const operation = await publishWorkforceShiftTeamDefault({
      organizationId: auth.orgId,
      publishedByUserId: auth.userId,
      publish: parsed.data,
      currentDateKey: currentDateKey(new Date(), timezone),
      audit: workforceConfigurationRequestAuditContext(req, auth.userId),
    })
    return NextResponse.json(
      { success: true, data: { operation } },
      { status: 201, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } },
    )
  } catch (error) {
    if (error instanceof WorkforceConfigurationManagementError) {
      const status = error.code === "WORKFORCE_CONFIGURATION_TEAM_DEFAULT_TEAM_NOT_FOUND"
        || error.code === "WORKFORCE_CONFIGURATION_TEAM_DEFAULT_TEMPLATE_NOT_FOUND"
        ? 404
        : 409
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    console.error("[workforce/configuration/shifts/team-default POST]", error)
    return NextResponse.json({ error: "Failed to publish Workforce team default shift" }, { status: 500 })
  }
})
