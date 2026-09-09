import { Prisma } from "@prisma/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  callLogFindFirst: vi.fn(),
  callLogCreate: vi.fn(),
  callLogUpdateMany: vi.fn(),
  callEventCreate: vi.fn(),
  callEventFindFirst: vi.fn(),
  contactFindFirst: vi.fn(),
  leadFindFirst: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    callLog: {
      findFirst: mocks.callLogFindFirst,
      create: mocks.callLogCreate,
      updateMany: mocks.callLogUpdateMany,
    },
    callEvent: {
      create: mocks.callEventCreate,
      findFirst: mocks.callEventFindFirst,
    },
    contact: { findFirst: mocks.contactFindFirst },
    lead: { findFirst: mocks.leadFindFirst },
    $transaction: mocks.transaction,
  },
}))

vi.mock("@/lib/rls-context", () => ({
  runWithTenant: vi.fn((_organizationId: string, callback: () => unknown) => callback()),
}))

import { POST } from "@/app/api/internal/asterisk/call-lifecycle/route"

const originalToken = process.env.FANUM_VOICE_RUNTIME_TOKEN
const originalOrganizationId = process.env.VOICE_AGENT_ORGANIZATION_ID
const callId = "d9539247-9f92-4fc5-a926-758535082d04"
const eventId = "6dc3971c-80bd-44eb-a5d2-cd6b54136cc6"
const occurredAt = new Date(Date.now() - 60_000).toISOString()

function request(body: unknown, token = "pbx-runtime-token") {
  return new NextRequest("http://localhost/api/internal/asterisk/call-lifecycle", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })
}

function baseCall(overrides: Record<string, unknown> = {}) {
  return {
    id: "human-call-log-1",
    leadId: null,
    leadCallClaimToken: null,
    direction: "outbound",
    fromNumber: "100",
    toNumber: "+994501234567",
    status: "initiated",
    duration: null,
    wasAnswered: false,
    providerOutcome: null,
    conversationOutcome: null,
    startedAt: new Date(new Date(occurredAt).getTime() - 30_000),
    endedAt: null,
    ...overrides,
  }
}

function ringingPayload(overrides: Record<string, unknown> = {}) {
  return {
    eventId,
    callId,
    state: "ringing",
    occurredAt,
    fromNumber: "+994501234567",
    toNumber: "100",
    ...overrides,
  }
}

function answeredPayload(overrides: Record<string, unknown> = {}) {
  return {
    eventId,
    callId,
    state: "answered",
    occurredAt,
    ...overrides,
  }
}

function terminalPayload(
  state: "connected" | "no_answer" | "busy" | "failed" | "cancelled" = "connected",
  overrides: Record<string, unknown> = {},
) {
  return {
    eventId,
    callId,
    state,
    occurredAt,
    durationSeconds: state === "connected" ? 27 : 0,
    ...overrides,
  }
}

function uniqueConflict() {
  return new Prisma.PrismaClientKnownRequestError("unique", {
    code: "P2002",
    clientVersion: "6.19.3",
  })
}

