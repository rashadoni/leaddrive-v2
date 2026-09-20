import { createHash, randomUUID, timingSafeEqual } from "node:crypto"
import { Prisma } from "@prisma/client"
import type { AuthResult } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { revalidateAiVoiceActionExecutionAccess } from "./action-draft"
import { hashAiVoiceActionExecutionLeaseToken } from "./action-execution-lease"

type JsonObject = Record<string, unknown>

const EXECUTION_LEASE_TTL_MS = 60_000
const CONFIRMATION_TOKEN_HASH = /^[0-9a-f]{64}$/
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/

type ClaimableIntent = Readonly<{
  id: string
  organizationId: string
  userId: string
  state: string
  revision: number
  payloadHash: string
  expiresAt: Date
  confirmedAt: Date | null
  executionStartedAt: Date | null
  executionLeaseToken: string | null
  executionLeaseExpiresAt: Date | null
  errorCode: string | null
}>

type ConfirmationProofEvent = Readonly<{
  id: string
  organizationId: string
  intentId: string
  userId: string
  eventType: string
  intentRevision: number
  payloadHash: string
  eventData: unknown
}>

export type ClaimAiVoiceActionExecutionInput = Readonly<{
  intentId: string
  confirmationEventId: string
  confirmationToken: string
  expectedRevision: number
  payloadHash: string
}>

export type RecoverAiVoiceActionExecutionInput = Readonly<{
  intentId: string
  expectedRevision: number
  payloadHash: string
  expiredLeaseToken: string
}>

export type FailClaimedAiVoiceActionExecutionInput = Readonly<{
  intentId: string
  executionLeaseToken: string
  errorCode: string
  safeMessage?: string
}>

export type AiVoiceActionExecutionClaim = Readonly<{
  intentId: string
  state: "executing" | "succeeded" | "failed"
  revision: number
  payloadHash: string
  executionLeaseToken: string
  executionLeaseExpiresAt: string
  replayed: boolean
  recovered: boolean
}>

export type AiVoiceActionFailureResult = Readonly<{
  intentId: string
  state: "failed"
  errorCode: string
  replayed: boolean
}>

export class AiVoiceActionExecutionClaimError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message)
    this.name = "AiVoiceActionExecutionClaimError"
  }
}

function hashConfirmationToken(token: string): string {
  return createHash("sha256")
    .update("leaddrive:ai-action-confirmation:v1\n", "utf8")
    .update(token, "utf8")
    .digest("hex")
}

function constantTimeHashEqual(left: string, right: string): boolean {
  if (!CONFIRMATION_TOKEN_HASH.test(left) || !CONFIRMATION_TOKEN_HASH.test(right)) return false
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"))
}

function proofMetadata(event: ConfirmationProofEvent): Readonly<{
  tokenHash: string
  expiresAt: Date
}> {
  const value = event.eventData
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiVoiceActionExecutionClaimError(
      "INVALID_CONFIRMATION_PROOF",
      "The confirmation proof is invalid",
      409,
    )
  }
  const tokenHash = (value as JsonObject).tokenHash
  const expiresAtValue = (value as JsonObject).expiresAt
  const expiresAt = typeof expiresAtValue === "string" ? new Date(expiresAtValue) : null
  if (
    typeof tokenHash !== "string"
    || !CONFIRMATION_TOKEN_HASH.test(tokenHash)
    || !expiresAt
    || Number.isNaN(expiresAt.getTime())
  ) {
    throw new AiVoiceActionExecutionClaimError(
      "INVALID_CONFIRMATION_PROOF",
      "The confirmation proof is invalid",
      409,
    )
  }
  return { tokenHash, expiresAt }
}

