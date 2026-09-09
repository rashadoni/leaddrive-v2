import { NextRequest, NextResponse } from "next/server"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { withWorkforceSessionAdminAuth } from "@/lib/with-workforce-rls-auth"
import {
  WorkforceConfigurationManagementError,
  activateWorkforcePolicyDraft,
} from "@/lib/workforce/configuration-management"
import { workforceConfigurationRequestAuditContext } from "@/lib/workforce/configuration-route"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * POST /api/v1/workforce/configuration/policies/:id/activate
 *
 * The policy must begin after the organization-local current date. A current
 * published policy is closed only on the preceding future date; snapshots and
 * started/closed workdays are never changed.
 */
export const POST = withWorkforceSessionAdminAuth<RouteContext>(async (req: NextRequest, auth, { params }) => {
  try {
    const settings = await getMtmSettings(auth.orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const { id } = await params
    const policy = await activateWorkforcePolicyDraft({
      organizationId: auth.orgId,
      policyId: id,
      currentDateKey: currentDateKey(new Date(), timezone),
      audit: workforceConfigurationRequestAuditContext(req, auth.userId),
    })
    return NextResponse.json({ success: true, data: { policy } })
  } catch (error) {
    if (error instanceof WorkforceConfigurationManagementError) {
      const status = error.code === "WORKFORCE_CONFIGURATION_POLICY_NOT_FOUND" ? 404 : 409
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    console.error("[workforce/configuration/policies activate]", error)
    return NextResponse.json({ error: "Failed to activate Workforce policy" }, { status: 500 })
  }
})
