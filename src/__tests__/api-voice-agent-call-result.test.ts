import { Prisma } from "@prisma/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  maybePlaceCallback: vi.fn(async () => ({ decision: { callback: false, reason: "no_break_evidence" }, placement: null })),
  recordUnansweredCallback: vi.fn(async () => ({ created: false, reason: "not-a-callback" })),
  findSession: vi.fn(),
  findCallLog: vi.fn(),
  callLogUpdateMany: vi.fn(),
  voiceCallSessionUpdateMany: vi.fn(),
  voiceCallQueueItemUpdateMany: vi.fn(),
  voiceCallQueueItemCount: vi.fn(),
  voiceCallQueueUpdateMany: vi.fn(),
  callEventCreate: vi.fn(),
  callEventCreateMany: vi.fn(),
  callEventFindFirst: vi.fn(),
  callEventUpdateMany: vi.fn(),
  transaction: vi.fn(),
  analyzeVoiceCall: vi.fn(),
  fallbackPostCallAnalysis: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    voiceCallSession: { findFirst: mocks.findSession },
    voiceCallQueueItem: {
      updateMany: mocks.voiceCallQueueItemUpdateMany,
      count: mocks.voiceCallQueueItemCount,
    },
    voiceCallQueue: { updateMany: mocks.voiceCallQueueUpdateMany },
    callLog: { findFirst: mocks.findCallLog, updateMany: mocks.callLogUpdateMany },
    callEvent: {
      create: mocks.callEventCreate,
      createMany: mocks.callEventCreateMany,
      findFirst: mocks.callEventFindFirst,
      updateMany: mocks.callEventUpdateMany,
    },
    $transaction: mocks.transaction,
  },
}))
// Isolated on purpose. Without this the route's callback trigger would run for
// real inside every route test, and its own try/catch would hide that from the
// results — a test suite must not be one decision away from a dispatch path.
vi.mock("@/lib/voice-agent/callback-trigger", () => ({
  maybePlaceCallback: mocks.maybePlaceCallback,
}))
vi.mock("@/lib/voice-agent/callback-fallback-task", () => ({
  recordUnansweredCallback: mocks.recordUnansweredCallback,
}))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: vi.fn((_organizationId: string, fn: () => unknown) => fn()),
}))
vi.mock("@/lib/voice-agent/post-call", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/voice-agent/post-call")>()
  return {
    ...actual,
    analyzeVoiceCall: mocks.analyzeVoiceCall,
    fallbackPostCallAnalysis: mocks.fallbackPostCallAnalysis,
  }
})

import { POST } from "@/app/api/internal/voice-agent/call-result/route"

const callId = "9f5fa15c-a6f0-4f6f-af73-c5049e3d9de7"
const originalToken = process.env.FANUM_VOICE_RUNTIME_TOKEN
const originalOrg = process.env.VOICE_AGENT_ORGANIZATION_ID

