import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const schema = z.object({
  outcome: z.enum(["SENT", "NOT_SENT"]),
  externalReplyId: z.string().trim().min(1).max(500).optional(),
  evidence: z.string().trim().min(1).max(2000),
})
type RouteContext = { params: Promise<{ id: string }> }

export const POST = withRlsAuth("social", "write", async (req: NextRequest, auth, context: RouteContext) => {
  if (auth.role !== "admin") return NextResponse.json({ error: "Admin role required" }, { status: 403 })
  const { id } = await context.params
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid resolution" }, { status: 400 })
  if (parsed.data.outcome === "SENT" && !parsed.data.externalReplyId) {
    return NextResponse.json({ error: "externalReplyId is required for a SENT resolution" }, { status: 400 })
  }
  const targetState = parsed.data.outcome === "SENT" ? "SENT" : "FAILED"
  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const outbox = await tx.outboundSocialReply.findFirst({
      where: { organizationId: auth.orgId, id, state: "RECONCILIATION_REQUIRED" },
      select: { mentionId: true },
    })
    if (!outbox) return false
    const resolvedAt = new Date()
    const updated = await tx.outboundSocialReply.updateMany({
      where: { organizationId: auth.orgId, id, state: "RECONCILIATION_REQUIRED" },
      data: {
        state: targetState,
        externalReplyId: parsed.data.externalReplyId ?? null,
        sentAt: parsed.data.outcome === "SENT" ? resolvedAt : null,
        nextAttemptAt: parsed.data.outcome === "NOT_SENT" ? resolvedAt : null,
        lastError: parsed.data.outcome === "NOT_SENT" ? "manually_reconciled_not_sent" : null,
      },
    })
    if (updated.count !== 1) return false
    if (parsed.data.outcome === "SENT") {
      await tx.socialMention.updateMany({
        where: { organizationId: auth.orgId, id: outbox.mentionId },
        data: { status: "replied", handledAt: resolvedAt },
      })
    }
    await tx.outboundSocialReplyEvent.create({
      data: {
        organizationId: auth.orgId,
        outboundReplyId: id,
        eventType: `MANUAL_RECONCILIATION_${parsed.data.outcome}`,
        fromState: "RECONCILIATION_REQUIRED",
        toState: targetState,
        actorType: "USER",
        actorId: auth.userId,
        payload: { evidence: parsed.data.evidence, externalReplyId: parsed.data.externalReplyId ?? null },
      },
    })
    return true
  })
  if (!result) return NextResponse.json({ error: "Outbox item is not awaiting reconciliation" }, { status: 409 })
  return NextResponse.json({ success: true, data: { state: targetState } })
})
