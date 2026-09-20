import { createHash } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AuthResult } from "@/lib/api-auth"

const deps = vi.hoisted(() => {
  const intentFindFirst = vi.fn()
  const intentUpdateMany = vi.fn(async () => ({ count: 1 }))
  const eventFindFirst = vi.fn()
  const eventCreate = vi.fn(async () => ({ id: "event-1" }))
  const transactionClient = {
    aiActionIntent: { findFirst: intentFindFirst, updateMany: intentUpdateMany },
    aiActionIntentEvent: { findFirst: eventFindFirst, create: eventCreate },
  }
  return {
    intentFindFirst,
    intentUpdateMany,
    eventFindFirst,
    eventCreate,
    transactionClient,
    transaction: vi.fn(async (
      callback: (tx: typeof transactionClient) => Promise<unknown>,
    ) => callback(transactionClient)),
    revalidate: vi.fn(async () => {}),
  }
})

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiActionIntent: { findFirst: deps.intentFindFirst },
    aiActionIntentEvent: { findFirst: deps.eventFindFirst },
    $transaction: deps.transaction,
  },
}))

vi.mock("@/lib/ai/voice/action-draft", () => ({
  revalidateAiVoiceActionExecutionAccess: deps.revalidate,
}))

import {
  claimAiVoiceActionExecution,
  failClaimedAiVoiceActionExecution,
  recoverAiVoiceActionExecutionLease,
} from "@/lib/ai/voice/action-execution-claim"

const auth: AuthResult = {
  orgId: "org-1",
  userId: "user-1",
  role: "manager",
  email: "manager@example.com",
  name: "Manager",
  principalType: "session",
}

const confirmationToken = "voice-confirmation-token"
const confirmationEventId = "confirmation-event-1"
const expiredLeaseToken = "11111111-1111-4111-8111-111111111111"

function tokenHash(token: string): string {
  return createHash("sha256")
    .update("leaddrive:ai-action-confirmation:v1\n", "utf8")
    .update(token, "utf8")
    .digest("hex")
}

function tokenHashForLease(token: string): string {
  return createHash("sha256")
    .update("leaddrive:ai-action-execution-lease:v1\n", "utf8")
    .update(token, "utf8")
    .digest("hex")
}

function proofEvent(expiresAt = new Date(Date.now() + 60_000)) {
  return {
    id: confirmationEventId,
    organizationId: "org-1",
    intentId: "intent-1",
    userId: "user-1",
    eventType: "confirmation_proof_issued",
    intentRevision: 2,
    payloadHash: "a".repeat(64),
    eventData: {
      tokenHash: tokenHash(confirmationToken),
      expiresAt: expiresAt.toISOString(),
    },
  }
}

function claimInput() {
  return {
    intentId: "intent-1",
    confirmationEventId,
    confirmationToken,
    expectedRevision: 2,
    payloadHash: "a".repeat(64),
  }
}

function executingIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: "intent-1",
    organizationId: "org-1",
    userId: "user-1",
    state: "executing",
    revision: 2,
    payloadHash: "a".repeat(64),
    expiresAt: new Date(Date.now() + 600_000),
    confirmedAt: new Date(),
    executionStartedAt: new Date(),
    executionLeaseToken: expiredLeaseToken,
    executionLeaseExpiresAt: new Date(Date.now() + 60_000),
    errorCode: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  deps.intentUpdateMany.mockResolvedValue({ count: 1 })
  deps.eventCreate.mockResolvedValue({ id: "event-1" })
  deps.revalidate.mockResolvedValue(undefined)
})

