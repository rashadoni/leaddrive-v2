import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withWorkforceRlsAuth } from "@/lib/with-workforce-rls-auth"
import {
  replaceWorkforceAttendanceQrStation,
  WorkforceAttendanceManagementError,
  WorkforceAttendanceStationReplacementSchema,
} from "@/lib/workforce/attendance-management"
import {
  requireWorkforceAttendanceAdminAddon,
  requireWorkforceAttendanceSecurityMfa,
  workforceAttendanceRequestAuditContext,
} from "@/lib/workforce/attendance-route"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Emergency replacement is an atomic create-and-retire operation. The
 * replacement inherits the effective station's site/geofence context; it is
 * not an editing shortcut for a physical location.
 */
export const POST = withWorkforceRlsAuth<RouteContext>("write", async (req: NextRequest, auth, { params }) => {
  const denied = await requireWorkforceAttendanceAdminAddon(auth.orgId, auth, "qr")
  if (denied) return denied
  const mfaDenied = await requireWorkforceAttendanceSecurityMfa(auth.orgId, auth)
  if (mfaDenied) return mfaDenied
  const { id } = await params
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) {
    return NextResponse.json({ error: "Invalid attendance QR station id" }, { status: 400 })
  }
  const parsed = WorkforceAttendanceStationReplacementSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid attendance QR replacement" }, { status: 400 })
  }
  try {
    const result = await replaceWorkforceAttendanceQrStation(prisma, {
      organizationId: auth.orgId,
      stationId: id,
      createdByUserId: auth.userId,
      audit: workforceAttendanceRequestAuditContext(req, auth.userId),
      ...parsed.data,
    })
    return NextResponse.json({ success: true, data: result }, { status: 201 })
  } catch (error) {
    if (error instanceof WorkforceAttendanceManagementError) {
      const status = error.code === "WORKFORCE_ATTENDANCE_STATION_NOT_FOUND" ? 404 : 409
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    console.error("[workforce/attendance/stations/:id/replace POST]", error)
    return NextResponse.json({ error: "Failed to replace attendance QR station" }, { status: 500 })
  }
})
