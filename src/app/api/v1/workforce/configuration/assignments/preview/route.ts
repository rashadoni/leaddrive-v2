import { NextRequest, NextResponse } from "next/server"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { withWorkforceSessionAdminAuth } from "@/lib/with-workforce-rls-auth"
import {
  previewWorkforceShiftAssignments,
  WorkforceConfigurationManagementError,
  WorkforceShiftAssignmentBulkPreviewSchema,
} from "@/lib/workforce/configuration-management"

/**
 * Read-only bulk impact preview. There is deliberately no companion mass-write
 * route until a durable, idempotent apply-and-audit contract is reviewed.
 */
export const POST = withWorkforceSessionAdminAuth(async (req: NextRequest, auth) => {
  const parsed = WorkforceShiftAssignmentBulkPreviewSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid Workforce assignment preview" }, { status: 400 })
  }
  try {
    const settings = await getMtmSettings(auth.orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const preview = await previewWorkforceShiftAssignments({
      organizationId: auth.orgId,
      preview: parsed.data,
      currentDateKey: currentDateKey(new Date(), timezone),
    })
    return NextResponse.json({ success: true, data: preview })
  } catch (error) {
    if (error instanceof WorkforceConfigurationManagementError) {
      const status = error.code === "WORKFORCE_CONFIGURATION_ASSIGNMENT_TEMPLATE_NOT_FOUND" ? 404 : 409
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    console.error("[workforce/configuration/assignments/preview POST]", error)
    return NextResponse.json({ error: "Failed to preview Workforce shift assignments" }, { status: 500 })
  }
})