describe("AI voice action execution claim lifecycle", () => {
  it("consumes one proof and claims execution atomically", async () => {
    const proof = proofEvent()
    deps.eventFindFirst
      .mockResolvedValueOnce(proof)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(proof)
      .mockResolvedValueOnce(null)

    const result = await claimAiVoiceActionExecution(auth, claimInput())

    expect(result).toMatchObject({
      intentId: "intent-1",
      state: "executing",
      revision: 2,
      replayed: false,
      recovered: false,
    })
    expect(result.executionLeaseToken).toMatch(/^[0-9a-f-]{36}$/)
    expect(deps.revalidate).toHaveBeenCalledWith(auth, {
      intentId: "intent-1",
      expectedRevision: 2,
      payloadHash: "a".repeat(64),
      expectedState: "awaiting_confirmation",
    })
    expect(deps.intentUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "intent-1",
        organizationId: "org-1",
        userId: "user-1",
        parentIntentId: null,
        state: "awaiting_confirmation",
        revision: 2,
        payloadHash: "a".repeat(64),
      }),
      data: expect.objectContaining({
        state: "executing",
        executionLeaseToken: result.executionLeaseToken,
      }),
    })
    expect(deps.eventCreate).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        eventType: "confirmation_consumed",
        correlationId: confirmationEventId,
      }),
    })
    expect(deps.eventCreate).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        eventType: "execution_claimed",
        correlationId: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    })
    expect(JSON.stringify(deps.eventCreate.mock.calls)).not.toContain(result.executionLeaseToken)
  })

  it("rejects an expired unused proof before access revalidation", async () => {
    deps.eventFindFirst
      .mockResolvedValueOnce(proofEvent(new Date(Date.now() - 1)))
      .mockResolvedValueOnce(null)

    await expect(claimAiVoiceActionExecution(auth, claimInput())).rejects.toMatchObject({
      code: "CONFIRMATION_PROOF_EXPIRED",
      status: 409,
    })
    expect(deps.revalidate).not.toHaveBeenCalled()
    expect(deps.transaction).not.toHaveBeenCalled()
  })

  it("replays an already consumed proof after proof expiry without reclaiming", async () => {
    deps.eventFindFirst
      .mockResolvedValueOnce(proofEvent(new Date(Date.now() - 60_000)))
      .mockResolvedValueOnce({ id: "consumed-event-1" })
    deps.intentFindFirst.mockResolvedValueOnce(executingIntent())

    const replay = await claimAiVoiceActionExecution(auth, claimInput())

    expect(replay).toMatchObject({ state: "executing", replayed: true, recovered: false })
    expect(deps.revalidate).not.toHaveBeenCalled()
    expect(deps.intentUpdateMany).not.toHaveBeenCalled()
  })

  it("rejects a competing proof when the state CAS loses", async () => {
    const proof = proofEvent()
    deps.eventFindFirst
      .mockResolvedValueOnce(proof)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(proof)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    deps.intentUpdateMany.mockResolvedValueOnce({ count: 0 })

    await expect(claimAiVoiceActionExecution(auth, claimInput())).rejects.toMatchObject({
      code: "EXECUTION_CLAIM_CONFLICT",
      status: 409,
    })
    expect(deps.eventCreate).not.toHaveBeenCalled()
  })

  it("replays the winner when a concurrent retry of the same proof loses CAS", async () => {
    const proof = proofEvent()
    deps.eventFindFirst
      .mockResolvedValueOnce(proof)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(proof)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "consumed-event-1" })
    deps.intentUpdateMany.mockResolvedValueOnce({ count: 0 })
    deps.intentFindFirst.mockResolvedValueOnce(executingIntent())

    const replay = await claimAiVoiceActionExecution(auth, claimInput())

    expect(replay).toMatchObject({ state: "executing", replayed: true })
    expect(deps.eventCreate).not.toHaveBeenCalled()
  })

  it("rejects a token that does not match the stored proof hash", async () => {
    deps.eventFindFirst.mockResolvedValueOnce(proofEvent())

    await expect(claimAiVoiceActionExecution(auth, {
      ...claimInput(),
      confirmationToken: "different-token",
    })).rejects.toMatchObject({ code: "CONFIRMATION_TOKEN_INVALID", status: 409 })
    expect(deps.revalidate).not.toHaveBeenCalled()
  })

  it("recovers only the exact expired lease after revalidating access", async () => {
    const result = await recoverAiVoiceActionExecutionLease(auth, {
      intentId: "intent-1",
      expectedRevision: 2,
      payloadHash: "a".repeat(64),
      expiredLeaseToken,
    })

    expect(result).toMatchObject({ state: "executing", recovered: true, replayed: false })
    expect(result.executionLeaseToken).not.toBe(expiredLeaseToken)
    expect(deps.revalidate).toHaveBeenCalledWith(auth, expect.objectContaining({
      expectedState: "executing",
    }))
    expect(deps.intentUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        organizationId: "org-1",
        userId: "user-1",
        state: "executing",
        executionLeaseToken: expiredLeaseToken,
        executionLeaseExpiresAt: { lte: expect.any(Date) },
      }),
      data: expect.objectContaining({ executionLeaseToken: result.executionLeaseToken }),
    })
    expect(deps.eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "execution_lease_recovered",
        correlationId: expect.stringMatching(/^[0-9a-f]{64}$/),
        eventData: expect.objectContaining({
          leaseHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
      }),
    })
    expect(JSON.stringify(deps.eventCreate.mock.calls)).not.toContain(expiredLeaseToken)
  })

  it("replays recovery of the same expired lease without rotating again", async () => {
    const recoveredLeaseToken = "22222222-2222-4222-8222-222222222222"
    deps.eventFindFirst.mockResolvedValueOnce({
      eventData: { leaseHash: tokenHashForLease(recoveredLeaseToken) },
    })
    deps.intentFindFirst.mockResolvedValueOnce(executingIntent({
      executionLeaseToken: recoveredLeaseToken,
    }))

    const replay = await recoverAiVoiceActionExecutionLease(auth, {
      intentId: "intent-1",
      expectedRevision: 2,
      payloadHash: "a".repeat(64),
      expiredLeaseToken,
    })

    expect(replay).toMatchObject({
      state: "executing",
      executionLeaseToken: recoveredLeaseToken,
      recovered: true,
      replayed: true,
    })
    expect(deps.revalidate).not.toHaveBeenCalled()
    expect(deps.intentUpdateMany).not.toHaveBeenCalled()
    expect(deps.eventCreate).not.toHaveBeenCalled()
  })

  it("does not recover an active or already replaced lease", async () => {
    deps.intentUpdateMany.mockResolvedValueOnce({ count: 0 })

    await expect(recoverAiVoiceActionExecutionLease(auth, {
      intentId: "intent-1",
      expectedRevision: 2,
      payloadHash: "a".repeat(64),
      expiredLeaseToken,
    })).rejects.toMatchObject({ code: "EXECUTION_LEASE_NOT_RECOVERABLE", status: 409 })
    expect(deps.eventCreate).not.toHaveBeenCalled()
  })

  it("replays the winner when concurrent recovery replaces the expired lease", async () => {
    const recoveredLeaseToken = "33333333-3333-4333-8333-333333333333"
    deps.eventFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        eventData: { leaseHash: tokenHashForLease(recoveredLeaseToken) },
      })
    deps.intentUpdateMany.mockResolvedValueOnce({ count: 0 })
    deps.intentFindFirst.mockResolvedValueOnce(executingIntent({
      executionLeaseToken: recoveredLeaseToken,
    }))

    const replay = await recoverAiVoiceActionExecutionLease(auth, {
      intentId: "intent-1",
      expectedRevision: 2,
      payloadHash: "a".repeat(64),
      expiredLeaseToken,
    })

    expect(replay).toMatchObject({
      executionLeaseToken: recoveredLeaseToken,
      recovered: true,
      replayed: true,
    })
    expect(deps.eventCreate).not.toHaveBeenCalled()
  })

  it("settles a current lease as a bounded terminal failure and replays it", async () => {
    deps.intentFindFirst.mockResolvedValueOnce(executingIntent())

    const failed = await failClaimedAiVoiceActionExecution(auth, {
      intentId: "intent-1",
      executionLeaseToken: expiredLeaseToken,
      errorCode: "TARGET_STALE",
      safeMessage: "The lead changed after confirmation",
    })

    expect(failed).toEqual({
      intentId: "intent-1",
      state: "failed",
      errorCode: "TARGET_STALE",
      replayed: false,
    })
    expect(deps.intentUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        organizationId: "org-1",
        userId: "user-1",
        state: "executing",
        executionLeaseToken: expiredLeaseToken,
        executionLeaseExpiresAt: { gt: expect.any(Date) },
      }),
      data: expect.objectContaining({
        state: "failed",
        errorCode: "TARGET_STALE",
        errorDetail: { message: "The lead changed after confirmation" },
      }),
    })
    expect(deps.eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "failed",
        correlationId: expect.stringMatching(/^[0-9a-f]{64}$/),
        eventData: { errorCode: "TARGET_STALE" },
      }),
    })
    expect(JSON.stringify(deps.eventCreate.mock.calls)).not.toContain(expiredLeaseToken)

    vi.clearAllMocks()
    deps.intentFindFirst.mockResolvedValueOnce(executingIntent({
      state: "failed",
      errorCode: "TARGET_STALE",
    }))
    const replay = await failClaimedAiVoiceActionExecution(auth, {
      intentId: "intent-1",
      executionLeaseToken: expiredLeaseToken,
      errorCode: "TARGET_STALE",
    })
    expect(replay.replayed).toBe(true)
    expect(deps.intentUpdateMany).not.toHaveBeenCalled()
    expect(deps.eventCreate).not.toHaveBeenCalled()
  })

  it("rejects unsafe terminal error codes", async () => {
    await expect(failClaimedAiVoiceActionExecution(auth, {
      intentId: "intent-1",
      executionLeaseToken: expiredLeaseToken,
      errorCode: "raw database error",
    })).rejects.toMatchObject({ code: "INVALID_ERROR_CODE", status: 400 })
    expect(deps.transaction).not.toHaveBeenCalled()
  })
})
