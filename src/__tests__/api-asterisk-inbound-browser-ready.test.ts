import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  callLogFindFirst: vi.fn(),
  callLogUpdateMany: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: { callLog: {
    findFirst: mocks.callLogFindFirst,
    updateMany: mocks.callLogUpdateMany,
  } },
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
  vi.stubGlobal("fetch", vi.fn())
})

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
    mocks.callLogFindFirst.mockResolvedValue({
      id: "call-log-1",
      providerCallId: callId,
      claimedByUserId: "user-1",
      userId: "user-1",
      browserAnswerClaimToken: claimToken,
      browserAnswerClaimExpiresAt: new Date(Date.now() + 30_000),
    })
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ready: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }))
    const { POST } = await import("@/app/api/internal/asterisk/inbound-browser-ready/route")

    const response = await POST(request({ callId }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ready: true })
    expect(mocks.callLogFindFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        organizationId: "org-1",
        provider: "asterisk",
        direction: "inbound",
        callMode: "human",
        providerCallId: callId,
        callSid: callId,
        status: { in: ["ringing", "answering"] },
        endedAt: null,
        claimedByUserId: { not: null },
        browserAnswerClaimToken: { not: null },
        browserAnswerClaimExpiresAt: { gt: expect.any(Date) },
      }),
      select: {
        id: true,
        providerCallId: true,
        claimedByUserId: true,
        userId: true,
        browserAnswerClaimToken: true,
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
    mocks.callLogFindFirst.mockResolvedValue({
      id: "call-log-1",
      providerCallId: callId,
      claimedByUserId: "user-1",
      userId: "user-1",
      browserAnswerClaimToken: claimToken,
      browserAnswerClaimExpiresAt: new Date(Date.now() + 30_000),
    })
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
    mocks.callLogFindFirst.mockResolvedValue({
      id: "call-log-1",
      providerCallId: callId,
      claimedByUserId: "user-1",
      userId: "user-1",
      browserAnswerClaimToken: claimToken,
      browserAnswerClaimExpiresAt: new Date(Date.now() + 30_000),
    })
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

  it("rejects invalid identity and authorization before a database read", async () => {
    const { POST } = await import("@/app/api/internal/asterisk/inbound-browser-ready/route")

    expect((await POST(request({ callId }, "wrong"))).status).toBe(401)
    expect((await POST(request({ callId: "not-a-uuid" }))).status).toBe(400)
    expect(mocks.callLogFindFirst).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
