import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withWorkforceRlsAuth } from "@/lib/with-workforce-rls-auth"
import {
  disableWorkforceAttendanceQrStation,
  WorkforceAttendanceManagementError,
} from "@/lib/workforce/attendance-management"
import {
  requireWorkforceAttendanceAdminAddon,
  workforceAttendanceRequestAuditContext,
} from "@/lib/workforce/attendance-route"

type RouteContext = { params: Promise<{ id: string }> }

/** POST retires an attendance station; it intentionally has no delete path. */
export const POST = withWorkforceRlsAuth<RouteContext>("write", async (req: NextRequest, auth, { params }) => {
  const denied = await requireWorkforceAttendanceAdminAddon(auth.orgId, auth, "qr")
  if (denied) return denied
  const { id } = await params
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) {
    return NextResponse.json({ error: "Invalid attendance QR station id" }, { status: 400 })
  }
  try {
    await disableWorkforceAttendanceQrStation(prisma, {
      organizationId: auth.orgId,
      stationId: id,
      disabledByUserId: auth.userId,
      audit: workforceAttendanceRequestAuditContext(req, auth.userId),
    })
    return NextResponse.json({ success: true, data: { stationId: id, status: "DISABLED" } })
  } catch (error) {
    if (error instanceof WorkforceAttendanceManagementError) {
      const status = error.code === "WORKFORCE_ATTENDANCE_STATION_NOT_FOUND" ? 404 : 409
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    console.error("[workforce/attendance/stations/:id/disable POST]", error)
    return NextResponse.json({ error: "Failed to disable attendance QR station" }, { status: 500 })
  }
})
