import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withWorkforceRlsAuth } from "@/lib/with-workforce-rls-auth"
import {
  approveWorkforceAttendanceDeviceEnrollment,
  WorkforceAttendanceManagementError,
} from "@/lib/workforce/attendance-management"
import {
  requireWorkforceAttendanceAdminAddon,
  workforceAttendanceRequestAuditContext,
} from "@/lib/workforce/attendance-route"

type RouteContext = { params: Promise<{ id: string }> }

/** A security administrator must explicitly approve a proved device key. */
export const POST = withWorkforceRlsAuth<RouteContext>("write", async (req: NextRequest, auth, { params }) => {
  const denied = await requireWorkforceAttendanceAdminAddon(auth.orgId, auth, "deviceTrust")
  if (denied) return denied
  const { id } = await params
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) {
    return NextResponse.json({ error: "Invalid attendance device enrollment id" }, { status: 400 })
  }
  try {
    const enrollment = await approveWorkforceAttendanceDeviceEnrollment(prisma, {
      organizationId: auth.orgId,
      enrollmentId: id,
      approvedByUserId: auth.userId,
      audit: workforceAttendanceRequestAuditContext(req, auth.userId),
    })
    return NextResponse.json({ success: true, data: { enrollment } })
  } catch (error) {
    if (error instanceof WorkforceAttendanceManagementError) {
      const status = error.code === "WORKFORCE_ATTENDANCE_ENROLLMENT_NOT_FOUND" ? 404 : 409
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    console.error("[workforce/attendance/devices/:id/approve POST]", error)
    return NextResponse.json({ error: "Failed to approve attendance device" }, { status: 500 })
  }
})
