import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { attendanceRequestFailure } from "@/lib/mtm/attendance-request-http"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { contentDispositionAttachment } from "@/lib/export/tabular"
import { buildTimeLeaflet } from "@/lib/mtm/attendance-time-leaflet"

/** Personnel → Employees → «Скачать листовку (PDF)»: the QR to Time and the steps, for HR to print. Holds nobody's data. */
export const GET = withMtmAttendanceAuth("read", async (_req, auth) => {
  try {
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_ADMIN_REQUIRED", 403)
    const organization = await prisma.organization.findUnique({ where: { id: auth.orgId }, select: { name: true, slug: true } })
    if (!organization?.slug) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_NOT_FOUND", 404)
    const pdf = await buildTimeLeaflet({ companyName: organization.name, companySlug: organization.slug })
    return new NextResponse(new Uint8Array(pdf), { status: 200, headers: { "Content-Type": "application/pdf", "Content-Disposition": contentDispositionAttachment("time-leaflet.pdf"), "Cache-Control": "private, no-store" } })
  } catch (error) { return attendanceRequestFailure(error) }
})