function request(body: unknown, token = "pbx-test-token") {
  return new NextRequest("http://localhost/api/internal/voice-agent/call-result", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function matchingSession(overrides: Partial<{
  insightsAt: Date | null
  providerOutcome: string | null
  status: string
  outcome: string | null
  blockReason: string | null
  conversationOutcome: string | null
  queueItem: {
    id: string
    queueId: string
    ownerUserId: string
    status: string
  } | null
}> = {}) {
  return {
    id: "voice-session-1",
    status: overrides.status ?? "waiting_terminal",
    outcome: overrides.outcome ?? null,
    blockReason: overrides.blockReason ?? null,
    queueItem: overrides.queueItem ?? null,
    callLog: {
      id: "call-log-1",
      insightsAt: overrides.insightsAt ?? null,
      providerOutcome: overrides.providerOutcome ?? null,
      transcription: null,
      duration: null,
      conversationOutcome: overrides.conversationOutcome ?? null,
    },
  }
}

function persistedConnectedSession(overrides: Partial<{
  insightsAt: Date | null
  transcription: string | null
  duration: number | null
  conversationOutcome: string | null
}> = {}) {
  return {
    id: "voice-session-1",
    status: "completed",
    outcome: "connected",
    blockReason: null,
    queueItem: null,
    callLog: {
      id: "call-log-1",
      insightsAt: overrides.insightsAt ?? null,
      providerOutcome: "connected",
      transcription: overrides.transcription ?? "AI operator: Salam.\nMüştəri: Sabah danışaq.",
      duration: overrides.duration ?? 37,
      conversationOutcome: overrides.conversationOutcome ?? "customer_spoke",
    },
  }
}

function connectedPayload() {
  return {
    callId,
    durationSeconds: 37,
    turns: [
      { role: "agent", text: "Salam." },
      { role: "customer", text: "Sabah danışaq." },
    ],
  }
}

function uniqueConflict() {
  return new Prisma.PrismaClientKnownRequestError("unique", {
    code: "P2002",
    clientVersion: "6.19.3",
  })
}

describe("POST /api/internal/voice-agent/call-result", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.FANUM_VOICE_RUNTIME_TOKEN = "pbx-test-token"
    process.env.VOICE_AGENT_ORGANIZATION_ID = "org-test"
    mocks.findSession.mockResolvedValue(matchingSession())
    mocks.findCallLog.mockResolvedValue({ insightsAt: null, providerOutcome: "connected" })
    mocks.callLogUpdateMany.mockResolvedValue({ count: 1 })
    mocks.voiceCallSessionUpdateMany.mockResolvedValue({ count: 1 })
    mocks.voiceCallQueueItemUpdateMany.mockResolvedValue({ count: 0 })
    mocks.voiceCallQueueItemCount.mockResolvedValue(1)
    mocks.voiceCallQueueUpdateMany.mockResolvedValue({ count: 1 })
    mocks.callEventCreate.mockResolvedValue({ id: "analysis-event-1" })
    mocks.callEventCreateMany.mockResolvedValue({ count: 1 })
    mocks.callEventFindFirst.mockResolvedValue(null)
    mocks.callEventUpdateMany.mockResolvedValue({ count: 1 })
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      callLog: { updateMany: mocks.callLogUpdateMany },
      voiceCallSession: { updateMany: mocks.voiceCallSessionUpdateMany },
      voiceCallQueueItem: {
        updateMany: mocks.voiceCallQueueItemUpdateMany,
        count: mocks.voiceCallQueueItemCount,
      },
      voiceCallQueue: { updateMany: mocks.voiceCallQueueUpdateMany },
      callEvent: { createMany: mocks.callEventCreateMany },
    }))
    mocks.analyzeVoiceCall.mockResolvedValue({
      model: "post-call-model",
      analysis: {
        summary: "Müştəri təkliflə maraqlandı.",
        sentiment: "positive",
        sentimentScore: 0.8,
        topics: ["qiymət"],
        disposition: "callback",
        nextStep: "Sabah yenidən zəng edin.",
      },
    })
  })

  afterEach(() => {
    if (originalToken === undefined) delete process.env.FANUM_VOICE_RUNTIME_TOKEN
    else process.env.FANUM_VOICE_RUNTIME_TOKEN = originalToken
    if (originalOrg === undefined) delete process.env.VOICE_AGENT_ORGANIZATION_ID
    else process.env.VOICE_AGENT_ORGANIZATION_ID = originalOrg
  })

  it("rejects requests that do not have the PBX bearer", async () => {
    const response = await POST(request({}, "wrong-token"))
    expect(response.status).toBe(401)
    expect(mocks.findSession).not.toHaveBeenCalled()
  })

  it("binds the callback to one AI session and stores transcript plus insights", async () => {
    const response = await POST(request(connectedPayload()))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, analysisStatus: "complete" })
    expect(mocks.findSession).toHaveBeenCalledWith({
      where: {
        organizationId: "org-test",
        provider: "asterisk",
        providerCallId: callId,
        callLog: {
          is: {
            organizationId: "org-test",
            callMode: "ai",
            provider: "asterisk",
            providerCallId: callId,
          },
        },
      },
      select: {
        id: true,
        status: true,
        outcome: true,
        blockReason: true,
        queueItem: {
          select: {
            id: true,
            queueId: true,
            ownerUserId: true,
            status: true,
          },
        },
        callLog: {
          select: {
            id: true,
            insightsAt: true,
            providerOutcome: true,
            transcription: true,
            duration: true,
            conversationOutcome: true,
          },
        },
      },
    })
    expect(mocks.callLogUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "call-log-1",
        organizationId: "org-test",
        callMode: "ai",
        provider: "asterisk",
        providerCallId: callId,
        providerOutcome: null,
      },
      data: expect.objectContaining({
        status: "completed",
        providerOutcome: "connected",
        wasAnswered: true,
        conversationOutcome: "customer_spoke",
        duration: 37,
        transcription: "AI operator: Salam.\nMüştəri: Sabah danışaq.",
      }),
    })
    expect(mocks.voiceCallSessionUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "voice-session-1",
        organizationId: "org-test",
        callLogId: "call-log-1",
        providerCallId: callId,
        OR: [
          { outcome: null },
          { outcome: "operator_closed_unknown_no_redial" },
          { outcome: "connected" },
        ],
      },
      data: expect.objectContaining({
        status: "completed",
        outcome: "connected",
        activeOrganizationKey: null,
        activeLeadKey: null,
        activePhoneKey: null,
        leaseUntil: null,
      }),
    })
    expect(mocks.callLogUpdateMany).toHaveBeenLastCalledWith({
      where: {
        id: "call-log-1",
        organizationId: "org-test",
        callMode: "ai",
        provider: "asterisk",
        providerCallId: callId,
        providerOutcome: "connected",
        insightsAt: null,
      },
      data: expect.objectContaining({
        disposition: "callback",
        insights: expect.objectContaining({
          summary: "Müştəri təkliflə maraqlandı.",
          actionItems: [{ text: "Sabah yenidən zəng edin.", owner: "agent", dueDateHint: null }],
        }),
      }),
    })
    expect(mocks.callEventCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-test",
        callLogId: "call-log-1",
        providerCallId: callId,
        eventHash: "voice-post-call-analysis-v1",
      }),
    }))
  })

  it("is idempotent after a call already has insights", async () => {
    mocks.findSession.mockResolvedValue(persistedConnectedSession({ insightsAt: new Date() }))
    const response = await POST(request({
      callId,
      durationSeconds: 37,
      turns: [{ role: "customer", text: "Salam." }],
    }))
    await expect(response.json()).resolves.toEqual({ success: true, analysisStatus: "existing" })
    expect(mocks.analyzeVoiceCall).not.toHaveBeenCalled()
    expect(mocks.callLogUpdateMany).not.toHaveBeenCalled()
    expect(mocks.callEventCreate).not.toHaveBeenCalled()
  })

  it("uses an extractive fallback without losing the transcript", async () => {
    mocks.analyzeVoiceCall.mockRejectedValue(new Error("upstream unavailable"))
    mocks.fallbackPostCallAnalysis.mockReturnValue({
      summary: "Müştərinin dedikləri: Sabah danışaq.",
      sentiment: "neutral",
      sentimentScore: 0.5,
      topics: [],
      disposition: "other",
      nextStep: null,
    })
    const response = await POST(request({
      callId,
      durationSeconds: 12,
      turns: [{ role: "customer", text: "Sabah danışaq." }],
    }))
    await expect(response.json()).resolves.toEqual({ success: true, analysisStatus: "fallback" })
    expect(mocks.callLogUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ transcription: "Müştəri: Sabah danışaq." }),
    }))
  })

  it("records a zero-turn no-answer outcome without running analysis", async () => {
    const response = await POST(request({
      callId,
      durationSeconds: 18,
      providerOutcome: "no_answer",
      turns: [],
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, analysisStatus: "not_applicable" })
    expect(mocks.analyzeVoiceCall).not.toHaveBeenCalled()
    expect(mocks.callLogUpdateMany).toHaveBeenCalledTimes(1)
    expect(mocks.callLogUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "call-log-1",
        organizationId: "org-test",
        callMode: "ai",
        provider: "asterisk",
        providerCallId: callId,
        providerOutcome: null,
      },
      data: expect.objectContaining({
        status: "no-answer",
        providerOutcome: "no_answer",
        wasAnswered: false,
        conversationOutcome: "no_answer",
        duration: 18,
      }),
    })
    expect(mocks.voiceCallSessionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "no_answer",
        outcome: "no_answer",
        answeredAt: null,
        activeOrganizationKey: null,
        activeLeadKey: null,
        activePhoneKey: null,
      }),
    }))
    expect(mocks.callEventCreate).not.toHaveBeenCalled()
  })

  it("settles provider-only connected evidence without inventing transcript or customer speech", async () => {
    const response = await POST(request({
      protocol: "fanum-provider-connected-v1",
      callId,
      observedAt: "2026-08-10T09:15:00.000Z",
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      analysisStatus: "provider_connected_pending_result",
    })
    expect(mocks.callLogUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "call-log-1",
        organizationId: "org-test",
        callMode: "ai",
        provider: "asterisk",
        providerCallId: callId,
        providerOutcome: null,
        OR: [
          { conversationOutcome: null },
          {
            conversationOutcome: {
              in: ["provider_unknown_no_redial", "operator_closed_unknown_no_redial"],
            },
          },
        ],
      },
      data: expect.objectContaining({
        status: "completed",
        wasAnswered: true,
        conversationOutcome: "provider_connected_pending_result",
      }),
    })
    expect(mocks.voiceCallSessionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "completed",
        outcome: "connected",
        activeOrganizationKey: null,
        activeLeadKey: null,
        activePhoneKey: null,
      }),
    }))
    expect(mocks.callEventCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        eventType: "voice_provider_connected_evidence",
        eventHash: "fanum-provider-connected-v1",
        payload: { observedAt: "2026-08-10T09:15:00.000Z" },
      })],
      skipDuplicates: true,
    })
    expect(mocks.analyzeVoiceCall).not.toHaveBeenCalled()
  })

  it("rejects provider-only connected evidence that contradicts durable terminal truth", async () => {
    mocks.findSession.mockResolvedValue(matchingSession({
      status: "no_answer",
      outcome: "no_answer",
      providerOutcome: "no_answer",
      conversationOutcome: "no_answer",
    }))

    const response = await POST(request({
      protocol: "fanum-provider-connected-v1",
      callId,
      observedAt: "2026-08-10T09:15:00.000Z",
    }))

    expect(response.status).toBe(409)
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.callEventCreateMany).not.toHaveBeenCalled()
  })

  it("rejects provider-only connected evidence with extra or transcript fields", async () => {
    const response = await POST(request({
      protocol: "fanum-provider-connected-v1",
      callId,
      observedAt: "2026-08-10T09:15:00.000Z",
      durationSeconds: 12,
      providerOutcome: "connected",
      turns: [{ role: "customer", text: "Should never be parsed as an ordinary result." }],
    }))

    expect(response.status).toBe(400)
    expect(mocks.findSession).not.toHaveBeenCalled()
  })

  it("treats an exact provider-connected placeholder replay as a mutation-free success", async () => {
    mocks.findSession.mockResolvedValue(matchingSession({
      status: "completed",
      outcome: "connected",
      conversationOutcome: "provider_connected_pending_result",
    }))

    const response = await POST(request({
      protocol: "fanum-provider-connected-v1",
      callId,
      observedAt: "2026-08-10T09:16:00.000Z",
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      analysisStatus: "provider_connected_pending_result",
    })
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.callLogUpdateMany).not.toHaveBeenCalled()
    expect(mocks.voiceCallSessionUpdateMany).not.toHaveBeenCalled()
    expect(mocks.callEventCreateMany).not.toHaveBeenCalled()
  })

  it("records AI authorized-but-indeterminate delivery without false cancellation or redial", async () => {
    const response = await POST(request({
      protocol: "fanum-provider-unknown-no-redial-v1",
      callId,
      observedAt: "2026-08-10T09:17:00.000Z",
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      analysisStatus: "provider_unknown_no_redial",
    })
    expect(mocks.callLogUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        providerOutcome: null,
        conversationOutcome: null,
      }),
      data: expect.objectContaining({
        status: "dispatch-uncertain",
        conversationOutcome: "provider_unknown_no_redial",
      }),
    }))
    const sessionUpdate = mocks.voiceCallSessionUpdateMany.mock.calls[0]?.[0]
    expect(sessionUpdate).toEqual(expect.objectContaining({
      where: expect.objectContaining({
        activeOrganizationKey: "org-test",
        outcome: null,
        blockReason: null,
      }),
      data: expect.objectContaining({
        status: "dispatch_uncertain",
        blockReason: "provider_unknown_no_redial",
        activeOrganizationKey: null,
      }),
    }))
    expect(sessionUpdate.data).not.toHaveProperty("activeLeadKey")
    expect(sessionUpdate.data).not.toHaveProperty("activePhoneKey")
    expect(mocks.callEventCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        eventType: "voice_provider_unknown_no_redial",
        eventHash: "fanum-provider-unknown-no-redial-v1",
      })],
      skipDuplicates: true,
    })
  })

  it("moves an indeterminate queue attempt to manager attention without advancing", async () => {
    mocks.findSession.mockResolvedValue(matchingSession({
      status: "dispatching",
      queueItem: {
        id: "queue-item-1",
        queueId: "queue-1",
        ownerUserId: "seller-1",
        status: "waiting_terminal",
      },
    }))
    mocks.voiceCallQueueItemUpdateMany.mockResolvedValue({ count: 1 })

    const response = await POST(request({
      protocol: "fanum-provider-unknown-no-redial-v1",
      callId,
      observedAt: "2026-08-10T09:17:00.000Z",
    }))

    expect(response.status).toBe(200)
    expect(mocks.voiceCallQueueItemUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "dispatch_uncertain",
        outcome: null,
        blockReason: "provider_unknown_no_redial",
        activeOrganizationKey: null,
        activeOwnerKey: null,
      }),
    }))
    expect(mocks.voiceCallQueueUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "queue-1",
        organizationId: "org-test",
        ownerUserId: "seller-1",
        status: { in: ["running", "paused"] },
      },
      data: { status: "attention_required" },
    })
  })

  it("treats the exact AI indeterminate placeholder replay as mutation-free", async () => {
    mocks.findSession.mockResolvedValue(matchingSession({
      status: "dispatch_uncertain",
      blockReason: "provider_unknown_no_redial",
      conversationOutcome: "provider_unknown_no_redial",
    }))

    const response = await POST(request({
      protocol: "fanum-provider-unknown-no-redial-v1",
      callId,
      observedAt: "2026-08-10T09:18:00.000Z",
    }))

    expect(response.status).toBe(200)
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.callLogUpdateMany).not.toHaveBeenCalled()
    expect(mocks.voiceCallSessionUpdateMany).not.toHaveBeenCalled()
  })

  it("enriches a matching registry-connected placeholder without reopening eligibility", async () => {
    mocks.findSession.mockResolvedValue(matchingSession({
      status: "completed",
      outcome: "connected",
      conversationOutcome: "provider_connected_pending_result",
    }))

    const response = await POST(request(connectedPayload()))

    expect(response.status).toBe(200)
    expect(mocks.callLogUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ providerOutcome: null }),
      data: expect.objectContaining({
        providerOutcome: "connected",
        conversationOutcome: "customer_spoke",
      }),
    }))
    expect(mocks.voiceCallSessionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [
          { outcome: null },
          { outcome: "operator_closed_unknown_no_redial" },
          { outcome: "connected" },
        ],
      }),
    }))
  })

  it("enriches a matching registry terminal when the delayed callback arrives", async () => {
    mocks.findSession.mockResolvedValue(matchingSession({
      status: "no_answer",
      outcome: "no_answer",
      providerOutcome: "no_answer",
      conversationOutcome: "no_answer",
    }))

    const response = await POST(request({
      callId,
      durationSeconds: 18,
      providerOutcome: "no_answer",
      turns: [],
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      analysisStatus: "not_applicable",
    })
    expect(mocks.callLogUpdateMany).toHaveBeenCalledTimes(1)
    expect(mocks.callLogUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "call-log-1",
        organizationId: "org-test",
        callMode: "ai",
        provider: "asterisk",
        providerCallId: callId,
        providerOutcome: "no_answer",
        conversationOutcome: "no_answer",
        duration: null,
        transcription: null,
      },
      data: expect.objectContaining({
        status: "no-answer",
        providerOutcome: "no_answer",
        wasAnswered: false,
        conversationOutcome: "no_answer",
        duration: 18,
      }),
    })
    expect(mocks.voiceCallSessionUpdateMany).not.toHaveBeenCalled()
    expect(mocks.analyzeVoiceCall).not.toHaveBeenCalled()
  })

  it("rejects a callback that contradicts an already-settled registry outcome", async () => {
    mocks.findSession.mockResolvedValue(matchingSession({
      status: "no_answer",
      outcome: "no_answer",
    }))

    const response = await POST(request(connectedPayload()))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ success: false, analysisStatus: "conflict" })
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.callLogUpdateMany).not.toHaveBeenCalled()
    expect(mocks.analyzeVoiceCall).not.toHaveBeenCalled()
  })

  it("rolls back callback enrichment when registry finality wins after the initial read", async () => {
    mocks.voiceCallSessionUpdateMany.mockResolvedValueOnce({ count: 0 })

    const response = await POST(request(connectedPayload()))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ success: false, analysisStatus: "conflict" })
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.analyzeVoiceCall).not.toHaveBeenCalled()
    expect(mocks.callEventCreate).not.toHaveBeenCalled()
  })

  it("pauses remaining queue work when a late terminal callback resolves provider uncertainty before manager acknowledgement", async () => {
    mocks.findSession.mockResolvedValue(matchingSession({
      status: "dispatch_uncertain",
      outcome: null,
      blockReason: "provider_unknown_no_redial",
      conversationOutcome: "provider_unknown_no_redial",
      queueItem: {
        id: "queue-item-1",
        queueId: "queue-1",
        ownerUserId: "seller-1",
        status: "dispatch_uncertain",
      },
    }))
    mocks.voiceCallQueueItemUpdateMany.mockResolvedValue({ count: 1 })
    mocks.voiceCallQueueItemCount.mockResolvedValue(1)

    const response = await POST(request(connectedPayload()))

    expect(response.status).toBe(200)
    expect(mocks.voiceCallQueueItemUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "queue-item-1",
        OR: expect.arrayContaining([
          expect.objectContaining({
            status: "dispatch_uncertain",
            blockReason: "provider_unknown_no_redial",
          }),
        ]),
      }),
      data: expect.objectContaining({
        status: "completed",
        outcome: "connected",
        queuedLeadKey: null,
        queuedPhoneKey: null,
      }),
    }))
    expect(mocks.voiceCallQueueUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "queue-1",
        organizationId: "org-test",
        ownerUserId: "seller-1",
        status: "attention_required",
      },
      data: { status: "paused", pausedAt: expect.any(Date) },
    })
  })

  it.each([
    ["connected", "completed", "connected"],
    ["no_answer", "no_answer", "no_answer"],
    ["busy", "busy", "busy"],
    ["failed", "failed", "failed"],
    ["cancelled", "cancelled", "cancelled"],
  ] as const)(
    "corrects a manager-resolved uncertain queue item when PBX later proves %s without restoring any fence",
    async (providerOutcome, expectedStatus, expectedOutcome) => {
      mocks.findSession.mockResolvedValue(matchingSession({
        status: "cancelled",
        outcome: "operator_closed_unknown_no_redial",
        queueItem: {
          id: "queue-item-1",
          queueId: "queue-1",
          ownerUserId: "seller-1",
          status: "skipped",
        },
      }))
      const response = await POST(request({
        callId,
        durationSeconds: providerOutcome === "connected" ? 9 : 0,
        providerOutcome,
        turns: providerOutcome === "connected"
          ? [{ role: "agent", text: "Salam." }]
          : [],
      }))

      expect(response.status).toBe(200)
      expect(mocks.voiceCallQueueItemUpdateMany).toHaveBeenCalledTimes(1)
      expect(mocks.voiceCallQueueItemUpdateMany).toHaveBeenCalledWith({
        where: {
          id: "queue-item-1",
          organizationId: "org-test",
          queueId: "queue-1",
          ownerUserId: "seller-1",
          voiceCallSessionId: "voice-session-1",
          OR: expect.any(Array),
        },
        data: {
          status: expectedStatus,
          outcome: expectedOutcome,
          queuedLeadKey: null,
          queuedPhoneKey: null,
          activeOrganizationKey: null,
          activeOwnerKey: null,
          leaseToken: null,
          leaseUntil: null,
          blockReason: null,
          endedAt: expect.any(Date),
        },
      })
    },
  )

  it("maps provider cancelled to the existing one-l CallLog status", async () => {
    const response = await POST(request({
      callId,
      durationSeconds: 4,
      providerOutcome: "cancelled",
      turns: [],
    }))

    expect(response.status).toBe(200)
    expect(mocks.callLogUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "canceled",
        providerOutcome: "cancelled",
        conversationOutcome: "cancelled",
      }),
    }))
    expect(mocks.voiceCallSessionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "cancelled", outcome: "cancelled" }),
    }))
  })

  it("does not treat an agent-only connected transcript as customer speech", async () => {
    const response = await POST(request({
      callId,
      durationSeconds: 9,
      providerOutcome: "connected",
      turns: [{ role: "agent", text: "Salam." }],
    }))

    await expect(response.json()).resolves.toEqual({ success: true, analysisStatus: "not_applicable" })
    expect(mocks.analyzeVoiceCall).not.toHaveBeenCalled()
    expect(mocks.callLogUpdateMany).toHaveBeenCalledTimes(1)
    expect(mocks.callLogUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "completed",
        providerOutcome: "connected",
        wasAnswered: true,
        conversationOutcome: "no_customer_speech",
      }),
    }))
    expect(mocks.callEventCreate).not.toHaveBeenCalled()
  })

  it("rejects a zero-turn legacy payload without a terminal outcome", async () => {
    const response = await POST(request({
      callId,
      durationSeconds: 9,
      turns: [],
    }))

    expect(response.status).toBe(400)
    expect(mocks.findSession).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("recovers analysis when terminal state was committed before a worker crash", async () => {
    mocks.findSession.mockResolvedValue(persistedConnectedSession())
    const response = await POST(request(connectedPayload()))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, analysisStatus: "complete" })
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.analyzeVoiceCall).toHaveBeenCalledTimes(1)
    expect(mocks.callLogUpdateMany).toHaveBeenCalledTimes(1)
    expect(mocks.voiceCallQueueItemUpdateMany).not.toHaveBeenCalled()
  })

  it("continues analysis when a racing callback lost only the terminal claim", async () => {
    mocks.callLogUpdateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 })
    mocks.findCallLog.mockResolvedValue({
      providerOutcome: "connected",
      insightsAt: null,
      transcription: "AI operator: Salam.\nMüştəri: Sabah danışaq.",
      duration: 37,
      conversationOutcome: "customer_spoke",
    })
    const response = await POST(request(connectedPayload()))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, analysisStatus: "complete" })
    expect(mocks.findCallLog).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ callMode: "ai", providerCallId: callId }),
    }))
    expect(mocks.analyzeVoiceCall).toHaveBeenCalledTimes(1)
    expect(mocks.voiceCallSessionUpdateMany).not.toHaveBeenCalled()
  })

  it("returns retryable processing while another callback owns a live analysis lease", async () => {
    mocks.findSession.mockResolvedValue(persistedConnectedSession())
    mocks.callEventCreate.mockRejectedValue(uniqueConflict())
    mocks.callEventFindFirst.mockResolvedValue({
      id: "analysis-event-1",
      eventType: "voice_analysis_claim",
      payload: {
        state: "processing",
        claimId: "claim-live",
        leaseUntil: new Date(Date.now() + 60_000).toISOString(),
      },
    })
    const response = await POST(request(connectedPayload()))

    expect(response.status).toBe(503)
    expect(response.headers.get("retry-after")).toBe("5")
    await expect(response.json()).resolves.toEqual({ success: false, analysisStatus: "processing" })
    expect(mocks.analyzeVoiceCall).not.toHaveBeenCalled()
    expect(mocks.callEventUpdateMany).not.toHaveBeenCalled()
  })

  it("steals an expired analysis lease and completes recovery once", async () => {
    mocks.findSession.mockResolvedValue(persistedConnectedSession())
    mocks.callEventCreate.mockRejectedValue(uniqueConflict())
    mocks.callEventFindFirst.mockResolvedValue({
      id: "analysis-event-1",
      eventType: "voice_analysis_claim",
      payload: {
        state: "processing",
        claimId: "claim-dead-worker",
        leaseUntil: new Date(Date.now() - 60_000).toISOString(),
      },
    })
    const response = await POST(request(connectedPayload()))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, analysisStatus: "complete" })
    expect(mocks.callEventUpdateMany).toHaveBeenCalledTimes(2)
    expect(mocks.analyzeVoiceCall).toHaveBeenCalledTimes(1)
  })

  it("does not analyze retry turns that conflict with the persisted terminal transcript", async () => {
    mocks.findSession.mockResolvedValue(persistedConnectedSession({
      transcription: "Müştəri: Persisted canonical text.",
    }))
    const response = await POST(request(connectedPayload()))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ success: false, analysisStatus: "conflict" })
    expect(mocks.analyzeVoiceCall).not.toHaveBeenCalled()
    expect(mocks.callLogUpdateMany).not.toHaveBeenCalled()
    expect(mocks.callEventCreate).not.toHaveBeenCalled()
    expect(mocks.voiceCallQueueItemUpdateMany).not.toHaveBeenCalled()
  })

  it("does not let a PBX callback mutate an ordinary Asterisk CallLog", async () => {
    mocks.findSession.mockResolvedValue(null)
    const response = await POST(request({
      callId,
      durationSeconds: 5,
      turns: [{ role: "customer", text: "Salam." }],
    }))

    expect(response.status).toBe(404)
    expect(mocks.callLogUpdateMany).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.callEventCreate).not.toHaveBeenCalled()
  })

  it("stores the media-level end evidence the PBX reports", async () => {
    const response = await POST(request({
      ...connectedPayload(),
      agentMidUtterance: true,
      recoveryAttempts: 2,
    }))

    expect(response.status).toBe(200)
    expect(mocks.callLogUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ agentMidUtterance: true, recoveryAttempts: 2 }),
    }))
  })

  it("leaves stored end evidence alone when an older PBX omits it", async () => {
    const response = await POST(request(connectedPayload()))

    expect(response.status).toBe(200)
    // The fields must be absent from the update, not written as null: this is
    // the deploy window where the CRM already accepts them and the PBX does not
    // yet send them, and a null write would erase evidence from a retry.
    const [call] = mocks.callLogUpdateMany.mock.calls
    expect(call[0].data).not.toHaveProperty("agentMidUtterance")
    expect(call[0].data).not.toHaveProperty("recoveryAttempts")
    expect(call[0].data).not.toHaveProperty("providerDialStatus")
    expect(call[0].data).not.toHaveProperty("providerHangupCause")
  })

  it("stores the raw dial evidence behind a failed outcome", async () => {
    const response = await POST(request({
      callId,
      durationSeconds: 0,
      providerOutcome: "failed",
      dialStatus: "CHANUNAVAIL",
      hangupCause: "1",
      turns: [],
    }))

    expect(response.status).toBe(200)
    // The whole point of the fields: the operator reads "CHANUNAVAIL / Q.850 1"
    // from the call card instead of capturing trunk traffic.
    expect(mocks.callLogUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        providerOutcome: "failed",
        providerDialStatus: "CHANUNAVAIL",
        providerHangupCause: "1",
      }),
    }))
  })

  it("rejects dial evidence that does not look like the PBX contract", async () => {
    for (const invalid of [
      { dialStatus: "chanunavail" },
      { dialStatus: "X".repeat(33) },
      { hangupCause: "1a" },
      { hangupCause: "" },
    ]) {
      mocks.callLogUpdateMany.mockClear()
      const response = await POST(request({
        callId,
        durationSeconds: 0,
        providerOutcome: "failed",
        turns: [],
        ...invalid,
      }))
      expect(response.status).toBe(400)
      expect(mocks.callLogUpdateMany).not.toHaveBeenCalled()
    }
  })

  it("considers a callback only after the result is fully stored", async () => {
    const response = await POST(request(connectedPayload()))

    expect(response.status).toBe(200)
    // Placed last on purpose: a callback must never be the reason a transcript
    // was lost, and the trigger is handed the turns it needs to read a goodbye.
    expect(mocks.maybePlaceCallback).toHaveBeenCalledWith(expect.objectContaining({
      callLogId: "call-log-1",
      turns: connectedPayload().turns,
    }))
  })

  it("hands an unanswered call to the fallback so a spent callback reaches a person", async () => {
    mocks.findSession.mockResolvedValue(matchingSession())
    const response = await POST(request({
      callId,
      durationSeconds: 18,
      providerOutcome: "no_answer",
      turns: [],
    }))

    expect(response.status).toBe(200)
    // The fallback itself decides whether this call was a callback; the route's
    // job is only to give it the chance on every unanswered result.
    expect(mocks.recordUnansweredCallback).toHaveBeenCalledWith(expect.objectContaining({
      callLogId: "call-log-1",
    }))
  })

  it("keeps rejecting fields outside the agreed contract", async () => {
    const response = await POST(request({
      ...connectedPayload(),
      agentMidUtterance: true,
      callbackRequested: true,
    }))

    // Strictness is the reason the deploy order matters at all; a typo in a
    // future PBX build must fail loudly here rather than be silently dropped.
    expect(response.status).toBe(400)
    expect(mocks.callLogUpdateMany).not.toHaveBeenCalled()
  })
})
