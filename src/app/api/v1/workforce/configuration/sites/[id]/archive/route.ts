import { NextRequest, NextResponse } from "next/server"
import { withWorkforceSessionAdminAuth } from "@/lib/with-workforce-rls-auth"
import {
  archiveWorkforceSite,
  WorkforceSiteArchiveSchema,
  WorkforceSiteManagementError,
} from "@/lib/workforce/site-management"
import { workforceConfigurationRequestAuditContext } from "@/lib/workforce/configuration-route"

type RouteContext = { params: Promise<{ id: string }> }

/** Archive rather than delete a Workforce site. Historical snapshots keep their references. */
export const POST = withWorkforceSessionAdminAuth<RouteContext>(async (req: NextRequest, auth, { params }) => {
  const parsed = WorkforceSiteArchiveSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid site archive request" }, { status: 400 })
  }
  try {
    const { id } = await params
    const site = await archiveWorkforceSite({
      organizationId: auth.orgId,
      siteId: id,
      archivedByUserId: auth.userId,
      reason: parsed.data.reason,
      audit: workforceConfigurationRequestAuditContext(req, auth.userId),
    })
    return NextResponse.json({ success: true, data: { site } })
  } catch (error) {
    if (error instanceof WorkforceSiteManagementError) {
      const status = error.code === "WORKFORCE_SITE_NOT_FOUND" ? 404 : 409
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    console.error("[workforce/configuration/sites archive]", error)
    return NextResponse.json({ error: "Failed to archive Workforce site" }, { status: 500 })
  }
})
