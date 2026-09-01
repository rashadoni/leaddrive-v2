import { NextRequest, NextResponse } from "next/server"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { withWorkforceSessionScheduleConfigurationAuth } from "@/lib/with-workforce-rls-auth"
import {
  publishWorkforceShiftAssignments,
  WorkforceConfigurationManagementError,
  WorkforceShiftAssignmentBulkPublishError,
  WorkforceShiftAssignmentBulkPublishSchema,
} from "@/lib/workforce/configuration-management"
import { workforceConfigurationRequestAuditContext } from "@/lib/workforce/configuration-route"

/**
 * Explicit confirmation boundary for a reviewed bulk shift draft. The writer
 * repeats the conflict preview while holding the same per-employee locks as
 * individual scheduling; this route never treats a browser preview as a write
 * authorization by itself.
 */
export const POST = withWorkforceSessionScheduleConfigurationAuth("SCHEDULE_WRITE", async (req: NextRequest, auth) => {
  const parsed = WorkforceShiftAssignmentBulkPublishSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid Workforce bulk shift assignment" }, { status: 400 })
  }
  try {
    const settings = await getMtmSettings(auth.orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const operation = await publishWorkforceShiftAssignments({
      organizationId: auth.orgId,
      publishedByUserId: auth.userId,
      publish: parsed.data,
      currentDateKey: currentDateKey(new Date(), timezone),
      audit: workforceConfigurationRequestAuditContext(req, auth.userId),
    })
    return NextResponse.json({ success: true, data: { operation } }, { status: operation.idempotent ? 200 : 201 })
  } catch (error) {
    if (error instanceof WorkforceShiftAssignmentBulkPublishError) {
      return NextResponse.json({
        error: error.message,
        code: error.code,
        ...(error.preview ? { data: { preview: error.preview } } : {}),
      }, { status: 409 })
    }
    if (error instanceof WorkforceConfigurationManagementError) {
      const status = error.code === "WORKFORCE_CONFIGURATION_ASSIGNMENT_AGENT_NOT_FOUND"
        || error.code === "WORKFORCE_CONFIGURATION_ASSIGNMENT_TEMPLATE_NOT_FOUND"
        ? 404
        : 409
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    console.error("[workforce/configuration/assignments/bulk/publish POST]", error)
    return NextResponse.json({ error: "Failed to publish Workforce bulk shift assignments" }, { status: 500 })
  }
})
