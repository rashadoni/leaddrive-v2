import crypto from "node:crypto"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { evaluateOutboundReplyGates, isTerminalOutboundInvalidation } from "@/lib/social/outbound-service"
import {
  getOutboundPublisherAdapter,
  type OutboundPublisherAdapter,
  type OutboundPublishRecord,
} from "@/lib/social/outbound-publisher"

const LEASE_MS = 120_000

export type OutboundWorkerResult = {
  scanned: number
  claimed: number
  sent: number
  failed: number
  canceled: number
  reconciliationRequired: number
  skipped: number
}

export async function processOutboundSocialReplies(options: {
  limit?: number
  now?: Date
  adapter?: OutboundPublisherAdapter
} = {}): Promise<OutboundWorkerResult> {
  const now = options.now ?? new Date()
  const limit = normalizeLimit(options.limit)
  const adapter = options.adapter ?? getOutboundPublisherAdapter()
  const candidates = await prisma.outboundSocialReply.findMany({
    where: {
      state: { in: ["QUEUED", "FAILED"] },
      attemptCount: { lt: 3 },
      AND: [
        { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        { OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] },
      ],
    },
    select: { id: true, organizationId: true },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: limit,
  })
  const result: OutboundWorkerResult = {
    scanned: candidates.length,
    claimed: 0,
    sent: 0,
    failed: 0,
    canceled: 0,
    reconciliationRequired: 0,
    skipped: 0,
  }

  for (const candidate of candidates) {
    const leaseToken = crypto.randomUUID()
    const leaseExpiresAt = new Date(now.getTime() + LEASE_MS)
    const claim = await prisma.outboundSocialReply.updateMany({
      where: {
        id: candidate.id,
        organizationId: candidate.organizationId,
        state: { in: ["QUEUED", "FAILED"] },
        attemptCount: { lt: 3 },
        AND: [
          { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
          { OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] },
        ],
      },
      data: {
        state: "SENDING",
        leaseToken,
        leaseExpiresAt,
        attemptCount: { increment: 1 },
        providerRequestId: crypto.randomUUID(),
        lastError: null,
      },
    })
    if (claim.count !== 1) {
      result.skipped += 1
      continue
    }
    result.claimed += 1
    await appendEvent(candidate.organizationId, candidate.id, "OUTBOUND_CLAIMED", "QUEUED", "SENDING", {
      leaseTokenHash: sha256(leaseToken),
      leaseExpiresAt: leaseExpiresAt.toISOString(),
    })

    const gate = await evaluateOutboundReplyGates(candidate.organizationId, candidate.id, now)
    if (!gate.allowed) {
      const terminal = gate.terminal || isTerminalOutboundInvalidation(gate.reason)
      const state = terminal ? "CANCELED" : "FAILED"
      const transitioned = await transitionClaim({
        organizationId: candidate.organizationId,
        id: candidate.id,
        leaseToken,
        state,
        error: gate.reason,
        nextAttemptAt: terminal ? null : new Date(now.getTime() + 15 * 60_000),
        policySnapshot: gate.snapshot,
        canceledAt: terminal ? now : null,
      })
      if (transitioned) {
        if (terminal) result.canceled += 1
        else result.failed += 1
        await appendEvent(candidate.organizationId, candidate.id, terminal ? "OUTBOUND_APPROVAL_INVALIDATED" : "OUTBOUND_GATE_BLOCKED", "SENDING", state, gate.snapshot)
      } else result.skipped += 1
      continue
    }

    const record = await loadPublishRecord(candidate.organizationId, candidate.id)
    if (!record) {
      await transitionClaim({ organizationId: candidate.organizationId, id: candidate.id, leaseToken, state: "CANCELED", error: "outbound_record_missing", nextAttemptAt: null, canceledAt: now })
      result.canceled += 1
      continue
    }

    const publishResult = await adapter.publish(record)
    if (publishResult.outcome === "SENT") {
      const sent = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const updated = await tx.outboundSocialReply.updateMany({
          where: { organizationId: candidate.organizationId, id: candidate.id, state: "SENDING", leaseToken },
          data: {
            state: "SENT",
            externalReplyId: publishResult.externalReplyId,
            sentAt: now,
            nextAttemptAt: null,
            leaseToken: null,
            leaseExpiresAt: null,
            currentPolicySnapshot: gate.snapshot as Prisma.InputJsonValue,
          },
        })
        if (updated.count !== 1) return false
        await tx.socialMention.updateMany({
          where: { organizationId: candidate.organizationId, id: record.mention.id },
          data: { status: "replied", handledAt: now },
        })
        await tx.outboundSocialReplyEvent.create({
          data: {
            organizationId: candidate.organizationId,
            outboundReplyId: candidate.id,
            eventType: "OUTBOUND_SENT",
            fromState: "SENDING",
            toState: "SENT",
            actorType: "WORKER",
            payload: { provider: publishResult.provider, externalReplyId: publishResult.externalReplyId },
          },
        })
        return true
      })
      if (sent) result.sent += 1
      else result.skipped += 1
      continue
    }

    if (publishResult.outcome === "UNKNOWN") {
      const transitioned = await transitionClaim({
        organizationId: candidate.organizationId,
        id: candidate.id,
        leaseToken,
        state: "RECONCILIATION_REQUIRED",
        error: publishResult.error,
        nextAttemptAt: null,
        policySnapshot: gate.snapshot,
        unknownOutcomeAt: now,
      })
      if (transitioned) {
        result.reconciliationRequired += 1
        await appendEvent(candidate.organizationId, candidate.id, "OUTBOUND_RESULT_UNKNOWN", "SENDING", "RECONCILIATION_REQUIRED", {
          provider: publishResult.provider,
          error: publishResult.error,
          automaticRetryAllowed: false,
        })
      } else result.skipped += 1
      continue
    }

    const current = await prisma.outboundSocialReply.findFirst({
      where: { organizationId: candidate.organizationId, id: candidate.id },
      select: { attemptCount: true, maxAttempts: true },
    })
    const retry = publishResult.retriable && Boolean(current && current.attemptCount < current.maxAttempts)
    const transitioned = await transitionClaim({
      organizationId: candidate.organizationId,
      id: candidate.id,
      leaseToken,
      state: "FAILED",
      error: publishResult.error,
      nextAttemptAt: retry ? new Date(now.getTime() + retryDelayMs(current?.attemptCount ?? 1)) : null,
      policySnapshot: gate.snapshot,
    })
    if (transitioned) {
      result.failed += 1
      await appendEvent(candidate.organizationId, candidate.id, "OUTBOUND_DEFINITE_FAILURE", "SENDING", "FAILED", {
        provider: publishResult.provider,
        error: publishResult.error,
        retryScheduled: retry,
      })
    } else result.skipped += 1
  }
  return result
}

