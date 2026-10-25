import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

// This route only uses the transaction enum; its DB boundary is mocked below.
// The number -> organization lookup is its own suite (voice-line-numbers-postgres);
// here every call belongs to the installation's default organization, as before it.
vi.mock("@/lib/voip/line-numbers", () => ({
  voiceOrganizationFor: async () => process.env.VOICE_AGENT_ORGANIZATION_ID
    ? { organizationId: process.env.VOICE_AGENT_ORGANIZATION_ID, channelConfigId: null } : null,
}))
vi.mock("@prisma/client", () => ({ Prisma: { TransactionIsolationLevel: { ReadCommitted: "ReadCommitted" } } }))

const mocks = vi.hoisted(() => ({
  callLogFindFirst: vi.fn(),
  callLogUpdateMany: vi.fn(),
  callEventCreate: vi.fn(),
  channelConfigFindMany: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    callLog: {
      findFirst: mocks.callLogFindFirst,
      updateMany: mocks.callLogUpdateMany,
    },
    channelConfig: { findMany: mocks.channelConfigFindMany },
    $transaction: mocks.transaction,
  },
}))

vi.mock("@/lib/rls-context", () => ({
  runWithTenant: vi.fn((_organizationId: string, callback: () => unknown) => callback()),
}))

const callId = "d9539247-9f92-4fc5-a926-758535082d04"
const claimToken = "11111111-1111-4111-8111-111111111111"
const originalToken = process.env.FANUM_VOICE_RUNTIME_TOKEN
const originalOrg = process.env.VOICE_AGENT_ORGANIZATION_ID
const originalRelaySecret = process.env.SOFTPHONE_RELAY_SECRET
const originalRelayPort = process.env.SOFTPHONE_RELAY_PORT

function request(body: unknown, token = "runtime-token") {
  return new NextRequest("http://localhost/api/internal/asterisk/inbound-browser-ready", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.FANUM_VOICE_RUNTIME_TOKEN = "runtime-token"
  process.env.VOICE_AGENT_ORGANIZATION_ID = "org-1"
  process.env.SOFTPHONE_RELAY_SECRET = "r".repeat(48)
  process.env.SOFTPHONE_RELAY_PORT = "18095"
  mocks.callLogUpdateMany.mockResolvedValue({ count: 1 })
  mocks.callEventCreate.mockResolvedValue({ id: "event-1" })
  mocks.channelConfigFindMany.mockResolvedValue([])
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    callLog: { updateMany: mocks.callLogUpdateMany },
    callEvent: { create: mocks.callEventCreate },
  }))
  vi.stubGlobal("fetch", vi.fn())
})

function claimedCall(overrides: Record<string, unknown> = {}) {
  return {
    id: "call-log-1",
    callMode: "human",
    status: "ringing",
    startedAt: new Date(),
    createdAt: new Date(),
    providerCallId: callId,
    claimedByUserId: "user-1",
    userId: "user-1",
    browserAnswerClaimToken: claimToken,
    browserAnswerClaimExpiresAt: new Date(Date.now() + 30_000),
    ...overrides,
  }
}

function unclaimedCall(ringingForMs: number, overrides: Record<string, unknown> = {}) {
  return claimedCall({
    startedAt: new Date(Date.now() - ringingForMs),
    claimedByUserId: null,
    userId: null,
    browserAnswerClaimToken: null,
    browserAnswerClaimExpiresAt: null,
    ...overrides,
  })
}

function stationLine(settings: Record<string, unknown>) {
  mocks.channelConfigFindMany.mockResolvedValue([{
    id: "line-1",
    settings: {
      provider: "asterisk",
      voiceAgentEnabled: true,
      voiceAgentPrompt: "rules",
      ...settings,
    },
  }])
}

