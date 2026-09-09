import { NextRequest, NextResponse } from "next/server"
import { withWorkforceSessionAdminAuth } from "@/lib/with-workforce-rls-auth"
import {
  WorkforceConfigurationManagementError,
  activateWorkforceShiftTemplateDraft,
} from "@/lib/workforce/configuration-management"
import { workforceConfigurationRequestAuditContext } from "@/lib/workforce/configuration-route"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * POST /api/v1/workforce/configuration/shifts/:id/activate
 *
 * The activated template remains non-default and unassigned. An employee
 * schedule changes only through the separate future-dated assignment route.
 */
export const POST = withWorkforceSessionAdminAuth<RouteContext>(async (req: NextRequest, auth, { params }) => {
  try {
    const { id } = await params
    const shift = await activateWorkforceShiftTemplateDraft({
      organizationId: auth.orgId,
      templateId: id,
      audit: workforceConfigurationRequestAuditContext(req, auth.userId),
    })
    return NextResponse.json({ success: true, data: { shift } })
  } catch (error) {
    if (error instanceof WorkforceConfigurationManagementError) {
      const status = error.code === "WORKFORCE_CONFIGURATION_SHIFT_NOT_FOUND" ? 404 : 409
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    console.error("[workforce/configuration/shifts activate]", error)
    return NextResponse.json({ error: "Failed to activate Workforce shift" }, { status: 500 })
  }
})