function assertProofMatches(
  event: ConfirmationProofEvent | null,
  input: ClaimAiVoiceActionExecutionInput,
  allowExpired: boolean,
  now: Date,
): ConfirmationProofEvent {
  if (!event) {
    throw new AiVoiceActionExecutionClaimError(
      "CONFIRMATION_PROOF_NOT_FOUND",
      "The confirmation proof was not found",
      404,
    )
  }
  if (
    event.intentId !== input.intentId
    || event.intentRevision !== input.expectedRevision
    || event.payloadHash !== input.payloadHash
  ) {
    throw new AiVoiceActionExecutionClaimError(
      "CONFIRMATION_PROOF_MISMATCH",
      "The confirmation proof does not match the reviewed action",
      409,
    )
  }
  const metadata = proofMetadata(event)
  const suppliedHash = hashConfirmationToken(input.confirmationToken)
  if (!constantTimeHashEqual(metadata.tokenHash, suppliedHash)) {
    throw new AiVoiceActionExecutionClaimError(
      "CONFIRMATION_TOKEN_INVALID",
      "The confirmation token is invalid",
      409,
    )
  }
  if (!allowExpired && metadata.expiresAt <= now) {
    throw new AiVoiceActionExecutionClaimError(
      "CONFIRMATION_PROOF_EXPIRED",
      "The confirmation proof has expired",
      409,
    )
  }
  return event
}

function serializeClaim(
  intent: ClaimableIntent,
  replayed: boolean,
  recovered: boolean,
): AiVoiceActionExecutionClaim {
  if (
    !["executing", "succeeded", "failed"].includes(intent.state)
    || !intent.executionLeaseToken
    || !intent.executionLeaseExpiresAt
  ) {
    throw new AiVoiceActionExecutionClaimError(
      "INVALID_EXECUTION_CLAIM",
      "The stored execution claim is invalid",
      409,
    )
  }
  return {
    intentId: intent.id,
    state: intent.state as AiVoiceActionExecutionClaim["state"],
    revision: intent.revision,
    payloadHash: intent.payloadHash,
    executionLeaseToken: intent.executionLeaseToken,
    executionLeaseExpiresAt: intent.executionLeaseExpiresAt.toISOString(),
    replayed,
    recovered,
  }
}

async function findOwnedProof(
  auth: AuthResult,
  input: ClaimAiVoiceActionExecutionInput,
): Promise<ConfirmationProofEvent | null> {
  return prisma.aiActionIntentEvent.findFirst({
    where: {
      id: input.confirmationEventId,
      organizationId: auth.orgId,
      intentId: input.intentId,
      userId: auth.userId,
      eventType: "confirmation_proof_issued",
    },
  }) as Promise<ConfirmationProofEvent | null>
}

async function findProofConsumption(
  auth: AuthResult,
  input: ClaimAiVoiceActionExecutionInput,
): Promise<{ id: string } | null> {
  return prisma.aiActionIntentEvent.findFirst({
    where: {
      organizationId: auth.orgId,
      intentId: input.intentId,
      userId: auth.userId,
      eventType: "confirmation_consumed",
      correlationId: input.confirmationEventId,
    },
    select: { id: true },
  })
}

async function replayConsumedClaim(
  auth: AuthResult,
  input: ClaimAiVoiceActionExecutionInput,
): Promise<AiVoiceActionExecutionClaim> {
  const intent = await prisma.aiActionIntent.findFirst({
    where: {
      id: input.intentId,
      organizationId: auth.orgId,
      userId: auth.userId,
      parentIntentId: null,
      revision: input.expectedRevision,
      payloadHash: input.payloadHash,
    },
  }) as ClaimableIntent | null
  if (!intent) {
    throw new AiVoiceActionExecutionClaimError(
      "INTENT_NOT_FOUND",
      "The action intent was not found",
      404,
    )
  }
  return serializeClaim(intent, true, false)
}

async function replayRecoveredLease(
  auth: AuthResult,
  input: RecoverAiVoiceActionExecutionInput,
): Promise<AiVoiceActionExecutionClaim | null> {
  const previousLeaseHash = hashAiVoiceActionExecutionLeaseToken(input.expiredLeaseToken)
  const recovery = await prisma.aiActionIntentEvent.findFirst({
    where: {
      organizationId: auth.orgId,
      intentId: input.intentId,
      userId: auth.userId,
      eventType: "execution_lease_recovered",
      correlationId: previousLeaseHash,
    },
    select: { eventData: true },
  })
  const recoveredLeaseHash = recovery?.eventData
    && typeof recovery.eventData === "object"
    && !Array.isArray(recovery.eventData)
    && typeof (recovery.eventData as JsonObject).leaseHash === "string"
    ? (recovery.eventData as JsonObject).leaseHash as string
    : null
  if (!recoveredLeaseHash || !CONFIRMATION_TOKEN_HASH.test(recoveredLeaseHash)) return null
  const intent = await prisma.aiActionIntent.findFirst({
    where: {
      id: input.intentId,
      organizationId: auth.orgId,
      userId: auth.userId,
      parentIntentId: null,
      revision: input.expectedRevision,
      payloadHash: input.payloadHash,
    },
  }) as ClaimableIntent | null
  return intent?.executionLeaseToken
    && constantTimeHashEqual(
      recoveredLeaseHash,
      hashAiVoiceActionExecutionLeaseToken(intent.executionLeaseToken),
    )
    ? serializeClaim(intent, true, true)
    : null
}