afterEach(() => {
  if (originalToken === undefined) delete process.env.FANUM_VOICE_RUNTIME_TOKEN
  else process.env.FANUM_VOICE_RUNTIME_TOKEN = originalToken
  if (originalOrg === undefined) delete process.env.VOICE_AGENT_ORGANIZATION_ID
  else process.env.VOICE_AGENT_ORGANIZATION_ID = originalOrg
  if (originalRelaySecret === undefined) delete process.env.SOFTPHONE_RELAY_SECRET
  else process.env.SOFTPHONE_RELAY_SECRET = originalRelaySecret
  if (originalRelayPort === undefined) delete process.env.SOFTPHONE_RELAY_PORT
  else process.env.SOFTPHONE_RELAY_PORT = originalRelayPort
  vi.unstubAllGlobals()
})

describe("PBX inbound browser readiness", () => {
  it("returns ready only for a fresh relay-verified browser claim", async () => {
    mocks.callLogFindFirst.mockResolvedValue(claimedCall())
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ready: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }))
    const { POST } = await import("@/app/api/internal/asterisk/inbound-browser-ready/route")

    const response = await POST(request({ callId }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ready: true })
    expect(mocks.callLogFindFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        provider: "asterisk",
        direction: "inbound",
        callMode: { in: ["human", "ai"] },
        providerCallId: callId,
        callSid: callId,
        status: { in: ["ringing", "answering", "in-progress"] },
        endedAt: null,
      },
      select: {
        id: true,
        callMode: true,
        status: true,
        startedAt: true,
        createdAt: true,
        providerCallId: true,
        claimedByUserId: true,
        userId: true,
        browserAnswerClaimToken: true,
        browserAnswerClaimExpiresAt: true,
      },
    })
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:18095/internal/browser-ready",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-relay-secret": "r".repeat(48),
        },
        body: JSON.stringify({
          correlationId: callId,
          claimToken,
        }),
        signal: expect.any(AbortSignal),
      }),
    )
    expect(mocks.callLogUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "call-log-1",
        organizationId: "org-1",
        status: { in: ["ringing", "answering"] },
        browserAnswerClaimToken: claimToken,
        browserAnswerClaimExpiresAt: { gt: expect.any(Date) },
      }),
      data: {
        status: "answering",
        browserAnswerClaimExpiresAt: expect.any(Date),
      },
    })
  })

  it("returns not-ready without contacting the relay when no fresh claim exists", async () => {
    mocks.callLogFindFirst.mockResolvedValue(null)
    const { POST } = await import("@/app/api/internal/asterisk/inbound-browser-ready/route")

    const response = await POST(request({ callId }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ready: false })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("returns not-ready without exposing relay rejection or failure", async () => {
    mocks.callLogFindFirst.mockResolvedValue(claimedCall())
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ ready: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      .mockRejectedValueOnce(new Error("relay unavailable"))
    const { POST } = await import("@/app/api/internal/asterisk/inbound-browser-ready/route")

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await POST(request({ callId }))
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ ready: false })
    }
    expect(mocks.callLogUpdateMany).not.toHaveBeenCalled()
  })

  it("returns not-ready when the exact claim changes after the relay check", async () => {
    mocks.callLogFindFirst.mockResolvedValue(claimedCall())
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ready: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }))
    mocks.callLogUpdateMany.mockResolvedValue({ count: 0 })
    const { POST } = await import("@/app/api/internal/asterisk/inbound-browser-ready/route")

    const response = await POST(request({ callId }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ready: false })
  })

  it("hands an unclaimed ringing call to the AI at once when the AI answers inbound calls", async () => {
    stationLine({ inboundAnswerMode: "ai" })
    mocks.callLogFindFirst.mockResolvedValue(unclaimedCall(500))
    const { POST } = await import("@/app/api/internal/asterisk/inbound-browser-ready/route")

    const response = await POST(request({ callId }))

    await expect(response.json()).resolves.toEqual({ ready: false, route: "ai" })
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.callLogUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "call-log-1",
        organizationId: "org-1",
        direction: "inbound",
        callMode: "human",
        status: "ringing",
        endedAt: null,
        AND: [{ OR: [{ channelConfigId: null }, { channelConfigId: "line-1" }] }],
        OR: [
          { browserAnswerClaimToken: null },
          { browserAnswerClaimExpiresAt: null },
          { browserAnswerClaimExpiresAt: { lte: expect.any(Date) } },
        ],
      }),
      data: {
        callMode: "ai",
        channelConfigId: "line-1",
        status: "answering",
        userId: null,
        claimedByUserId: null,
        claimedAt: null,
        browserAnswerClaimToken: null,
        browserAnswerClaimExpiresAt: null,
      },
    })
    expect(mocks.callEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        callLogId: "call-log-1",
        providerCallId: callId,
        eventType: "asterisk_inbound_answer_route",
        payload: expect.objectContaining({ route: "ai" }),
      }),
    })
  })

  it("lets salespeople ring for the configured number of rings before the AI picks up", async () => {
    stationLine({ inboundAnswerMode: "human_then_ai", inboundAiAfterRings: 3 })
    const { POST } = await import("@/app/api/internal/asterisk/inbound-browser-ready/route")

    mocks.callLogFindFirst.mockResolvedValue(unclaimedCall(14_000))
    await expect((await POST(request({ callId }))).json()).resolves.toEqual({ ready: false })
    expect(mocks.callLogUpdateMany).not.toHaveBeenCalled()

    mocks.callLogFindFirst.mockResolvedValue(unclaimedCall(15_000))
    await expect((await POST(request({ callId }))).json()).resolves.toEqual({ ready: false, route: "ai" })
    expect(mocks.callLogUpdateMany).toHaveBeenCalledTimes(1)
  })

  it("never routes to the AI when people answer, or when the voice agent is off", async () => {
    const { POST } = await import("@/app/api/internal/asterisk/inbound-browser-ready/route")
    for (const settings of [
      { inboundAnswerMode: "human" },
      {},
      { inboundAnswerMode: "ai", voiceAgentEnabled: false },
    ]) {
      stationLine(settings)
      mocks.callLogFindFirst.mockResolvedValue(unclaimedCall(60_000))
      await expect((await POST(request({ callId }))).json()).resolves.toEqual({ ready: false })
    }
    expect(mocks.callLogUpdateMany).not.toHaveBeenCalled()
  })

  it("keeps a call a salesperson is already answering, even when the AI would take it", async () => {
    stationLine({ inboundAnswerMode: "ai" })
    mocks.callLogFindFirst.mockResolvedValue(claimedCall({ startedAt: new Date(Date.now() - 60_000) }))
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ready: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }))
    const { POST } = await import("@/app/api/internal/asterisk/inbound-browser-ready/route")

    await expect((await POST(request({ callId }))).json()).resolves.toEqual({ ready: false })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("keeps telling the station the AI has the call on every later poll", async () => {
    mocks.callLogFindFirst.mockResolvedValue(unclaimedCall(1_000, { callMode: "ai", status: "in-progress" }))
    const { POST } = await import("@/app/api/internal/asterisk/inbound-browser-ready/route")

    await expect((await POST(request({ callId }))).json()).resolves.toEqual({ ready: false, route: "ai" })
    expect(mocks.callLogUpdateMany).not.toHaveBeenCalled()
    expect(mocks.channelConfigFindMany).not.toHaveBeenCalled()
  })

  it("does not route to the AI when a salesperson won the same instant", async () => {
    stationLine({ inboundAnswerMode: "ai" })
    mocks.callLogFindFirst.mockResolvedValue(unclaimedCall(500))
    mocks.callLogUpdateMany.mockResolvedValue({ count: 0 })
    const { POST } = await import("@/app/api/internal/asterisk/inbound-browser-ready/route")

    await expect((await POST(request({ callId }))).json()).resolves.toEqual({ ready: false })
    expect(mocks.callEventCreate).not.toHaveBeenCalled()
  })

  it("rejects invalid identity and authorization before a database read", async () => {
    const { POST } = await import("@/app/api/internal/asterisk/inbound-browser-ready/route")

    expect((await POST(request({ callId }, "wrong"))).status).toBe(401)
    expect((await POST(request({ callId: "not-a-uuid" }))).status).toBe(400)
    expect(mocks.callLogFindFirst).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
