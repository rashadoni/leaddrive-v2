import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { withInboxSessionWrite } from "@/lib/inbox/route-auth"

const bodySchema = z.object({
  attemptId: z.string().min(1).max(128),
  outcome: z.enum(["delivered", "not_delivered"]),
  confirmation: z.literal("verified_in_chatwoot"),
})
const MIN_RECONCILIATION_AGE_MS = 60_000
const MAX_RECONCILIATION_BODY_SIZE = 8 * 1024

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/**
 * Explicit recovery for an ambiguous Chatwoot POST.
 *
 * LeadDrive cannot infer "not delivered" from a timeout or from a temporarily
 * absent provider readback. The operator must inspect the Chatwoot conversation
 * and confirm the outcome. The attempt id is server-issued, tenant/conversation
 * scoped, and reconciled under the same lock as new delivery claims.
 */
export const POST = withInboxSessionWrite(async (req, auth, { params }: {
  params: Promise<{ id: string }>
}) => {
  const requestBody = await readJsonRequestWithinLimit(req, MAX_RECONCILIATION_BODY_SIZE)
  if (!requestBody.ok) {
    return NextResponse.json(
      { error: requestBody.reason === "too_large" ? "Request body too large" : "Invalid reconciliation confirmation" },
      { status: requestBody.reason === "too_large" ? 413 : 400 },
    )
  }
  const parsed = bodySchema.safeParse(requestBody.value)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid reconciliation confirmation" }, { status: 400 })
  }
  const { id: conversationId } = await params
  const { attemptId, outcome } = parsed.data

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`chatwoot-delivery:${auth.orgId}:${conversationId}`}, 0))`

    const conversation = await tx.socialConversation.findFirst({
      where: { id: conversationId, organizationId: auth.orgId, platform: "tiktok" },
      select: { id: true },
    })
    if (!conversation) return { kind: "missing" as const }

    const attempt = await tx.channelMessage.findFirst({
      where: {
        id: attemptId,
        organizationId: auth.orgId,
        conversationId,
        direction: "outbound",
        channelType: "tiktok",
      },
      select: {
        id: true,
        status: true,
        body: true,
        contactId: true,
        createdAt: true,
        metadata: true,
      },
    })
    if (!attempt) return { kind: "missing" as const }

    const metadata = metadataRecord(attempt.metadata)
    const prior = metadata.deliveryReconciliation
    if (prior && typeof prior === "object" && !Array.isArray(prior)) {
      const priorOutcome = (prior as Record<string, unknown>).outcome
      return priorOutcome === outcome
        ? { kind: "replayed" as const, messageId: attempt.id, outcome }
        : { kind: "conflict" as const }
    }

    const unresolved =
      (attempt.status === "pending" && metadata.deliveryAttempted === true)
      || (attempt.status === "failed" && metadata.deliveryUnknown === true)
    if (!unresolved) return { kind: "conflict" as const }
    if (Date.now() - attempt.createdAt.getTime() < MIN_RECONCILIATION_AGE_MS) {
      return { kind: "too_recent" as const }
    }

    const reconciledAt = new Date()
    const nextMetadata = {
      ...metadata,
      deliveryUnknown: false,
      deliveryConfirmed: outcome === "delivered",
      deliveryReconciliation: {
        outcome,
        method: "operator_chatwoot_check",
        verifiedBy: auth.userId,
        verifiedAt: reconciledAt.toISOString(),
      },
    }
    await tx.channelMessage.updateMany({
      where: { id: attempt.id, organizationId: auth.orgId },
      data: {
        status: outcome === "delivered" ? "delivered" : "failed",
        metadata: nextMetadata,
      },
    })

    if (outcome === "delivered") {
      await tx.socialConversation.updateMany({
        where: { id: conversationId, organizationId: auth.orgId },
        data: { lastMessage: attempt.body, lastMessageAt: reconciledAt },
      })
      if (attempt.contactId) {
        await tx.contact.updateMany({
          where: { id: attempt.contactId, organizationId: auth.orgId },
          data: { lastContactAt: reconciledAt },
        })
      }
    }

    return { kind: "reconciled" as const, messageId: attempt.id, outcome }
  })

  if (result.kind === "missing") {
    return NextResponse.json({ error: "Unresolved Chatwoot attempt not found" }, { status: 404 })
  }
  if (result.kind === "conflict") {
    return NextResponse.json({ error: "Chatwoot attempt is no longer unresolved" }, { status: 409 })
  }
  if (result.kind === "too_recent") {
    return NextResponse.json({
      error: "Wait one minute for the in-flight Chatwoot request to finish before reconciling",
    }, { status: 409 })
  }
  return NextResponse.json({
    success: true,
    data: {
      messageId: result.messageId,
      outcome: result.outcome,
      replayed: result.kind === "replayed",
    },
  })
})
