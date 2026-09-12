import { NextRequest, NextResponse } from "next/server"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { withWorkforceSessionScheduleConfigurationAuth } from "@/lib/with-workforce-rls-auth"
import { workforceConfigurationRequestAuditContext } from "@/lib/workforce/configuration-route"
import {
  publishWorkforceSiteAssignments,
  WorkforceSiteAssignmentBulkPublishError,
  WorkforceSiteAssignmentBulkPublishSchema,
  WorkforceSiteAssignmentManagementError,
} from "@/lib/workforce/site-management"

/**
 * Explicit confirmation endpoint for a reviewed future site-assignment draft.
 * It is Workforce-only and uses the existing narrow site-assignment write
 * permission; the writer repeats the preview under durable locks.
 */
export const POST = withWorkforceSessionScheduleConfigurationAuth("SITE_ASSIGNMENT_WRITE", async (req: NextRequest, auth) => {
  const parsed = WorkforceSiteAssignmentBulkPublishSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid Workforce bulk site assignment" }, { status: 400 })
  }
  try {
    const settings = await getMtmSettings(auth.orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const operation = await publishWorkforceSiteAssignments({
      organizationId: auth.orgId,
      publishedByUserId: auth.userId,
      publish: parsed.data,
      currentDateKey: currentDateKey(new Date(), timezone),
      audit: workforceConfigurationRequestAuditContext(req, auth.userId),
    })
    return NextResponse.json({ success: true, data: { operation } }, { status: operation.idempotent ? 200 : 201 })
  } catch (error) {
    if (error instanceof WorkforceSiteAssignmentBulkPublishError) {
      return NextResponse.json({
        error: error.message,
        code: error.code,
        ...(error.preview ? { data: { preview: error.preview } } : {}),
      }, { status: 409 })
    }
    if (error instanceof WorkforceSiteAssignmentManagementError) {
      const status = error.code === "WORKFORCE_SITE_ASSIGNMENT_SITE_NOT_FOUND" ? 404 : 409
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    console.error("[workforce/configuration/site-assignments/bulk/publish POST]", error)
    return NextResponse.json({ error: "Failed to publish Workforce bulk site assignments" }, { status: 500 })
  }
})
