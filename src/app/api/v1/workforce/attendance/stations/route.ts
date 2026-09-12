import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withWorkforceRlsAuth } from "@/lib/with-workforce-rls-auth"
import {
  createWorkforceAttendanceQrStation,
  WorkforceAttendanceManagementError,
  WorkforceAttendanceStationCreateSchema,
} from "@/lib/workforce/attendance-management"
import {
  requireWorkforceAttendanceAdminAddon,
  workforceAttendanceRequestAuditContext,
} from "@/lib/workforce/attendance-route"

/** List QR stations without ever returning a live QR token. */
export const GET = withWorkforceRlsAuth("read", async (_req: NextRequest, auth) => {
  const denied = await requireWorkforceAttendanceAdminAddon(auth.orgId, auth, "qr")
  if (denied) return denied
  try {
    const stations = await prisma.workforceAttendanceQrStation.findMany({
      where: { organizationId: auth.orgId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        rotationSeconds: true,
        siteId: true,
        areaLabel: true,
        geofenceRevisionId: true,
        effectiveFrom: true,
        effectiveTo: true,
        createdAt: true,
        disabledAt: true,
      },
    })
    return NextResponse.json({ success: true, data: { stations } })
  } catch (error) {
    console.error("[workforce/attendance/stations GET]", error)
    return NextResponse.json({ error: "Failed to load attendance QR stations" }, { status: 500 })
  }
})

/** Create an immutable QR-station identity; disabling is the only retirement path. */
export const POST = withWorkforceRlsAuth("write", async (req: NextRequest, auth) => {
  const denied = await requireWorkforceAttendanceAdminAddon(auth.orgId, auth, "qr")
  if (denied) return denied
  const parsed = WorkforceAttendanceStationCreateSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid attendance QR station" }, { status: 400 })
  }
  try {
    const station = await createWorkforceAttendanceQrStation(prisma, {
      organizationId: auth.orgId,
      createdByUserId: auth.userId,
      audit: workforceAttendanceRequestAuditContext(req, auth.userId),
      ...parsed.data,
    })
    return NextResponse.json({ success: true, data: { station } }, { status: 201 })
  } catch (error) {
    if (error instanceof WorkforceAttendanceManagementError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    console.error("[workforce/attendance/stations POST]", error)
    return NextResponse.json({ error: "Failed to create attendance QR station" }, { status: 500 })
  }
})
