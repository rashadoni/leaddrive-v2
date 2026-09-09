import crypto from "node:crypto"
import type { Prisma } from "@prisma/client"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withSocialMonitoringMutationFence } from "@/lib/social/with-monitoring-mutation-fence"

const schema = z.object({
  decision: z.enum(["APPROVED", "REJECTED", "CHANGES_REQUESTED"]),
  reason: z.string().trim().max(1000).optional(),
})

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withSocialMonitoringMutationFence("social-legal", "write", async (req: NextRequest, auth, context: RouteContext) => {
  const { id } = await context.params
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid approval" }, { status: 400 })
  const action = await prisma.socialLegalAction.findFirst({
    where: { organizationId: auth.orgId, id },
    include: { case: { select: { id: true, status: true } } },
  })
  if (!action) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (action.status === "COMPLETED") return NextResponse.json({ error: "Completed action is immutable" }, { status: 409 })
  const contentSha256 = crypto.createHash("sha256").update(JSON.stringify({
    actionId: action.id,
    actionType: action.actionType,
    content: action.content,
    rationale: action.rationale,
    decision: parsed.data.decision,
  })).digest("hex")
  const approval = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const created = await tx.socialLegalApproval.create({
      data: {
        organizationId: auth.orgId,
        caseId: action.caseId,
        actionId: action.id,
        decision: parsed.data.decision,
        contentSha256,
        policySnapshot: { requiresHumanReview: true, liveSendAllowed: false },
        approvedBy: auth.userId,
        reason: parsed.data.reason ?? null,
      },
    })
    await tx.socialLegalAction.update({
      where: { organizationId_id: { organizationId: auth.orgId, id: action.id } },
      data: { status: parsed.data.decision === "APPROVED" ? "APPROVED" : "REJECTED" },
    })
    await tx.socialLegalEvent.create({
      data: {
        organizationId: auth.orgId,
        caseId: action.caseId,
        eventType: "ACTION_REVIEWED",
        actorType: "USER",
        actorId: auth.userId,
        payload: { actionId: action.id, approvalId: created.id, decision: parsed.data.decision, contentSha256 },
      },
    })
    return created
  })
  return NextResponse.json({ success: true, data: approval }, { status: 201 })
})
