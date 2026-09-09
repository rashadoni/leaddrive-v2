import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireMobilePermission } from "@/lib/mtm/mobile-capabilities"
import { withMobileRls } from "@/lib/with-mobile-rls"
import {
  proveWorkforceAttendanceDeviceEnrollment,
  WorkforceAttendanceEnrollmentProofSchema,
  WorkforceAttendanceManagementError,
} from "@/lib/workforce/attendance-management"
import { workforceAttendanceAddonDisabled } from "@/lib/workforce/attendance-route"

type RouteContext = { params: Promise<{ id: string }> }

/** Completes proof-of-possession; manager approval remains a separate safety gate. */
export const POST = withMobileRls<RouteContext>(async (req: NextRequest, auth, { params }) => {
  if (auth.tenantCapabilities.attendanceDeviceTrust !== true) {
    return workforceAttendanceAddonDisabled("deviceTrust")
  }
  const forbidden = requireMobilePermission(auth, "WORKTIME_SELF_MUTATE")
  if (forbidden) return forbidden
  const { id } = await params
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) {
    return NextResponse.json({ error: "Invalid attendance device enrollment id" }, { status: 400 })
  }
  const parsed = WorkforceAttendanceEnrollmentProofSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid attendance device proof" }, { status: 400 })
  }
  try {
    const enrollment = await proveWorkforceAttendanceDeviceEnrollment(prisma, {
      organizationId: auth.orgId,
      agentId: auth.agentId,
      enrollmentId: id,
      ...parsed.data,
    })
    return NextResponse.json({ success: true, data: { enrollment } })
  } catch (error) {
    if (error instanceof WorkforceAttendanceManagementError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    console.error("[mtm/mobile/attendance/devices/enrollments/:id/proof POST]", error)
    return NextResponse.json({ error: "Failed to prove attendance device enrollment" }, { status: 500 })
  }
}, { requiredCapability: "workforce-hrm" })
