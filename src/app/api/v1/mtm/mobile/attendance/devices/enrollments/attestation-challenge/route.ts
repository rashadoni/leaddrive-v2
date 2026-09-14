import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireMobilePermission } from "@/lib/mtm/mobile-capabilities"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { beginWorkforceAttendanceDeviceAttestationChallenge } from "@/lib/workforce/attendance-management"
import { checkWorkforceAttendanceRateLimit } from "@/lib/workforce/attendance-rate-limit"
import { workforceAttendanceAddonDisabled } from "@/lib/workforce/attendance-route"

/**
 * Issues the server nonce before Android creates a new KeyStore key. It does
 * not enroll a device, accept a certificate, or expose an assurance verdict.
 */
export const POST = withMobileRls(async (_req: NextRequest, auth) => {
  if (auth.tenantCapabilities.attendanceDeviceTrust !== true) {
    return workforceAttendanceAddonDisabled("deviceTrust")
  }
  const forbidden = requireMobilePermission(auth, "WORKTIME_SELF_MUTATE")
  if (forbidden) return forbidden
  const rate = await checkWorkforceAttendanceRateLimit({
    operation: "DEVICE_ENROLLMENT_START",
    organizationId: auth.orgId,
    principalId: auth.agentId,
  })
  if (!rate.allowed) {
    return NextResponse.json({
      error: "Attendance device enrollment rate limit exceeded",
      code: "WORKFORCE_ATTENDANCE_RATE_LIMITED",
      retryAfterSeconds: rate.retryAfterSeconds,
    }, {
      status: 429,
      headers: { "Retry-After": String(rate.retryAfterSeconds), "cache-control": "no-store" },
    })
  }
  try {
    const result = await beginWorkforceAttendanceDeviceAttestationChallenge(prisma, {
      organizationId: auth.orgId,
      agentId: auth.agentId,
    })
    return NextResponse.json({
      success: true,
      data: {
        challenge: result.challenge,
        expiresAt: result.expiresAt,
      },
    }, { status: 201, headers: { "cache-control": "no-store" } })
  } catch (error) {
    console.error("[mtm/mobile/attendance/devices/enrollments/attestation-challenge POST]", error)
    return NextResponse.json({ error: "Failed to begin attendance device attestation" }, { status: 500 })
  }
}, { requiredCapability: "workforce-hrm" })
