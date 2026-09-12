import { NextRequest, NextResponse } from "next/server"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { withWorkforceSessionAdminAuth } from "@/lib/with-workforce-rls-auth"
import {
  previewWorkforceSiteAssignments,
  WorkforceSiteAssignmentBulkPreviewSchema,
  WorkforceSiteAssignmentManagementError,
} from "@/lib/workforce/site-management"

/** Read-only, session-admin review for a future multi-employee site draft. */
export const POST = withWorkforceSessionAdminAuth(async (req: NextRequest, auth) => {
  const parsed = WorkforceSiteAssignmentBulkPreviewSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid Workforce site-assignment preview" }, { status: 400 })
  }
  try {
    const settings = await getMtmSettings(auth.orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const preview = await previewWorkforceSiteAssignments({
      organizationId: auth.orgId,
      preview: parsed.data,
      currentDateKey: currentDateKey(new Date(), timezone),
    })
    return NextResponse.json({ success: true, data: preview })
  } catch (error) {
    if (error instanceof WorkforceSiteAssignmentManagementError) {
      const status = error.code === "WORKFORCE_SITE_ASSIGNMENT_SITE_NOT_FOUND" ? 404 : 409
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    console.error("[workforce/configuration/site-assignments/preview POST]", error)
    return NextResponse.json({ error: "Failed to preview Workforce site assignments" }, { status: 500 })
  }
})