export async function reconcileOutboundSocialReplies(options: {
  limit?: number
  adapter?: OutboundPublisherAdapter
} = {}) {
  const adapter = options.adapter ?? getOutboundPublisherAdapter()
  const rows = await prisma.outboundSocialReply.findMany({
    where: { state: "RECONCILIATION_REQUIRED" },
    select: { id: true, organizationId: true },
    orderBy: { unknownOutcomeAt: "asc" },
    take: normalizeLimit(options.limit),
  })
  const result = { scanned: rows.length, sent: 0, notSent: 0, unknown: 0 }
  for (const row of rows) {
    const record = await loadPublishRecord(row.organizationId, row.id)
    if (!record) {
      result.unknown += 1
      continue
    }
    const reconciliation = await adapter.reconcile(record)
    if (reconciliation.outcome === "SENT") {
      const reconciledAt = new Date()
      const reconciled = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const updated = await tx.outboundSocialReply.updateMany({
          where: { organizationId: row.organizationId, id: row.id, state: "RECONCILIATION_REQUIRED" },
          data: { state: "SENT", externalReplyId: reconciliation.externalReplyId, sentAt: reconciledAt, lastError: null },
        })
        if (updated.count !== 1) return false
        await tx.socialMention.updateMany({
          where: { organizationId: row.organizationId, id: record.mention.id },
          data: { status: "replied", handledAt: reconciledAt },
        })
        await tx.outboundSocialReplyEvent.create({
          data: {
            organizationId: row.organizationId,
            outboundReplyId: row.id,
            eventType: "OUTBOUND_RECONCILED_SENT",
            fromState: "RECONCILIATION_REQUIRED",
            toState: "SENT",
            actorType: "WORKER",
            payload: reconciliation.evidence as Prisma.InputJsonValue,
          },
        })
        return true
      })
      if (reconciled) {
        result.sent += 1
      }
    } else if (reconciliation.outcome === "NOT_SENT") {
      const updated = await prisma.outboundSocialReply.updateMany({
        where: { organizationId: row.organizationId, id: row.id, state: "RECONCILIATION_REQUIRED" },
        data: { state: "FAILED", nextAttemptAt: new Date(), lastError: "reconciled_not_sent" },
      })
      if (updated.count === 1) {
        result.notSent += 1
        await appendEvent(row.organizationId, row.id, "OUTBOUND_RECONCILED_NOT_SENT", "RECONCILIATION_REQUIRED", "FAILED", reconciliation.evidence)
      }
    } else {
      result.unknown += 1
    }
  }
  return result
}

