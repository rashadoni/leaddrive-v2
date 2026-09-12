import { NextRequest, NextResponse } from "next/server"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { prisma } from "@/lib/prisma"
import { isValidTimezone } from "@/lib/timezone"
import {
  withWorkforceSessionAdminAuth,
  withWorkforceSessionScheduleConfigurationAuth,
} from "@/lib/with-workforce-rls-auth"
import {
  WorkforceConfigurationManagementError,
  WorkforceShiftDefaultPublishSchema,
  publishWorkforceShiftDefault,
} from "@/lib/workforce/configuration-management"
import { workforceConfigurationRequestAuditContext } from "@/lib/workforce/configuration-route"

const defaultAssignmentSelect = {
  id: true,
  templateId: true,
  effectiveFrom: true,
  effectiveTo: true,
  assignedByUserId: true,
  createdAt: true,
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

/** Read-only tenant timeline for the future organization-default schedule. */
export const GET = withWorkforceSessionAdminAuth(async (_req: NextRequest, auth) => {
  try {
    const defaultAssignments = await prisma.workforceShiftDefaultAssignment.findMany({
      where: { organizationId: auth.orgId },
      orderBy: [{ effectiveFrom: "asc" }, { id: "asc" }],
      select: defaultAssignmentSelect,
    })
    return NextResponse.json({ success: true, data: { defaultAssignments } })
  } catch (error) {
    console.error("[workforce/configuration/shifts/default GET]", error)
    return NextResponse.json({ error: "Failed to load Workforce default shifts" }, { status: 500 })
  }
})

/**
 * Publishes a reviewed future organization-wide default. The operation receipt
 * makes an unknown browser/network result safely retryable; it never mutates a
 * live default assignment.
 */
export const POST = withWorkforceSessionScheduleConfigurationAuth("SCHEDULE_WRITE", async (req: NextRequest, auth) => {
  const parsed = WorkforceShiftDefaultPublishSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid Workforce default shift" }, { status: 400 })
  }
  try {
    const settings = await getMtmSettings(auth.orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const operation = await publishWorkforceShiftDefault({
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
      const status = error.code === "WORKFORCE_CONFIGURATION_DEFAULT_TEMPLATE_NOT_FOUND" ? 404 : 409
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    console.error("[workforce/configuration/shifts/default POST]", error)
    return NextResponse.json({ error: "Failed to schedule Workforce default shift" }, { status: 500 })
  }
})
