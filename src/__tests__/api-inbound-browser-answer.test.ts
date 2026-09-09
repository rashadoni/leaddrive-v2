import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { readParkTicket } from "@/lib/voip/browser-softphone"

const mocks = vi.hoisted(() => ({
  callLogFindFirst: vi.fn(),
  callLogUpdateMany: vi.fn(),
  getOrgModuleContext: vi.fn(),
  checkPermission: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    callLog: {
      findFirst: mocks.callLogFindFirst,
      updateMany: mocks.callLogUpdateMany,
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgModuleContext: mocks.getOrgModuleContext,
}))

vi.mock("@/lib/calls/access", () => ({
  accessibleCallWhere: vi.fn(() => ({ id: "accessible-call" })),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsSessionAuth: (handler: (
    request: NextRequest,
    auth: { orgId: string; userId: string; role: string },
    context: unknown,
  ) => unknown) =>
    (request: NextRequest, context: unknown) => handler(request, {
      orgId: "org-1",
      userId: "user-1",
      role: "sales",
    }, context),
}))

vi.mock("@/lib/permissions", () => ({
  checkPermission: mocks.checkPermission,
}))

const callId = "call-log-1"
const correlationId = "d9539247-9f92-4fc5-a926-758535082d04"
const claimToken = "11111111-1111-4111-8111-111111111111"
const originalEnv = {
  enabled: process.env.BROWSER_SOFTPHONE_ENABLED,
  users: process.env.BROWSER_SOFTPHONE_USER_IDS,
  ticket: process.env.BROWSER_SOFTPHONE_TICKET_SECRET,
  relay: process.env.SOFTPHONE_RELAY_URL,
}

function request(method: "POST" | "PATCH" | "DELETE" = "POST", token = claimToken) {
  return new NextRequest(`http://localhost/api/v1/calls/${callId}/browser-answer`, {
    method,
    ...(method === "POST"
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ claimToken: token }),
        }),
  })
}

function context() {
  return { params: Promise.resolve({ id: callId }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.BROWSER_SOFTPHONE_ENABLED = "1"
  process.env.BROWSER_SOFTPHONE_USER_IDS = ""
  process.env.BROWSER_SOFTPHONE_TICKET_SECRET = "t".repeat(48)
  process.env.SOFTPHONE_RELAY_URL = "wss://crm.example.test/softphone/browser"
  mocks.getOrgModuleContext.mockResolvedValue({
    plan: "enterprise",
    addons: [],
    modules: { browserSoftphone: true },
  })
  mocks.callLogUpdateMany.mockResolvedValue({ count: 1 })
  mocks.checkPermission.mockReturnValue(true)
  mocks.callLogFindFirst.mockResolvedValue({
    id: callId,
    providerCallId: correlationId,
    claimedByUserId: "user-1",
    claimedAt: new Date(),
  })
})

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    const envKey = {
      enabled: "BROWSER_SOFTPHONE_ENABLED",
      users: "BROWSER_SOFTPHONE_USER_IDS",
      ticket: "BROWSER_SOFTPHONE_TICKET_SECRET",
      relay: "SOFTPHONE_RELAY_URL",
    }[key]!
    if (value === undefined) delete process.env[envKey]
    else process.env[envKey] = value
  }
})