/**
 * Consume one browser confirmation proof and claim the intent in the same
 * transaction. This is internal orchestration only; no public commit route is
 * added by this slice.
 */
export async function claimAiVoiceActionExecution(
  auth: AuthResult,
  input: ClaimAiVoiceActionExecutionInput,
): Promise<AiVoiceActionExecutionClaim> {
  const checkedAt = new Date()
  const proof = assertProofMatches(await findOwnedProof(auth, input), input, true, checkedAt)
  if (await findProofConsumption(auth, input)) return replayConsumedClaim(auth, input)

  const metadata = proofMetadata(proof)
  if (metadata.expiresAt <= checkedAt) {
    throw new AiVoiceActionExecutionClaimError(
      "CONFIRMATION_PROOF_EXPIRED",
      "The confirmation proof has expired",
      409,
    )
  }

  await revalidateAiVoiceActionExecutionAccess(auth, {
    intentId: input.intentId,
    expectedRevision: input.expectedRevision,
    payloadHash: input.payloadHash,
    expectedState: "awaiting_confirmation",
  })

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const now = new Date()
    const transactionProof = await tx.aiActionIntentEvent.findFirst({
      where: {
        id: input.confirmationEventId,
        organizationId: auth.orgId,
        intentId: input.intentId,
        userId: auth.userId,
        eventType: "confirmation_proof_issued",
      },
    }) as ConfirmationProofEvent | null
    assertProofMatches(transactionProof, input, false, now)

    const consumed = await tx.aiActionIntentEvent.findFirst({
      where: {
        organizationId: auth.orgId,
        intentId: input.intentId,
        userId: auth.userId,
        eventType: "confirmation_consumed",
        correlationId: input.confirmationEventId,
      },
      select: { id: true },
    })
    if (consumed) {
      const replay = await tx.aiActionIntent.findFirst({
        where: {
          id: input.intentId,
          organizationId: auth.orgId,
          userId: auth.userId,
          parentIntentId: null,
          revision: input.expectedRevision,
          payloadHash: input.payloadHash,
        },
      }) as ClaimableIntent | null
      if (!replay) {
        throw new AiVoiceActionExecutionClaimError("INTENT_NOT_FOUND", "The action intent was not found", 404)
      }
      return serializeClaim(replay, true, false)
    }

    const executionLeaseToken = randomUUID()
    const executionLeaseExpiresAt = new Date(now.getTime() + EXECUTION_LEASE_TTL_MS)
    const changed = await tx.aiActionIntent.updateMany({
      where: {
        id: input.intentId,
        organizationId: auth.orgId,
        userId: auth.userId,
        parentIntentId: null,
        state: "awaiting_confirmation",
        revision: input.expectedRevision,
        payloadHash: input.payloadHash,
        expiresAt: { gt: now },
      },
      data: {
        state: "executing",
        confirmedAt: now,
        executionStartedAt: now,
        executionLeaseToken,
        executionLeaseExpiresAt,
      },
    })
    if (changed.count !== 1) {
      const concurrentConsumption = await tx.aiActionIntentEvent.findFirst({
        where: {
          organizationId: auth.orgId,
          intentId: input.intentId,
          userId: auth.userId,
          eventType: "confirmation_consumed",
          correlationId: input.confirmationEventId,
        },
        select: { id: true },
      })
      if (concurrentConsumption) {
        const replay = await tx.aiActionIntent.findFirst({
          where: {
            id: input.intentId,
            organizationId: auth.orgId,
            userId: auth.userId,
            parentIntentId: null,
            revision: input.expectedRevision,
            payloadHash: input.payloadHash,
          },
        }) as ClaimableIntent | null
        if (replay) return serializeClaim(replay, true, false)
      }
      throw new AiVoiceActionExecutionClaimError(
        "EXECUTION_CLAIM_CONFLICT",
        "The action was changed or claimed by another request",
        409,
      )
    }

    await tx.aiActionIntentEvent.create({
      data: {
        organizationId: auth.orgId,
        intentId: input.intentId,
        userId: auth.userId,
        eventType: "confirmation_consumed",
        intentRevision: input.expectedRevision,
        payloadHash: input.payloadHash,
        correlationId: input.confirmationEventId,
        eventData: { confirmationEventId: input.confirmationEventId },
      },
    })
    await tx.aiActionIntentEvent.create({
      data: {
        organizationId: auth.orgId,
        intentId: input.intentId,
        userId: auth.userId,
        eventType: "execution_claimed",
        intentRevision: input.expectedRevision,
        payloadHash: input.payloadHash,
        correlationId: hashAiVoiceActionExecutionLeaseToken(executionLeaseToken),
        eventData: { leaseExpiresAt: executionLeaseExpiresAt.toISOString() },
      },
    })

    return serializeClaim({
      id: input.intentId,
      organizationId: auth.orgId,
      userId: auth.userId,
      state: "executing",
      revision: input.expectedRevision,
      payloadHash: input.payloadHash,
      expiresAt: executionLeaseExpiresAt,
      confirmedAt: now,
      executionStartedAt: now,
      executionLeaseToken,
      executionLeaseExpiresAt,
      errorCode: null,
    }, false, false)
  })
}