describe("POST /api/internal/asterisk/call-lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.FANUM_VOICE_RUNTIME_TOKEN = "pbx-runtime-token"
    process.env.VOICE_AGENT_ORGANIZATION_ID = "org-test"
    mocks.callLogFindFirst.mockResolvedValue(baseCall())
    mocks.callLogCreate.mockResolvedValue({ id: "inbound-call-log-1" })
    mocks.callLogUpdateMany.mockResolvedValue({ count: 1 })
    mocks.callEventCreate.mockResolvedValue({ id: "event-row-1" })
    mocks.callEventFindFirst.mockResolvedValue(null)
    mocks.contactFindFirst.mockResolvedValue(null)
    mocks.leadFindFirst.mockResolvedValue(null)
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      callLog: {
        findFirst: mocks.callLogFindFirst,
        create: mocks.callLogCreate,
        updateMany: mocks.callLogUpdateMany,
      },
      callEvent: { create: mocks.callEventCreate },
      contact: { findFirst: mocks.contactFindFirst },
      lead: { findFirst: mocks.leadFindFirst },
    }))
  })

  afterEach(() => {
    if (originalToken === undefined) delete process.env.FANUM_VOICE_RUNTIME_TOKEN
    else process.env.FANUM_VOICE_RUNTIME_TOKEN = originalToken
    if (originalOrganizationId === undefined) delete process.env.VOICE_AGENT_ORGANIZATION_ID
    else process.env.VOICE_AGENT_ORGANIZATION_ID = originalOrganizationId
  })

  it("requires the PBX runtime bearer before touching call state", async () => {
    const response = await POST(request(answeredPayload(), "wrong-token"))

    expect(response.status).toBe(401)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("accepts a zero-data contract and rejects customer or telephony fields", async () => {
    const response = await POST(request(answeredPayload({
      toNumber: "+000000000",
      transcript: "must never enter this endpoint",
      sipPeer: "hidden",
    })))

    expect(response.status).toBe(400)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("rejects a non-UUID PBX call correlation before touching call state", async () => {
    const response = await POST(request(answeredPayload({ callId: "legacy-channel-id" })))

    expect(response.status).toBe(400)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("creates one inbound ringing call matched to a lead without journaling phone PII", async () => {
    mocks.callLogFindFirst.mockResolvedValue(null)
    mocks.leadFindFirst.mockResolvedValue({ id: "lead-1" })

    const response = await POST(request(ringingPayload()))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, result: "applied" })
    expect(mocks.contactFindFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-test",
        OR: [
          { phone: { in: ["+994501234567", "994501234567", "0501234567"] } },
          { phones: { hasSome: ["+994501234567", "994501234567", "0501234567"] } },
        ],
      },
      select: { id: true },
      orderBy: { updatedAt: "desc" },
    })
    expect(mocks.leadFindFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-test",
        OR: [
          { phone: { in: ["+994501234567", "994501234567", "0501234567"] } },
          { phoneWhatsApp: { in: ["+994501234567", "994501234567", "0501234567"] } },
        ],
      },
      select: { id: true },
      orderBy: { updatedAt: "desc" },
    })
    expect(mocks.callLogCreate).toHaveBeenCalledWith({
      data: {
        organizationId: "org-test",
        callSid: callId,
        providerCallId: callId,
        direction: "inbound",
        fromNumber: "+994501234567",
        toNumber: "100",
        targetPhoneE164: "+994501234567",
        status: "ringing",
        provider: "asterisk",
        callMode: "human",
        wasAnswered: false,
        contactId: undefined,
        leadId: "lead-1",
        startedAt: new Date(occurredAt),
      },
      select: { id: true },
    })
    expect(mocks.callEventCreate).toHaveBeenCalledWith({
      data: {
        organizationId: "org-test",
        callLogId: "inbound-call-log-1",
        provider: "asterisk",
        providerCallId: callId,
        eventType: "asterisk_human_call_lifecycle",
        eventHash: `asterisk-human-lifecycle-v1:${eventId}`,
        payload: {
          version: 1,
          state: "ringing",
          occurredAt,
        },
      },
    })
  })

  it("prefers an existing contact over a lead for the inbound caller", async () => {
    mocks.callLogFindFirst.mockResolvedValue(null)
    mocks.contactFindFirst.mockResolvedValue({ id: "contact-1" })

    const response = await POST(request(ringingPayload()))

    expect(response.status).toBe(200)
    expect(mocks.leadFindFirst).not.toHaveBeenCalled()
    expect(mocks.callLogCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ contactId: "contact-1", leadId: undefined }),
    }))
  })

  it("accepts an exact ringing replay as an idempotent no-op", async () => {
    mocks.callLogFindFirst.mockResolvedValue(baseCall({
      direction: "inbound",
      fromNumber: "+994501234567",
      toNumber: "100",
      status: "ringing",
    }))
    mocks.callEventCreate.mockRejectedValue(uniqueConflict())
    mocks.callEventFindFirst.mockResolvedValue({
      payload: { version: 1, state: "ringing", occurredAt },
    })

    const response = await POST(request(ringingPayload()))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, result: "existing" })
    expect(mocks.callLogCreate).not.toHaveBeenCalled()
  })

  it("rejects a ringing identity that collides with an outbound call id", async () => {
    mocks.callLogFindFirst.mockResolvedValue(baseCall())

    const response = await POST(request(ringingPayload()))

    expect(response.status).toBe(409)
    expect(mocks.callLogCreate).not.toHaveBeenCalled()
    expect(mocks.callEventCreate).not.toHaveBeenCalled()
  })

  it("strictly binds an answer observation to one ordinary Asterisk call", async () => {
    const response = await POST(request(answeredPayload()))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, result: "applied" })
    expect(mocks.callLogFindFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-test",
        provider: "asterisk",
        callMode: "human",
        providerCallId: callId,
        callSid: callId,
      },
      select: {
        id: true,
        leadId: true,
        leadCallClaimToken: true,
        direction: true,
        fromNumber: true,
        toNumber: true,
        status: true,
        duration: true,
        wasAnswered: true,
        providerOutcome: true,
        conversationOutcome: true,
        startedAt: true,
        endedAt: true,
      },
    })
    expect(mocks.callLogUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "human-call-log-1",
        organizationId: "org-test",
        provider: "asterisk",
        callMode: "human",
        providerCallId: callId,
        callSid: callId,
        providerOutcome: null,
        endedAt: null,
      },
      data: {
        status: "in-progress",
        wasAnswered: true,
      },
    })
    expect(mocks.callEventCreate).toHaveBeenCalledWith({
      data: {
        organizationId: "org-test",
        callLogId: "human-call-log-1",
        provider: "asterisk",
        providerCallId: callId,
        eventType: "asterisk_human_call_lifecycle",
        eventHash: `asterisk-human-lifecycle-v1:${eventId}`,
        payload: {
          version: 1,
          state: "answered",
          occurredAt,
        },
      },
    })
  })

  it.each([
    ["connected", "completed", true, 27],
    ["no_answer", "no-answer", false, 0],
    ["busy", "busy", false, 0],
    ["failed", "failed", false, 0],
    ["cancelled", "canceled", false, 0],
  ] as const)(
    "stores the proven %s terminal result without changing canonical party identity",
    async (state, status, wasAnswered, durationSeconds) => {
      const response = await POST(request(terminalPayload(state)))

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ success: true, result: "applied" })
      const update = mocks.callLogUpdateMany.mock.calls[0]?.[0]
      expect(update).toEqual({
        where: {
          id: "human-call-log-1",
          organizationId: "org-test",
          provider: "asterisk",
          callMode: "human",
          providerCallId: callId,
          callSid: callId,
          providerOutcome: null,
          ...(state === "connected" ? {} : { wasAnswered: false }),
        },
        data: {
          status,
          wasAnswered,
          providerOutcome: state,
          conversationOutcome: null,
          duration: durationSeconds,
          endedAt: new Date(occurredAt),
          browserAnswerClaimToken: null,
          browserAnswerClaimExpiresAt: null,
        },
      })
      expect(update.data).not.toHaveProperty("targetPhoneE164")
      expect(update.data).not.toHaveProperty("toNumber")
      expect(update.data).not.toHaveProperty("fromNumber")
      expect(update.data).not.toHaveProperty("contactId")
      expect(update.data).not.toHaveProperty("leadId")
      expect(mocks.callEventCreate.mock.calls[0]?.[0]?.data.payload).toEqual({
        version: 1,
        state,
        occurredAt,
        durationSeconds,
      })
    },
  )

  it("records authorized-but-indeterminate delivery without asserting a false terminal outcome", async () => {
    const response = await POST(request({
      eventId,
      callId,
      state: "unknown_no_redial",
      occurredAt,
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, result: "applied" })
    expect(mocks.callLogUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "human-call-log-1",
        organizationId: "org-test",
        provider: "asterisk",
        callMode: "human",
        providerCallId: callId,
        callSid: callId,
        providerOutcome: null,
        conversationOutcome: null,
        wasAnswered: false,
        endedAt: null,
      },
      data: {
        status: "dispatch-uncertain",
        conversationOutcome: "provider_unknown_no_redial",
        endedAt: new Date(occurredAt),
        browserAnswerClaimToken: null,
        browserAnswerClaimExpiresAt: null,
      },
    })
    expect(mocks.callEventCreate.mock.calls[0]?.[0]?.data.payload).toEqual({
      version: 1,
      state: "unknown_no_redial",
      occurredAt,
    })
  })

  it("preserves a proven answer when generation loss makes only the terminal result unknown", async () => {
    mocks.callLogFindFirst.mockResolvedValue({
      ...baseCall(),
      status: "in-progress",
      wasAnswered: true,
    })

    const response = await POST(request({
      eventId,
      callId,
      state: "unknown_no_redial",
      occurredAt,
    }))

    expect(response.status).toBe(200)
    expect(mocks.callLogUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        providerOutcome: null,
        conversationOutcome: null,
        wasAnswered: true,
      }),
      data: {
        status: "completed",
        conversationOutcome: "provider_connected_pending_result",
        endedAt: new Date(occurredAt),
        browserAnswerClaimToken: null,
        browserAnswerClaimExpiresAt: null,
      },
    })
  })

  it("does not let the human endpoint mutate an AI or non-Asterisk call", async () => {
    mocks.callLogFindFirst.mockResolvedValue(null)

    const response = await POST(request(terminalPayload()))

    expect(response.status).toBe(404)
    expect(mocks.callLogUpdateMany).not.toHaveBeenCalled()
    expect(mocks.callEventCreate).not.toHaveBeenCalled()
  })

  it("returns an exact event replay as an idempotent no-op", async () => {
    mocks.callEventCreate.mockRejectedValue(uniqueConflict())
    mocks.callEventFindFirst.mockResolvedValue({
      payload: {
        version: 1,
        state: "connected",
        occurredAt,
        durationSeconds: 27,
      },
    })

    const response = await POST(request(terminalPayload()))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, result: "existing" })
    expect(mocks.callLogUpdateMany).not.toHaveBeenCalled()
    expect(mocks.callEventFindFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-test",
        provider: "asterisk",
        providerCallId: callId,
        eventType: "asterisk_human_call_lifecycle",
        eventHash: `asterisk-human-lifecycle-v1:${eventId}`,
      },
      select: { payload: true },
    })
  })

  it("rejects event-id reuse with a changed payload", async () => {
    mocks.callEventCreate.mockRejectedValue(uniqueConflict())
    mocks.callEventFindFirst.mockResolvedValue({
      payload: {
        version: 1,
        state: "no_answer",
        occurredAt,
        durationSeconds: 0,
      },
    })

    const response = await POST(request(terminalPayload("connected")))

    expect(response.status).toBe(409)
    expect(mocks.callLogUpdateMany).not.toHaveBeenCalled()
  })

  it("does not regress a terminal call when a delayed answer event arrives", async () => {
    mocks.callLogFindFirst.mockResolvedValue(baseCall({
      status: "completed",
      duration: 27,
      wasAnswered: true,
      providerOutcome: "connected",
      endedAt: new Date(occurredAt),
    }))

    const response = await POST(request(answeredPayload()))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, result: "existing" })
    expect(mocks.callLogUpdateMany).not.toHaveBeenCalled()
    expect(mocks.callEventCreate).toHaveBeenCalledTimes(1)
  })

  it("lets a proven PBX terminal event correct an unproven manual endedAt", async () => {
    mocks.callLogFindFirst.mockResolvedValue(baseCall({
      status: "completed",
      endedAt: new Date(new Date(occurredAt).getTime() - 5_000),
      providerOutcome: null,
    }))

    const response = await POST(request(terminalPayload("connected")))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, result: "applied" })
    expect(mocks.callLogUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.not.objectContaining({ endedAt: null }),
      data: expect.objectContaining({
        providerOutcome: "connected",
        endedAt: new Date(occurredAt),
      }),
    }))
  })

  it("rejects a different terminal result after terminal state is durable", async () => {
    mocks.callLogFindFirst.mockResolvedValue(baseCall({
      status: "no-answer",
      duration: 0,
      wasAnswered: false,
      providerOutcome: "no_answer",
      endedAt: new Date(occurredAt),
    }))

    const response = await POST(request(terminalPayload("busy")))

    expect(response.status).toBe(409)
    expect(mocks.callLogUpdateMany).not.toHaveBeenCalled()
  })

  it("rejects a pre-answer terminal classification after answer was proven", async () => {
    mocks.callLogFindFirst.mockResolvedValue(baseCall({
      status: "in-progress",
      wasAnswered: true,
    }))

    const response = await POST(request(terminalPayload("no_answer")))

    expect(response.status).toBe(409)
    expect(mocks.callLogUpdateMany).not.toHaveBeenCalled()
  })

  it("rejects an event timestamp too far in the future before journaling", async () => {
    const response = await POST(request(answeredPayload({
      occurredAt: new Date(Date.now() + 10 * 60 * 1_000).toISOString(),
    })))

    expect(response.status).toBe(400)
    expect(mocks.callEventCreate).not.toHaveBeenCalled()
    expect(mocks.callLogUpdateMany).not.toHaveBeenCalled()
  })

  it("rejects an event that predates the bound CallLog", async () => {
    mocks.callLogFindFirst.mockResolvedValue(baseCall({
      startedAt: new Date(new Date(occurredAt).getTime() + 10 * 60 * 1_000),
    }))

    const response = await POST(request(answeredPayload()))

    expect(response.status).toBe(409)
    expect(mocks.callEventCreate).not.toHaveBeenCalled()
    expect(mocks.callLogUpdateMany).not.toHaveBeenCalled()
  })
})
