import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withWorkforceRlsAuth } from "@/lib/with-workforce-rls-auth"
import {
  revokeWorkforceAttendanceDeviceEnrollment,
  WorkforceAttendanceManagementError,
} from "@/lib/workforce/attendance-management"
import {
  requireWorkforceAttendanceAdminAddon,
  workforceAttendanceRequestAuditContext,
} from "@/lib/workforce/attendance-route"

type RouteContext = { params: Promise<{ id: string }> }

/** Revoke instead of deleting so prior attendance evidence remains auditable. */
export const POST = withWorkforceRlsAuth<RouteContext>("write", async (req: NextRequest, auth, { params }) => {
  const denied = await requireWorkforceAttendanceAdminAddon(auth.orgId, auth, "deviceTrust")
  if (denied) return denied
  const { id } = await params
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) {
    return NextResponse.json({ error: "Invalid attendance device enrollment id" }, { status: 400 })
  }
  try {
    await revokeWorkforceAttendanceDeviceEnrollment(prisma, {
      organizationId: auth.orgId,
      enrollmentId: id,
      revokedByUserId: auth.userId,
      audit: workforceAttendanceRequestAuditContext(req, auth.userId),
    })
    return NextResponse.json({ success: true, data: { enrollmentId: id, status: "REVOKED" } })
  } catch (error) {
    if (error instanceof WorkforceAttendanceManagementError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    console.error("[workforce/attendance/devices/:id/revoke POST]", error)
    return NextResponse.json({ error: "Failed to revoke attendance device" }, { status: 500 })
  }
})