describe("inbound Asterisk browser answer", () => {
  it("claims the ringing call in one expiring updateMany and returns a user-bound ticket", async () => {
    const { POST } = await import("@/app/api/v1/calls/[id]/browser-answer/route")

    const response = await POST(request(), context())

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual(expect.objectContaining({
      success: true,
      relayUrl: "wss://crm.example.test/softphone/browser",
      parkTicket: expect.any(String),
      claimToken: expect.stringMatching(/^[0-9a-f-]{36}$/),
    }))
    expect(readParkTicket(body.parkTicket)).toEqual(expect.objectContaining({
      orgId: "org-1",
      userId: "user-1",
      callLogId: callId,
      claimToken: body.claimToken,
    }))
    expect(mocks.callLogUpdateMany).toHaveBeenCalledTimes(1)
    expect(mocks.callLogUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: callId,
        organizationId: "org-1",
        provider: "asterisk",
        direction: "inbound",
        callMode: "human",
        status: "ringing",
        endedAt: null,
        AND: [{ id: "accessible-call" }],
        OR: expect.arrayContaining([
          { browserAnswerClaimToken: null },
          { browserAnswerClaimExpiresAt: null },
          { browserAnswerClaimExpiresAt: { lte: expect.any(Date) } },
        ]),
      }),
      data: expect.objectContaining({
        browserAnswerClaimToken: expect.stringMatching(/^[0-9a-f-]{36}$/),
        browserAnswerClaimExpiresAt: expect.any(Date),
        claimedByUserId: "user-1",
        claimedAt: expect.any(Date),
        userId: "user-1",
        status: "ringing",
      }),
    })
  })

  it("loses a concurrent claim without minting a ticket for the loser", async () => {
    mocks.callLogUpdateMany.mockResolvedValue({ count: 0 })
    mocks.callLogFindFirst.mockResolvedValue({
      id: callId,
      providerCallId: correlationId,
      claimedByUserId: "user-2",
      claimedAt: new Date(),
    })
    const { POST } = await import("@/app/api/v1/calls/[id]/browser-answer/route")

    const response = await POST(request(), context())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: "inbound_call_claimed" })
  })

  it("refuses before claiming when browser audio is not configured", async () => {
    delete process.env.BROWSER_SOFTPHONE_TICKET_SECRET
    const { POST } = await import("@/app/api/v1/calls/[id]/browser-answer/route")

    const response = await POST(request(), context())

    expect(response.status).toBe(503)
    expect(mocks.callLogUpdateMany).not.toHaveBeenCalled()
  })

  it("releases only this user's not-yet-answered claim", async () => {
    const { DELETE } = await import("@/app/api/v1/calls/[id]/browser-answer/route")

    const response = await DELETE(request("DELETE"), context())

    expect(response.status).toBe(200)
    expect(mocks.callLogUpdateMany).toHaveBeenCalledWith({
      where: {
        id: callId,
        organizationId: "org-1",
        provider: "asterisk",
        direction: "inbound",
        callMode: "human",
        status: "ringing",
        endedAt: null,
        claimedByUserId: "user-1",
        browserAnswerClaimToken: claimToken,
      },
      data: {
        status: "ringing",
        claimedByUserId: null,
        claimedAt: null,
        userId: null,
        browserAnswerClaimToken: null,
        browserAnswerClaimExpiresAt: null,
      },
    })
  })

  it("renews only the current claim token before it expires", async () => {
    const { PATCH } = await import("@/app/api/v1/calls/[id]/browser-answer/route")

    const response = await PATCH(request("PATCH"), context())

    expect(response.status).toBe(200)
    expect(mocks.callLogUpdateMany).toHaveBeenCalledWith({
      where: {
        id: callId,
        organizationId: "org-1",
        provider: "asterisk",
        direction: "inbound",
        callMode: "human",
        status: { in: ["ringing", "answering", "in-progress"] },
        endedAt: null,
        claimedByUserId: "user-1",
        userId: "user-1",
        browserAnswerClaimToken: claimToken,
        browserAnswerClaimExpiresAt: { gt: expect.any(Date) },
      },
      data: { browserAnswerClaimExpiresAt: expect.any(Date) },
    })
  })

  it("reports a stale renew or release token as lost", async () => {
    mocks.callLogUpdateMany.mockResolvedValue({ count: 0 })
    const { PATCH, DELETE } = await import("@/app/api/v1/calls/[id]/browser-answer/route")

    expect((await PATCH(request("PATCH"), context())).status).toBe(409)
    expect((await DELETE(request("DELETE"), context())).status).toBe(409)
  })

  it("is session-only because an API-key creator is not a live agent", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) => readFile(
      new URL("../app/api/v1/calls/[id]/browser-answer/route.ts", import.meta.url),
      "utf8",
    ))
    expect(source).toContain("withRlsSessionAuth")
    expect(source).toContain('checkPermission(role, "voip", "write")')
    expect(source).toContain("permissionDenied(auth.role)")
    expect(source).not.toContain("withRlsAuth(")
  })
})