async function loadPublishRecord(organizationId: string, id: string): Promise<OutboundPublishRecord | null> {
  const row = await prisma.outboundSocialReply.findFirst({
    where: { organizationId, id },
    include: {
      mention: true,
      senderAccount: true,
    },
  })
  if (!row) return null
  return {
    id: row.id,
    organizationId: row.organizationId,
    platform: row.platform,
    adapterType: row.adapterType,
    targetExternalId: row.targetExternalId,
    replyText: row.replyText,
    idempotencyKey: row.idempotencyKey,
    providerRequestId: row.providerRequestId,
    externalReplyId: row.externalReplyId,
    mention: {
      id: row.mention.id,
      organizationId: row.organizationId,
      platform: row.mention.platform,
      externalId: row.mention.externalId,
      sourceType: row.mention.sourceType,
      sourceProvider: row.mention.sourceProvider,
      sourceMetadata: row.mention.sourceMetadata,
    },
    senderAccount: {
      id: row.senderAccount.id,
      platform: row.senderAccount.platform,
      handle: row.senderAccount.handle,
      displayName: row.senderAccount.displayName,
      accessToken: row.senderAccount.accessToken,
      tokenExpiresAt: row.senderAccount.tokenExpiresAt,
    },
  }
}

async function transitionClaim(input: {
  organizationId: string
  id: string
  leaseToken: string
  state: "FAILED" | "CANCELED" | "RECONCILIATION_REQUIRED"
  error: string
  nextAttemptAt: Date | null
  policySnapshot?: Record<string, unknown>
  canceledAt?: Date | null
  unknownOutcomeAt?: Date | null
}) {
  const updated = await prisma.outboundSocialReply.updateMany({
    where: { organizationId: input.organizationId, id: input.id, state: "SENDING", leaseToken: input.leaseToken },
    data: {
      state: input.state,
      lastError: input.error.slice(0, 1000),
      nextAttemptAt: input.nextAttemptAt,
      leaseToken: null,
      leaseExpiresAt: null,
      ...(input.policySnapshot ? { currentPolicySnapshot: input.policySnapshot as Prisma.InputJsonValue } : {}),
      ...(input.canceledAt !== undefined ? { canceledAt: input.canceledAt } : {}),
      ...(input.unknownOutcomeAt !== undefined ? { unknownOutcomeAt: input.unknownOutcomeAt } : {}),
    },
  })
  return updated.count === 1
}

async function appendEvent(
  organizationId: string,
  outboundReplyId: string,
  eventType: string,
  fromState: string | null,
  toState: string | null,
  payload: Record<string, unknown>,
) {
  await prisma.outboundSocialReplyEvent.create({
    data: {
      organizationId,
      outboundReplyId,
      eventType,
      fromState,
      toState,
      actorType: "WORKER",
      payload: payload as Prisma.InputJsonValue,
    },
  })
}

function retryDelayMs(attempt: number) {
  return Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1))
}

function normalizeLimit(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return 20
  return Math.max(1, Math.min(Math.trunc(value), 100))
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex")
}
