import { NextRequest, NextResponse } from "next/server"
import QRCode from "qrcode"
import { prisma } from "@/lib/prisma"
import { withWorkforceRlsAuth } from "@/lib/with-workforce-rls-auth"
import {
  issueWorkforceAttendanceQr,
  WorkforceAttendanceManagementError,
} from "@/lib/workforce/attendance-management"
import { WorkforceAttendanceActionSchema } from "@/lib/workforce/attendance-policy"
import { checkWorkforceAttendanceRateLimit } from "@/lib/workforce/attendance-rate-limit"
import { requireWorkforceAttendanceAdminAddon } from "@/lib/workforce/attendance-route"

type RouteContext = { params: Promise<{ id: string }> }

/** Returns a fresh short-lived QR only to an attendance administrator/display controller. */
export const POST = withWorkforceRlsAuth<RouteContext>("write", async (req: NextRequest, auth, { params }) => {
  const denied = await requireWorkforceAttendanceAdminAddon(auth.orgId, auth, "qr")
  if (denied) return denied
  const { id } = await params
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) {
    return NextResponse.json({ error: "Invalid attendance QR station id" }, { status: 400 })
  }
  const body = await req.json().catch(() => ({}))
  const action = WorkforceAttendanceActionSchema.safeParse(body?.action)
  if (!action.success) {
    return NextResponse.json({ error: "A valid attendance action is required for this QR" }, { status: 400 })
  }
  const rate = await checkWorkforceAttendanceRateLimit({
    operation: "QR_ISSUE",
    organizationId: auth.orgId,
    principalId: auth.userId,
    resourceId: id,
  })
  if (!rate.allowed) {
    return NextResponse.json({
      error: "Attendance QR issue rate limit exceeded",
      code: "WORKFORCE_ATTENDANCE_RATE_LIMITED",
      retryAfterSeconds: rate.retryAfterSeconds,
    }, {
      status: 429,
      headers: { "Retry-After": String(rate.retryAfterSeconds), "cache-control": "no-store" },
    })
  }
  try {
    const issued = await issueWorkforceAttendanceQr(prisma, {
      organizationId: auth.orgId,
      stationId: id,
      action: action.data,
    })
    // The token remains in the established response for an approved display
    // controller.  The server also produces an image so the administration UI
    // never needs to render, persist or log the token as text in the browser.
    const qrDataUrl = await QRCode.toDataURL(issued.token, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 256,
    })
    return NextResponse.json({ success: true, data: { ...issued, qrDataUrl } })
  } catch (error) {
    if (error instanceof WorkforceAttendanceManagementError) {
      const status = error.code === "WORKFORCE_ATTENDANCE_STATION_NOT_FOUND" ? 404 : 409
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    console.error("[workforce/attendance/stations/:id/qr POST]", error)
    return NextResponse.json({ error: "Failed to issue attendance QR" }, { status: 500 })
  }
})
