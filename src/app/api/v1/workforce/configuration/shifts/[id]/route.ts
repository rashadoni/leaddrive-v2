import { NextRequest, NextResponse } from "next/server"
import { withWorkforceSessionAdminAuth } from "@/lib/with-workforce-rls-auth"
import {
  WorkforceConfigurationManagementError,
  WorkforceShiftTemplateDraftUpdateSchema,
  updateWorkforceShiftTemplateDraft,
} from "@/lib/workforce/configuration-management"
import { workforceConfigurationRequestAuditContext } from "@/lib/workforce/configuration-route"

type RouteContext = { params: Promise<{ id: string }> }

/** PATCH /api/v1/workforce/configuration/shifts/:id — draft content only. */
export const PATCH = withWorkforceSessionAdminAuth<RouteContext>(async (req: NextRequest, auth, { params }) => {
  const parsed = WorkforceShiftTemplateDraftUpdateSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid Workforce shift draft" }, { status: 400 })
  }
  const { id } = await params
  try {
    const shift = await updateWorkforceShiftTemplateDraft({
      organizationId: auth.orgId,
      templateId: id,
      draft: parsed.data,
      audit: workforceConfigurationRequestAuditContext(req, auth.userId),
    })
    return NextResponse.json({ success: true, data: { shift } })
  } catch (error) {
    if (error instanceof WorkforceConfigurationManagementError) {
      const status = error.code === "WORKFORCE_CONFIGURATION_SHIFT_NOT_FOUND" ? 404 : 409
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    console.error("[workforce/configuration/shifts PATCH]", error)
    return NextResponse.json({ error: "Failed to update Workforce shift draft" }, { status: 500 })
  }
})