/** Replace only an expired execution lease after repeating mutable access checks. */
export async function recoverAiVoiceActionExecutionLease(
  auth: AuthResult,
  input: RecoverAiVoiceActionExecutionInput,
): Promise<AiVoiceActionExecutionClaim> {
  const replay = await replayRecoveredLease(auth, input)
  if (replay) return replay

  await revalidateAiVoiceActionExecutionAccess(auth, {
    intentId: input.intentId,
    expectedRevision: input.expectedRevision,
    payloadHash: input.payloadHash,
    expectedState: "executing",
  })

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const now = new Date()
    const executionLeaseToken = randomUUID()
    const executionLeaseExpiresAt = new Date(now.getTime() + EXECUTION_LEASE_TTL_MS)
    const previousLeaseHash = hashAiVoiceActionExecutionLeaseToken(input.expiredLeaseToken)
    const executionLeaseHash = hashAiVoiceActionExecutionLeaseToken(executionLeaseToken)
    const changed = await tx.aiActionIntent.updateMany({
      where: {
        id: input.intentId,
        organizationId: auth.orgId,
        userId: auth.userId,
        parentIntentId: null,
        state: "executing",
        revision: input.expectedRevision,
        payloadHash: input.payloadHash,
        executionLeaseToken: input.expiredLeaseToken,
        executionLeaseExpiresAt: { lte: now },
      },
      data: {
        executionLeaseToken,
        executionLeaseExpiresAt,
      },
    })
    if (changed.count !== 1) {
      const concurrentRecovery = await tx.aiActionIntentEvent.findFirst({
        where: {
          organizationId: auth.orgId,
          intentId: input.intentId,
          userId: auth.userId,
          eventType: "execution_lease_recovered",
          correlationId: previousLeaseHash,
        },
        select: { eventData: true },
      })
      const concurrentLeaseHash = concurrentRecovery?.eventData
        && typeof concurrentRecovery.eventData === "object"
        && !Array.isArray(concurrentRecovery.eventData)
        && typeof (concurrentRecovery.eventData as JsonObject).leaseHash === "string"
        ? (concurrentRecovery.eventData as JsonObject).leaseHash as string
        : null
      if (concurrentLeaseHash && CONFIRMATION_TOKEN_HASH.test(concurrentLeaseHash)) {
        const concurrentIntent = await tx.aiActionIntent.findFirst({
          where: {
            id: input.intentId,
            organizationId: auth.orgId,
            userId: auth.userId,
            parentIntentId: null,
            revision: input.expectedRevision,
            payloadHash: input.payloadHash,
          },
        }) as ClaimableIntent | null
        if (
          concurrentIntent?.executionLeaseToken
          && constantTimeHashEqual(
            concurrentLeaseHash,
            hashAiVoiceActionExecutionLeaseToken(concurrentIntent.executionLeaseToken),
          )
        ) {
          return serializeClaim(concurrentIntent, true, true)
        }
      }
      throw new AiVoiceActionExecutionClaimError(
        "EXECUTION_LEASE_NOT_RECOVERABLE",
        "The execution lease is active or has already changed",
        409,
      )
    }
    await tx.aiActionIntentEvent.create({
      data: {
        organizationId: auth.orgId,
        intentId: input.intentId,
        userId: auth.userId,
        eventType: "execution_lease_recovered",
        intentRevision: input.expectedRevision,
        payloadHash: input.payloadHash,
        correlationId: previousLeaseHash,
        eventData: {
          leaseHash: executionLeaseHash,
          leaseExpiresAt: executionLeaseExpiresAt.toISOString(),
        },
      },
    })
    return serializeClaim({
      id: input.intentId,
      organizationId: auth.orgId,
      userId: auth.userId,
      state: "executing",
      revision: input.expectedRevision,
      payloadHash: input.payloadHash,
      expiresAt: executionLeaseExpiresAt,
      confirmedAt: now,
      executionStartedAt: now,
      executionLeaseToken,
      executionLeaseExpiresAt,
      errorCode: null,
    }, false, true)
  })
}

