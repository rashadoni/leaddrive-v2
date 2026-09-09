import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withWorkforceRlsAuth } from "@/lib/with-workforce-rls-auth"
import { requireWorkforceAttendanceAdminAddon } from "@/lib/workforce/attendance-route"

/** Lists audit-safe device enrollment metadata, never public keys or proofs. */
export const GET = withWorkforceRlsAuth("read", async (_req: NextRequest, auth) => {
  const denied = await requireWorkforceAttendanceAdminAddon(auth.orgId, auth, "deviceTrust")
  if (denied) return denied
  try {
    const enrollments = await prisma.workforceAttendanceDeviceEnrollment.findMany({
      where: { organizationId: auth.orgId },
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        agentId: true,
        deviceLabel: true,
        publicKeyFingerprint: true,
        status: true,
        keyVerifiedAt: true,
        approvedAt: true,
        revokedAt: true,
        replacesEnrollmentId: true,
        createdAt: true,
        agent: { select: { id: true, name: true } },
      },
    })
    return NextResponse.json({ success: true, data: { enrollments } })
  } catch (error) {
    console.error("[workforce/attendance/devices GET]", error)
    return NextResponse.json({ error: "Failed to load attendance devices" }, { status: 500 })
  }
})
