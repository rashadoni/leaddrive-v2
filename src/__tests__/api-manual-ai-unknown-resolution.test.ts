import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  auth: { orgId: "org-1", userId: "manager-1", role: "manager" },
  transaction: vi.fn(),
  findSession: vi.fn(),
  findLead: vi.fn(),
  findHumanCall: vi.fn(),
  findHumanCalls: vi.fn(),
  updateSession: vi.fn(),
  updateCall: vi.fn(),
  createEvents: vi.fn(),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: (...args: unknown[]) => unknown) => (
    request: NextRequest,
    context: unknown,
  ) => handler(request, mocks.auth, context),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}))

import { POST } from "@/app/api/v1/leads/[id]/ai-call/resolve-unknown/route"

const callId = "call-log-1"
const leadId = "lead-1"

function request(body: unknown) {
  return new NextRequest(`http://localhost/api/v1/leads/${leadId}/ai-call/resolve-unknown`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function context() {
  return { params: Promise.resolve({ id: leadId }) }
}

function unresolvedSession() {
  return {
    id: "session-1",
    callLogId: callId,
    providerCallId: "9f5fa15c-a6f0-4f6f-af73-c5049e3d9de7",
    status: "dispatch_uncertain",
    outcome: null,
    blockReason: "provider_unknown_no_redial",
    activeOrganizationKey: null,
    endedAt: new Date("2026-08-10T09:00:00.000Z"),
    callLog: {
      providerOutcome: null,
      conversationOutcome: "provider_unknown_no_redial",
    },
  }
}

describe("POST /api/v1/leads/[id]/ai-call/resolve-unknown", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(mocks.auth, { orgId: "org-1", userId: "manager-1", role: "manager" })
    mocks.findSession.mockResolvedValue(unresolvedSession())
    mocks.findLead.mockResolvedValue({ phone: "+994501234567" })
    mocks.findHumanCall.mockResolvedValue(null)
    mocks.findHumanCalls.mockResolvedValue([])
    mocks.updateSession.mockResolvedValue({ count: 1 })
    mocks.updateCall.mockResolvedValue({ count: 1 })
    mocks.createEvents.mockResolvedValue({ count: 1 })
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      voiceCallSession: { findFirst: mocks.findSession, updateMany: mocks.updateSession },
      lead: { findFirst: mocks.findLead },
      callLog: {
        findFirst: mocks.findHumanCall,
        findMany: mocks.findHumanCalls,
        updateMany: mocks.updateCall,
      },
      callEvent: { createMany: mocks.createEvents },
    }))
  })

  it("requires manager authority without revealing whether the call exists", async () => {
    mocks.auth.role = "sales"
    const response = await POST(request({
      resolution: "unknown_no_redial",
      acknowledgeNoRedial: true,
    }), context())

    expect(response.status).toBe(404)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("rejects non-JSON browser mutations before reading call state", async () => {
    const response = await POST(new NextRequest(
      `http://localhost/api/v1/leads/${leadId}/ai-call/resolve-unknown`,
      {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ resolution: "unknown_no_redial", acknowledgeNoRedial: true }),
      },
    ), context())

    expect(response.status).toBe(415)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("clears manual AI lead and phone fences only after explicit no-redial acknowledgement", async () => {
    const response = await POST(request({
      resolution: "unknown_no_redial",
      acknowledgeNoRedial: true,
    }), context())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, replayed: false })
    expect(mocks.findSession).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ["dispatch_uncertain", "cancelled"] },
        blockReason: "provider_unknown_no_redial",
        callLog: { is: expect.objectContaining({
          conversationOutcome: "provider_unknown_no_redial",
        }) },
      }),
      orderBy: { createdAt: "desc" },
    }))
    expect(mocks.updateSession).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "cancelled",
        outcome: "operator_closed_unknown_no_redial",
        activeLeadKey: null,
        activePhoneKey: null,
      }),
    }))
    expect(mocks.updateCall).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ conversationOutcome: "provider_unknown_no_redial" }),
      data: { conversationOutcome: "operator_closed_unknown_no_redial" },
    }))
    expect(mocks.createEvents).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ eventType: "voice_provider_unknown_acknowledged" })],
      skipDuplicates: true,
    }))
  })

  it("acknowledges the legacy terminal provider-unknown shape without redialing", async () => {
    mocks.findSession.mockResolvedValue({
      ...unresolvedSession(),
      status: "cancelled",
      outcome: "provider_unknown_no_redial",
      activeOrganizationKey: "org-1",
    })

    const response = await POST(request({
      resolution: "unknown_no_redial",
      acknowledgeNoRedial: true,
    }), context())

    expect(response.status).toBe(200)
    expect(mocks.updateSession).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ["dispatch_uncertain", "cancelled"] },
        endedAt: { not: null },
      }),
      data: expect.objectContaining({
        status: "cancelled",
        outcome: "operator_closed_unknown_no_redial",
        activeOrganizationKey: null,
        activeLeadKey: null,
        activePhoneKey: null,
      }),
    }))
  })

  it("acknowledges an exact-phone human provider-unknown attempt without exposing its call id", async () => {
    mocks.findSession.mockResolvedValue(null)
    mocks.findHumanCalls.mockResolvedValue([{
      id: "human-call-1",
      provider: "asterisk",
      providerCallId: "3e2cb215-103e-46ae-8ac1-84fe740a6a61",
      conversationOutcome: "provider_unknown_no_redial",
      endedAt: new Date("2026-08-09T09:00:00.000Z"),
    }])

    const response = await POST(request({
      resolution: "unknown_no_redial",
      acknowledgeNoRedial: true,
    }), context())

    expect(response.status).toBe(200)
    expect(mocks.updateSession).not.toHaveBeenCalled()
    expect(mocks.updateCall).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        callMode: "human",
        targetPhoneE164: "+994501234567",
      }),
      // The attempt already terminated, so its end time is left untouched.
      data: { conversationOutcome: "operator_closed_unknown_no_redial" },
    }))
    expect(mocks.createEvents).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        callLogId: "human-call-1",
        eventHash: "human-provider-unknown-acknowledged-v1",
        payload: expect.objectContaining({ acknowledgedFromLeadId: leadId }),
      })],
    }))
  })

  it("closes a legacy attempt that never terminated and carries no conversation outcome", async () => {
    mocks.findSession.mockResolvedValue(null)
    mocks.findHumanCalls.mockResolvedValue([{
      id: "human-call-legacy",
      provider: "asterisk",
      providerCallId: "0f0a4d1c-7f6a-4f8f-9a2e-1b0d5f2a7c31",
      conversationOutcome: null,
      endedAt: null,
    }])

    const response = await POST(request({
      resolution: "unknown_no_redial",
      acknowledgeNoRedial: true,
    }), context())

    expect(response.status).toBe(200)
    const update = mocks.updateCall.mock.calls[0][0]
    // Demanding the provider-unknown marker here is what used to make exactly
    // this row unclosable, so the update must accept a never-ended attempt.
    expect(update.where.OR).toEqual([
      { endedAt: null },
      { conversationOutcome: "provider_unknown_no_redial" },
    ])
    expect(update.where).not.toHaveProperty("conversationOutcome")
    // Without an end time the row keeps matching the fence and the operator's
    // acknowledgement would release nothing.
    expect(update.data.endedAt).toBeInstanceOf(Date)
    expect(update.data.conversationOutcome).toBe("operator_closed_unknown_no_redial")
  })

  it("closes every attempt fencing the phone, not only the newest one", async () => {
    mocks.findSession.mockResolvedValue(null)
    mocks.findHumanCalls.mockResolvedValue([
      {
        id: "human-call-new",
        provider: "asterisk",
        providerCallId: "11111111-1111-4111-8111-111111111111",
        conversationOutcome: null,
        endedAt: null,
      },
      {
        // A legacy attempt from another provider was permanently unclosable
        // while the update pinned the provider to asterisk.
        id: "human-call-old",
        provider: "threecx",
        providerCallId: "22222222-2222-4222-8222-222222222222",
        conversationOutcome: null,
        endedAt: null,
      },
    ])

    const response = await POST(request({
      resolution: "unknown_no_redial",
      acknowledgeNoRedial: true,
    }), context())

    expect(response.status).toBe(200)
    expect(mocks.updateCall).toHaveBeenCalledTimes(2)
    expect(mocks.updateCall.mock.calls.map(([arg]) => arg.where.provider))
      .toEqual(["asterisk", "threecx"])
    expect(mocks.createEvents.mock.calls[0][0].data.map((row: { callLogId: string }) => row.callLogId))
      .toEqual(["human-call-new", "human-call-old"])
  })

  it("replays an already acknowledged phone instead of reporting it missing", async () => {
    mocks.findSession.mockResolvedValue(null)
    mocks.findHumanCalls.mockResolvedValue([])
    mocks.findHumanCall.mockResolvedValue({ id: "human-call-closed" })

    const response = await POST(request({
      resolution: "unknown_no_redial",
      acknowledgeNoRedial: true,
    }), context())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, replayed: true })
    expect(mocks.updateCall).not.toHaveBeenCalled()
  })

  it("reports a conflict when a fenced attempt changes under the acknowledgement", async () => {
    mocks.findSession.mockResolvedValue(null)
    mocks.findHumanCalls.mockResolvedValue([{
      id: "human-call-racing",
      provider: "asterisk",
      providerCallId: "33333333-3333-4333-8333-333333333333",
      conversationOutcome: null,
      endedAt: null,
    }])
    mocks.updateCall.mockResolvedValue({ count: 0 })

    const response = await POST(request({
      resolution: "unknown_no_redial",
      acknowledgeNoRedial: true,
    }), context())

    expect(response.status).toBe(409)
    expect(mocks.createEvents).not.toHaveBeenCalled()
  })

  it("fails closed when the current lead has no canonical phone", async () => {
    mocks.findSession.mockResolvedValue(null)
    mocks.findLead.mockResolvedValue({ phone: "invalid" })

    const response = await POST(request({
      resolution: "unknown_no_redial",
      acknowledgeNoRedial: true,
    }), context())

    expect(response.status).toBe(404)
    expect(mocks.findHumanCall).not.toHaveBeenCalled()
    expect(mocks.findHumanCalls).not.toHaveBeenCalled()
    expect(mocks.updateCall).not.toHaveBeenCalled()
  })

  it("rejects missing acknowledgement without touching call state", async () => {
    const response = await POST(request({
      resolution: "unknown_no_redial",
      acknowledgeNoRedial: false,
    }), context())

    expect(response.status).toBe(400)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
