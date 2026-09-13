import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireMobilePermission } from "@/lib/mtm/mobile-capabilities"
import { withMobileRls } from "@/lib/with-mobile-rls"
import {
  revokeWorkforceAttendanceDeviceEnrollment,
  WorkforceAttendanceManagementError,
} from "@/lib/workforce/attendance-management"
import {
  workforceAttendanceAddonDisabled,
  workforceAttendanceRequestAuditContext,
} from "@/lib/workforce/attendance-route"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * A mobile employee can contain only their own pending/active factor. This is
 * deliberately available without a manager approval or a device signature:
 * revocation reduces access and is safer than keeping a suspected lost device
 * active. The server still writes the same redacted immutable audit trail as
 * an administrator-initiated revocation.
 */
export const POST = withMobileRls<RouteContext>(async (req: NextRequest, auth, { params }) => {
  if (auth.tenantCapabilities.attendanceDeviceTrust !== true) {
    return workforceAttendanceAddonDisabled("deviceTrust")
  }
  const forbidden = requireMobilePermission(auth, "WORKTIME_SELF_MUTATE")
  if (forbidden) return forbidden
  // A mobile token for an agent without an accountable linked user cannot
  // create a user-attributed security audit record. It must use the existing
  // accountable administrator path rather than substituting a synthetic actor.
  if (!auth.userId) {
    return NextResponse.json({
      error: "An accountable linked user is required to revoke an attendance device.",
      code: "WORKFORCE_ATTENDANCE_ACCOUNT_LINK_REQUIRED",
    }, { status: 403 })
  }
  const { id } = await params
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) {
    return NextResponse.json({ error: "Invalid attendance device enrollment id" }, { status: 400 })
  }
  try {
    await revokeWorkforceAttendanceDeviceEnrollment(prisma, {
      organizationId: auth.orgId,
      expectedAgentId: auth.agentId,
      enrollmentId: id,
      revokedByUserId: auth.userId,
      audit: workforceAttendanceRequestAuditContext(req, auth.userId),
    })
    return NextResponse.json({ success: true, data: { enrollmentId: id, status: "REVOKED" } })
  } catch (error) {
    if (error instanceof WorkforceAttendanceManagementError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    console.error("[mtm/mobile/attendance/devices/enrollments/:id/revoke POST]", error)
    return NextResponse.json({ error: "Failed to revoke attendance device" }, { status: 500 })
  }
}, { requiredCapability: "workforce-hrm" })
