import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { requireSuperAdmin } from "@/lib/superadmin-guard"

const inputSchema = z.object({ reason: z.string().trim().min(3).max(500).default("Revoked by administrator") })
const REVOCABLE = ["ISSUING", "SENT", "OTP_SENT", "OTP_VERIFIED", "ACTIVE", "DELIVERY_FAILED"]

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireSuperAdmin(request)
  if (actor instanceof NextResponse) return actor

  const payload = await request.json().catch(() => ({}))
  const parsed = inputSchema.safeParse(payload)
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message }, { status: 400 })

  const { id } = await params
  const now = new Date()
  const revoked = await runWithRlsBypass(() => prisma.$transaction(async (tx) => {
    const updated = await tx.demoGrant.updateMany({
      where: { id, status: { in: REVOCABLE } },
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
    if (!updated.count) return false
    await tx.demoAccessEvent.create({
      data: { grantId: id, eventType: "REVOKED", metadata: { reason: parsed.data.reason, actorId: actor.userId } },
    })
    return true
  }))

  if (!revoked) return NextResponse.json({ success: false, error: "Grant is already closed or was not found" }, { status: 409 })
  return NextResponse.json({ success: true, status: "REVOKED" })
}
