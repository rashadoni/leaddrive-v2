import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withWorkforceRlsAuth } from "@/lib/with-workforce-rls-auth"
import {
  issueWorkforceAttendanceQr,
  WorkforceAttendanceManagementError,
} from "@/lib/workforce/attendance-management"
import { requireWorkforceAttendanceAdminAddon } from "@/lib/workforce/attendance-route"

type RouteContext = { params: Promise<{ id: string }> }

/** Returns a fresh short-lived QR only to an attendance administrator/display controller. */
export const POST = withWorkforceRlsAuth<RouteContext>("write", async (_req: NextRequest, auth, { params }) => {
  const denied = await requireWorkforceAttendanceAdminAddon(auth.orgId, auth, "qr")
  if (denied) return denied
  const { id } = await params
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) {
    return NextResponse.json({ error: "Invalid attendance QR station id" }, { status: 400 })
  }
  try {
    const issued = await issueWorkforceAttendanceQr(prisma, { organizationId: auth.orgId, stationId: id })
    return NextResponse.json({ success: true, data: issued })
  } catch (error) {
    if (error instanceof WorkforceAttendanceManagementError) {
      const status = error.code === "WORKFORCE_ATTENDANCE_STATION_NOT_FOUND" ? 404 : 409
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    console.error("[workforce/attendance/stations/:id/qr POST]", error)
    return NextResponse.json({ error: "Failed to issue attendance QR" }, { status: 500 })
  }
})
