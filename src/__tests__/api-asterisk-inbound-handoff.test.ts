import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

// Owner, 2026-10-27: the AI hands an inbound call to the managers' browsers;
// nobody answers in time and the AI takes it back. The station asks this route
// after the AI leg (start) and after the ring time (return).
vi.mock("@/lib/voip/line-numbers", () => ({
  voiceOrganizationFor: async () => ({ organizationId: "org-zeytun", channelConfigId: "line-1" }),
}))
vi.mock("@prisma/client", () => ({ Prisma: { TransactionIsolationLevel: { ReadCommitted: "ReadCommitted" } } }))

const mocks = vi.hoisted(() => ({
  callLogFindFirst: vi.fn(),
  callLogUpdateMany: vi.fn(),
  callEventCreate: vi.fn(),
  transaction: vi.fn(),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: { callLog: { findFirst: mocks.callLogFindFirst, updateMany: mocks.callLogUpdateMany }, $transaction: mocks.transaction },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: vi.fn((_organizationId: string, callback: () => unknown) => callback()),
}))

const callId = "d9539247-9f92-4fc5-a926-758535082d04"

function request(body: unknown, token = "runtime-token") {
  return new NextRequest("http://localhost/api/internal/asterisk/inbound-handoff", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.FANUM_VOICE_RUNTIME_TOKEN = "runtime-token"
  mocks.callLogFindFirst.mockResolvedValue({ id: "call-log-1" })
  mocks.callLogUpdateMany.mockResolvedValue({ count: 1 })
  mocks.callEventCreate.mockResolvedValue({ id: "event-1" })
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    callLog: { updateMany: mocks.callLogUpdateMany },
    callEvent: { create: mocks.callEventCreate },
  }))
})

describe("POST /api/internal/asterisk/inbound-handoff", () => {
  it("turns a requested handoff into an ordinary ringing inbound call for the browsers", async () => {
    const { POST } = await import("@/app/api/internal/asterisk/inbound-handoff/route")
    const response = await POST(request({ callId, action: "start" }))
    await expect(response.json()).resolves.toEqual({ handoff: true })
    const { where, data } = mocks.callLogUpdateMany.mock.calls[0][0]
    expect(where).toMatchObject({ id: "call-log-1", organizationId: "org-zeytun", provider: "asterisk", direction: "inbound",
      providerCallId: callId, callSid: callId, endedAt: null, callMode: "ai", handoffState: "requested" })
    expect(data).toMatchObject({ callMode: "human", status: "ringing", handoffState: "ringing", handoffRequestedAt: expect.any(Date),
      userId: null, claimedByUserId: null, browserAnswerClaimToken: null, browserAnswerClaimExpiresAt: null })
    expect(mocks.callEventCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      callLogId: "call-log-1", eventType: "asterisk_inbound_ai_handoff", eventHash: "asterisk-inbound-ai-handoff-v1:ringing" }) })
  })

  it("answers no handoff when the AI never asked, so the station ends the call as before", async () => {
    mocks.callLogUpdateMany.mockResolvedValue({ count: 0 })
    const { POST } = await import("@/app/api/internal/asterisk/inbound-handoff/route")
    await expect((await POST(request({ callId, action: "start" }))).json()).resolves.toEqual({ handoff: false })
    expect(mocks.callEventCreate).not.toHaveBeenCalled()
    mocks.callLogFindFirst.mockResolvedValue(null)
    await expect((await POST(request({ callId, action: "start" }))).json()).resolves.toEqual({ handoff: false })
  })

  it("gives a call nobody answered back to the AI, dropping a claim that never became ready", async () => {
    const { POST } = await import("@/app/api/internal/asterisk/inbound-handoff/route")
    await expect((await POST(request({ callId, action: "return" }))).json()).resolves.toEqual({ returned: true })
    const { where, data } = mocks.callLogUpdateMany.mock.calls[0][0]
    // A browser the station already reserved (status answering) keeps the call.
    expect(where).toMatchObject({ callMode: "human", status: "ringing", handoffState: "ringing", endedAt: null })
    expect(data).toMatchObject({ callMode: "ai", status: "in-progress", handoffState: "returned",
      claimedByUserId: null, browserAnswerClaimToken: null })
  })

  it("a replayed step is refused by its journal row, never applied twice", async () => {
    mocks.callEventCreate.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }))
    const { POST } = await import("@/app/api/internal/asterisk/inbound-handoff/route")
    await expect((await POST(request({ callId, action: "return" }))).json()).resolves.toEqual({ returned: false })
  })

  it("rejects a wrong token or an unknown action before reading anything", async () => {
    const { POST } = await import("@/app/api/internal/asterisk/inbound-handoff/route")
    expect((await POST(request({ callId, action: "start" }, "wrong-token"))).status).toBe(401)
    expect((await POST(request({ callId, action: "ai" }))).status).toBe(400)
    expect((await POST(request({ callId: "not-a-uuid", action: "start" }))).status).toBe(400)
    expect(mocks.callLogFindFirst).not.toHaveBeenCalled()
  })
})

describe("the AI asking for a person", () => {
  it("records the request once and repeats it while the AI leg is still on", async () => {
    const { requestAiHandoff } = await import("@/lib/voip/inbound-handoff")
    const db = { $transaction: mocks.transaction, callLog: { findFirst: mocks.callLogFindFirst } }
    const ref = { organizationId: "org-zeytun", callLogId: "call-log-1", providerCallId: callId }
    expect(await requestAiHandoff(db as never, ref)).toBe(true)
    expect(mocks.callLogUpdateMany.mock.calls[0][0]).toMatchObject({
      where: { callMode: "ai", status: "in-progress", wasAnswered: true, handoffState: null },
      data: { handoffState: "requested", handoffRequestedAt: expect.any(Date) },
    })
    // Asked again before the leg ended: the same request.
    mocks.callLogUpdateMany.mockResolvedValue({ count: 0 })
    mocks.callLogFindFirst.mockResolvedValue({ id: "call-log-1" })
    expect(await requestAiHandoff(db as never, ref)).toBe(true)
    expect(mocks.callLogFindFirst.mock.calls.at(-1)?.[0].where).toMatchObject({ handoffState: "requested", callMode: "ai" })
    // Handed off once already (rang, returned): never again.
    mocks.callLogFindFirst.mockResolvedValue(null)
    expect(await requestAiHandoff(db as never, ref)).toBe(false)
  })
})
