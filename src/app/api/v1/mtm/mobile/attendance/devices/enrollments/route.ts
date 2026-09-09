import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireMobilePermission } from "@/lib/mtm/mobile-capabilities"
import { withMobileRls } from "@/lib/with-mobile-rls"
import {
  beginWorkforceAttendanceDeviceEnrollment,
  WorkforceAttendanceEnrollmentCreateSchema,
  WorkforceAttendanceManagementError,
} from "@/lib/workforce/attendance-management"
import { workforceAttendanceAddonDisabled } from "@/lib/workforce/attendance-route"

/** Lists only the authenticated employee's audit-safe enrollment lifecycle. */
export const GET = withMobileRls(async (_req: NextRequest, auth) => {
  if (auth.tenantCapabilities.attendanceDeviceTrust !== true) {
    return workforceAttendanceAddonDisabled("deviceTrust")
  }
  const forbidden = requireMobilePermission(auth, "WORKTIME_SELF_READ")
  if (forbidden) return forbidden
  try {
    const enrollments = await prisma.workforceAttendanceDeviceEnrollment.findMany({
      where: { organizationId: auth.orgId, agentId: auth.agentId },
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        deviceLabel: true,
        publicKeyFingerprint: true,
        status: true,
        keyVerifiedAt: true,
        approvedAt: true,
        revokedAt: true,
        replacesEnrollmentId: true,
        createdAt: true,
      },
    })
    return NextResponse.json({ success: true, data: { enrollments } })
  } catch (error) {
    console.error("[mtm/mobile/attendance/devices/enrollments GET]", error)
    return NextResponse.json({ error: "Failed to load attendance device enrollments" }, { status: 500 })
  }
}, { requiredCapability: "workforce-hrm" })

/** Start a self-only device enrollment. The raw one-time challenge is returned once. */
export const POST = withMobileRls(async (req: NextRequest, auth) => {
  if (auth.tenantCapabilities.attendanceDeviceTrust !== true) {
    return workforceAttendanceAddonDisabled("deviceTrust")
  }
  const forbidden = requireMobilePermission(auth, "WORKTIME_SELF_MUTATE")
  if (forbidden) return forbidden
  const parsed = WorkforceAttendanceEnrollmentCreateSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid attendance device enrollment" }, { status: 400 })
  }
  try {
    const result = await beginWorkforceAttendanceDeviceEnrollment(prisma, {
      organizationId: auth.orgId,
      agentId: auth.agentId,
      ...parsed.data,
    })
    return NextResponse.json({
      success: true,
      data: {
        enrollment: result.enrollment,
        challenge: result.challenge,
        expiresAt: result.expiresAt,
      },
    }, { status: 201 })
  } catch (error) {
    if (error instanceof WorkforceAttendanceManagementError) {
      const status = error.code === "WORKFORCE_ATTENDANCE_ENROLLMENT_KEY_INVALID" ? 400 : 409
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    console.error("[mtm/mobile/attendance/devices/enrollments POST]", error)
    return NextResponse.json({ error: "Failed to begin attendance device enrollment" }, { status: 500 })
  }
}, { requiredCapability: "workforce-hrm" })