/** Settle a current, unexpired claim as a bounded terminal failure. */
export async function failClaimedAiVoiceActionExecution(
  auth: AuthResult,
  input: FailClaimedAiVoiceActionExecutionInput,
): Promise<AiVoiceActionFailureResult> {
  if (!SAFE_ERROR_CODE.test(input.errorCode)) {
    throw new AiVoiceActionExecutionClaimError("INVALID_ERROR_CODE", "The failure code is invalid", 400)
  }
  if (input.safeMessage !== undefined && (input.safeMessage.length < 1 || input.safeMessage.length > 500)) {
    throw new AiVoiceActionExecutionClaimError("INVALID_ERROR_DETAIL", "The failure detail is invalid", 400)
  }

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.aiActionIntent.findFirst({
      where: {
        id: input.intentId,
        organizationId: auth.orgId,
        userId: auth.userId,
        parentIntentId: null,
      },
    }) as ClaimableIntent | null
    if (!existing) {
      throw new AiVoiceActionExecutionClaimError("INTENT_NOT_FOUND", "The action intent was not found", 404)
    }
    if (
      existing.state === "failed"
      && existing.executionLeaseToken === input.executionLeaseToken
      && existing.errorCode === input.errorCode
    ) {
      return { intentId: existing.id, state: "failed", errorCode: input.errorCode, replayed: true }
    }

    const completedAt = new Date()
    const changed = await tx.aiActionIntent.updateMany({
      where: {
        id: input.intentId,
        organizationId: auth.orgId,
        userId: auth.userId,
        parentIntentId: null,
        state: "executing",
        executionLeaseToken: input.executionLeaseToken,
        executionLeaseExpiresAt: { gt: completedAt },
      },
      data: {
        state: "failed",
        errorCode: input.errorCode,
        ...(input.safeMessage === undefined
          ? {}
          : { errorDetail: { message: input.safeMessage } }),
        completedAt,
      },
    })
    if (changed.count !== 1) {
      throw new AiVoiceActionExecutionClaimError(
        "EXECUTION_CLAIM_LOST",
        "The execution claim changed before failure could be stored",
        409,
      )
    }
    await tx.aiActionIntentEvent.create({
      data: {
        organizationId: auth.orgId,
        intentId: input.intentId,
        userId: auth.userId,
        eventType: "failed",
        intentRevision: existing.revision,
        payloadHash: existing.payloadHash,
        correlationId: hashAiVoiceActionExecutionLeaseToken(input.executionLeaseToken),
        eventData: { errorCode: input.errorCode },
      },
    })
    return { intentId: existing.id, state: "failed", errorCode: input.errorCode, replayed: false }
  })
}
