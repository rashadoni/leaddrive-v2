import { afterEach, describe, expect, it, vi } from "vitest"

import { reconcileUncertainVoiceSessionFinality } from "@/lib/voice-agent/provider-finality"

const now = new Date("2026-08-10T09:00:00.000Z")
const providerCallId = "00000000-0000-4000-8000-000000000111"
const featureOptions = {
  executionEnabled: true,
  attemptRegistryEnabled: true,
  pilotOrganizationId: "org-1",
}

function channelConfig() {
  return {
    id: "voip-config",
    configName: "Asterisk",
    phoneNumber: null,
    apiKey: null,
    isActive: true,
    settings: {
      provider: "asterisk",
      ariHost: "pbx.internal",
      ariPort: 8088,
      username: "runtime-user",
      password: "runtime-password",
      context: "from-internal",
      callerExtension: "100",
    },
  }
}

function candidate(queue = false) {
  return {
    id: "session-1",
    providerCallId,
    channelConfigId: "voip-config",
    callLogId: "call-1",
    queueItem: queue
      ? {
          id: "item-1",
          queueId: "queue-1",
          ownerUserId: "seller-1",
          status: "dispatch_uncertain",
        }
      : null,
  }
}

function finalityDb(options?: {
  queue?: boolean
  sessionCount?: number
  itemCount?: number
  remainingItems?: number
  queueStatus?: "attention_required" | "cancelled"
}) {
  const queueStatus = options?.queueStatus ?? "attention_required"
  const db = {
    channelConfig: { findFirst: vi.fn().mockResolvedValue(channelConfig()) },
    voiceCallSession: {
      findFirst: vi.fn().mockResolvedValue(candidate(options?.queue)),
      updateMany: vi.fn().mockResolvedValue({ count: options?.sessionCount ?? 1 }),
    },
    voiceCallQueueItem: {
      updateMany: vi.fn().mockResolvedValue({ count: options?.itemCount ?? 1 }),
      count: vi.fn().mockResolvedValue(options?.remainingItems ?? 1),
    },
    voiceCallQueue: {
      updateMany: vi.fn().mockImplementation(async (args: { where?: { status?: unknown } }) => ({
        count: args.where?.status === "attention_required" && queueStatus === "cancelled" ? 0 : 1,
      })),
      findFirst: vi.fn().mockResolvedValue(
        queueStatus === "cancelled" ? { id: "queue-1" } : null,
      ),
    },
    callLog: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    callEvent: { create: vi.fn().mockResolvedValue({ id: "event-1" }) },
    $transaction: vi.fn(async (operation: (tx: unknown) => unknown) => operation(db)),
  }
  return db
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("provider finality reconciliation gate", () => {
  it("is off by default and reads no database state", async () => {
    vi.stubEnv("VOICE_PROVIDER_FINALITY_RECONCILIATION_ENABLED", "false")
    vi.stubEnv("VOICE_AGENT_ORGANIZATION_ID", "org-1")
    const db = finalityDb()

    await expect(reconcileUncertainVoiceSessionFinality({
      db: db as never,
      organizationId: "org-1",
    })).resolves.toEqual({ status: "disabled" })

    expect(db.voiceCallSession.findFirst).not.toHaveBeenCalled()
    expect(db.channelConfig.findFirst).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it("stays off when reconciliation is enabled but registry execution is not", async () => {
    const db = finalityDb()

    await expect(reconcileUncertainVoiceSessionFinality({
      db: db as never,
      organizationId: "org-1",
      featureOptions: {
        executionEnabled: true,
        attemptRegistryEnabled: false,
        pilotOrganizationId: "org-1",
      },
    })).resolves.toEqual({ status: "disabled" })

    expect(db.voiceCallSession.findFirst).not.toHaveBeenCalled()
  })

  it("rejects a pilot mismatch before any database or provider read", async () => {
    const db = finalityDb()
    const inspectFinality = vi.fn()

    await expect(reconcileUncertainVoiceSessionFinality({
      db: db as never,
      organizationId: "org-2",
      featureOptions,
      inspectFinality,
    })).resolves.toEqual({ status: "disabled" })

    expect(db.voiceCallSession.findFirst).not.toHaveBeenCalled()
    expect(inspectFinality).not.toHaveBeenCalled()
  })
})

describe("provider finality fail-closed states", () => {
  it.each([
    ["accepted", { state: "accepted", revision: 3, updatedAt: "2026-08-10T08:59:00.000Z" }, "active"],
    ["active", { state: "active", revision: 4, updatedAt: "2026-08-10T08:59:10.000Z" }, "active"],
    ["unknown", { state: "unknown" }, "unknown"],
  ] as const)("retains every fence for %s", async (_case, proof, expectedStatus) => {
    const db = finalityDb()

    await expect(reconcileUncertainVoiceSessionFinality({
      db: db as never,
      organizationId: "org-1",
      now,
      featureOptions,
      inspectFinality: vi.fn().mockResolvedValue(proof),
    })).resolves.toEqual({ status: expectedStatus })

    expect(db.$transaction).not.toHaveBeenCalled()
    expect(db.voiceCallSession.updateMany).not.toHaveBeenCalled()
    expect(db.voiceCallQueueItem.updateMany).not.toHaveBeenCalled()
    expect(db.callLog.updateMany).not.toHaveBeenCalled()
  })

  it("retains every fence when the provider read throws", async () => {
    const db = finalityDb()

    await expect(reconcileUncertainVoiceSessionFinality({
      db: db as never,
      organizationId: "org-1",
      featureOptions,
      inspectFinality: vi.fn().mockRejectedValue(new Error("timeout")),
    })).resolves.toEqual({ status: "unknown" })

    expect(db.$transaction).not.toHaveBeenCalled()
    expect(db.voiceCallSession.updateMany).not.toHaveBeenCalled()
  })
})

describe("provider finality typed settlement", () => {
  it("settles a standalone session only from not_accepted", async () => {
    const db = finalityDb()

    await expect(reconcileUncertainVoiceSessionFinality({
      db: db as never,
      organizationId: "org-1",
      now,
      featureOptions,
      inspectFinality: vi.fn().mockResolvedValue({
        state: "not_accepted",
        revision: 5,
        updatedAt: "2026-08-10T08:59:20.000Z",
      }),
    })).resolves.toEqual({ status: "not_accepted" })

    expect(db.channelConfig.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "voip-config",
        organizationId: "org-1",
        isActive: true,
      }),
    }))
    expect(db.voiceCallSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        providerCallId,
        status: "dispatch_uncertain",
        activeOrganizationKey: "org-1",
      }),
      data: expect.objectContaining({
        status: "failed",
        outcome: "failed",
        blockReason: "provider_not_accepted",
        activeOrganizationKey: null,
        activeLeadKey: null,
        activePhoneKey: null,
      }),
    }))
    expect(db.callLog.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ providerOutcome: null }),
      data: expect.objectContaining({
        status: "failed",
        providerOutcome: "failed",
        conversationOutcome: "failed",
      }),
    }))
    expect(db.callEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: "voice_provider_finality_reconciled",
        payload: expect.objectContaining({
          providerState: "not_accepted",
          providerRevision: 5,
        }),
      }),
    }))
  })

  it("records provisional connected evidence without stealing callback authority", async () => {
    const db = finalityDb()

    await expect(reconcileUncertainVoiceSessionFinality({
      db: db as never,
      organizationId: "org-1",
      now,
      featureOptions,
      inspectFinality: vi.fn().mockResolvedValue({
        state: "terminal",
        outcome: "connected",
        revision: 6,
        updatedAt: "2026-08-10T08:59:30.000Z",
      }),
    })).resolves.toEqual({ status: "terminal", outcome: "connected" })

    expect(db.voiceCallSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "completed", outcome: "connected" }),
    }))
    const callLogData = db.callLog.updateMany.mock.calls[0]?.[0]?.data
    expect(callLogData).toEqual(expect.objectContaining({
      status: "completed",
      wasAnswered: true,
      conversationOutcome: "provider_connected_pending_result",
    }))
    expect(callLogData).not.toHaveProperty("providerOutcome")
  })

  it("settles a queued terminal state sequentially and pauses remaining work", async () => {
    const db = finalityDb({ queue: true, remainingItems: 1 })

    await expect(reconcileUncertainVoiceSessionFinality({
      db: db as never,
      organizationId: "org-1",
      now,
      featureOptions,
      inspectFinality: vi.fn().mockResolvedValue({
        state: "terminal",
        outcome: "no_answer",
        revision: 7,
        updatedAt: "2026-08-10T08:59:40.000Z",
      }),
    })).resolves.toEqual({ status: "terminal", outcome: "no_answer" })

    expect(db.voiceCallQueueItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        voiceCallSessionId: "session-1",
        status: "dispatch_uncertain",
      }),
      data: expect.objectContaining({
        status: "no_answer",
        outcome: "no_answer",
        queuedLeadKey: null,
        queuedPhoneKey: null,
        activeOrganizationKey: null,
        activeOwnerKey: null,
      }),
    }))
    expect(db.voiceCallQueue.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "attention_required" }),
      data: { status: "paused", pausedAt: now },
    }))
    const callLogData = db.callLog.updateMany.mock.calls[0]?.[0]?.data
    expect(callLogData).toEqual({
      status: "no-answer",
      providerOutcome: "no_answer",
      conversationOutcome: "no_answer",
      wasAnswered: false,
      endedAt: now,
    })
  })

  it("settles an uncertain item without reopening an already-cancelled parent queue", async () => {
    const db = finalityDb({
      queue: true,
      remainingItems: 1,
      queueStatus: "cancelled",
    })

    await expect(reconcileUncertainVoiceSessionFinality({
      db: db as never,
      organizationId: "org-1",
      now,
      featureOptions,
      inspectFinality: vi.fn().mockResolvedValue({
        state: "terminal",
        outcome: "busy",
        revision: 8,
        updatedAt: "2026-08-10T08:59:45.000Z",
      }),
    })).resolves.toEqual({ status: "terminal", outcome: "busy" })

    expect(db.voiceCallQueue.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "attention_required" }),
      data: { status: "paused", pausedAt: now },
    }))
    expect(db.voiceCallQueue.findFirst).toHaveBeenCalledWith({
      where: {
        id: "queue-1",
        organizationId: "org-1",
        ownerUserId: "seller-1",
        status: "cancelled",
      },
      select: { id: true },
    })
    expect(db.voiceCallQueue.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "paused" }),
      where: expect.objectContaining({ status: "cancelled" }),
    }))
    expect(db.voiceCallQueueItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "busy", activeOrganizationKey: null }),
    }))
    expect(db.callLog.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ providerOutcome: "busy" }),
    }))
  })

  it("returns stale when the session CAS loses and performs no downstream write", async () => {
    const db = finalityDb({ sessionCount: 0 })

    await expect(reconcileUncertainVoiceSessionFinality({
      db: db as never,
      organizationId: "org-1",
      now,
      featureOptions,
      inspectFinality: vi.fn().mockResolvedValue({
        state: "not_accepted",
        revision: 8,
        updatedAt: "2026-08-10T08:59:45.000Z",
      }),
    })).resolves.toEqual({ status: "stale" })

    expect(db.voiceCallQueueItem.updateMany).not.toHaveBeenCalled()
    expect(db.callLog.updateMany).not.toHaveBeenCalled()
    expect(db.callEvent.create).not.toHaveBeenCalled()
  })

  it("returns stale when the queue-item CAS loses before history is changed", async () => {
    const db = finalityDb({ queue: true, itemCount: 0 })

    await expect(reconcileUncertainVoiceSessionFinality({
      db: db as never,
      organizationId: "org-1",
      now,
      featureOptions,
      inspectFinality: vi.fn().mockResolvedValue({
        state: "terminal",
        outcome: "busy",
        revision: 9,
        updatedAt: "2026-08-10T08:59:50.000Z",
      }),
    })).resolves.toEqual({ status: "stale" })

    expect(db.callLog.updateMany).not.toHaveBeenCalled()
    expect(db.callEvent.create).not.toHaveBeenCalled()
  })

  it("is idempotent when a later tick finds no uncertain candidate", async () => {
    const db = finalityDb()
    db.voiceCallSession.findFirst
      .mockResolvedValueOnce(candidate(false))
      .mockResolvedValueOnce(null)
    const inspectFinality = vi.fn().mockResolvedValue({
      state: "terminal",
      outcome: "failed",
      revision: 10,
      updatedAt: "2026-08-10T08:59:55.000Z",
    })

    await expect(reconcileUncertainVoiceSessionFinality({
      db: db as never,
      organizationId: "org-1",
      featureOptions,
      inspectFinality,
    })).resolves.toEqual({ status: "terminal", outcome: "failed" })
    await expect(reconcileUncertainVoiceSessionFinality({
      db: db as never,
      organizationId: "org-1",
      featureOptions,
      inspectFinality,
    })).resolves.toEqual({ status: "idle" })

    expect(inspectFinality).toHaveBeenCalledTimes(1)
    expect(db.$transaction).toHaveBeenCalledTimes(1)
  })
})
