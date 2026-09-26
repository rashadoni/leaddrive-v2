import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { demoRejectSchema } from "@/lib/demo-center/validation"
import { runWithRlsBypass } from "@/lib/rls-context"
import { requireSuperAdmin } from "@/lib/superadmin-guard"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireSuperAdmin(request)
  if (actor instanceof NextResponse) return actor
  const parsed = demoRejectSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message }, { status: 400 })

  const { id } = await params
  const now = new Date()
  const result = await runWithRlsBypass(() => prisma.$transaction(async (tx) => {
    const requestRow = await tx.demoRequest.updateMany({
      where: { id, status: { not: "REJECTED" } },
      data: {
        status: "REJECTED",
        reviewedAt: now,
        reviewedBy: actor.userId,
        rejectionReason: parsed.data.reason,
      },
    })
    if (!requestRow.count) return false

    const grants = await tx.demoGrant.findMany({
      where: { requestId: id, status: { in: ["ISSUING", "SENT", "OTP_SENT", "OTP_VERIFIED", "ACTIVE", "DELIVERY_FAILED"] } },
      select: { id: true },
    })
    if (grants.length) {
      await tx.demoGrant.updateMany({
        where: { id: { in: grants.map((grant) => grant.id) } },
        data: {
          status: "REVOKED",
          revokedAt: now,
          revokedBy: actor.userId,
          revocationReason: parsed.data.reason,
          verificationHash: null,
          verificationExpiresAt: null,
          sessionHash: null,
        },
      })
      await tx.demoAccessEvent.createMany({
        data: grants.map((grant) => ({
          grantId: grant.id,
          eventType: "REVOKED",
          metadata: { reason: "request_rejected", actorId: actor.userId },
        })),
      })
    }
    return true
  }))

  if (!result) return NextResponse.json({ success: false, error: "Request was not found or is already rejected" }, { status: 409 })
  return NextResponse.json({ success: true, status: "REJECTED" })
}
