import { beforeEach, describe, expect, it, vi } from "vitest"
import { Prisma } from "@prisma/client"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => {
  const prisma = {
    lead: { findFirst: vi.fn() },
    channelConfig: { findFirst: vi.fn() },
    voiceCallSession: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    callLog: { create: vi.fn(), updateMany: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn<(operation: unknown) => Promise<unknown>>(),
  }
  prisma.$transaction.mockImplementation(async (operation: unknown) => {
    if (typeof operation === "function") return operation(prisma)
    return Promise.all(operation as Promise<unknown>[])
  })
  return {
    prisma,
    auth: { orgId: "org-1", userId: "user-1", role: "sales" },
    checkPermission: vi.fn(() => true),
    evaluatePolicy: vi.fn(),
    initiateCall: vi.fn(),
  }
})

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }))
vi.mock("@/lib/permissions", () => ({ checkPermission: mocks.checkPermission }))
vi.mock("@/lib/constants", () => ({
  isManagerOrAbove: (role: string) => ["manager", "admin", "superadmin"].includes(role),
}))
vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (
    _module: string,
    _action: string,
    handler: (request: NextRequest, auth: typeof mocks.auth, context: unknown) => Promise<Response>,
  ) => (
    request: NextRequest,
    context: unknown,
  ) => handler(request, mocks.auth, context),
}))
vi.mock("@/lib/voice-agent/manual-lead-call", () => ({
  evaluateManualLeadAiCallPolicy: mocks.evaluatePolicy,
  normalizeManualLeadPhone: (value: string | null | undefined) => (
    value ? { e164: "+994501234567", dialNumber: "994501234567" } : null
  ),
}))
vi.mock("@/lib/voip", () => ({
  getVoipProvider: () => ({ initiateCall: mocks.initiateCall }),
}))

import { GET, POST } from "@/app/api/v1/leads/[id]/ai-call/route"

const IDEMPOTENCY_KEY = "2a4dbd1b-fba4-4ca8-9831-cb35af9a3c54" // gitleaks:allow -- synthetic test/public display literal

function request(method: "GET" | "POST", body?: unknown, headers?: Record<string, string>) {
  return new NextRequest("http://localhost/api/v1/leads/lead-1/ai-call", {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

function context() {
  return { params: Promise.resolve({ id: "lead-1" }) }
}

function eligiblePolicy() {
  return {
    inaccessible: false,
    preflight: {
      eligible: true,
      blockers: [],
      requiresConsentConfirmation: true,
      limits: { userRemaining: 5, organizationRemaining: 20 },
      schedule: { timezone: "Asia/Baku", localTime: "10:00" },
    },
    lead: { id: "lead-1", assignedTo: "user-1", status: "new" },
    targetPhoneE164: "+994501234567",
    targetDialNumber: "994501234567",
    provider: {
      channelConfigId: "cfg-1",
      fromNumber: "100",
      settings: {
        provider: "asterisk",
        ariHost: "pbx.internal",
        ariPort: 8088,
        username: "ari",
        password: "secret",
        context: "outbound-routes",
        callerExtension: "100",
      },
    },
    consentBasis: "per_call_attestation_required",
    policySnapshot: { businessHoursOpen: true },
  }
}

async function json(response: Response) {
  return response.json() as Promise<{
    success?: boolean
    code?: string
    blockers?: string[]
    data?: Record<string, unknown>
  }>
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.VOICE_OUTBOUND_CALL_DISPATCH_PAUSED
  process.env.VOICE_AGENT_ORGANIZATION_ID = "org-1"
  Object.assign(mocks.auth, { orgId: "org-1", userId: "user-1", role: "sales" })
  mocks.checkPermission.mockReturnValue(true)
  mocks.prisma.lead.findFirst.mockResolvedValue({ id: "lead-1", phone: "+994501234567" })
  mocks.prisma.channelConfig.findFirst.mockResolvedValue({
    settings: { provider: "asterisk", outboundCallDispatchPaused: false },
  })
  mocks.prisma.$queryRaw.mockResolvedValue([
    { settings: { provider: "asterisk", outboundCallDispatchPaused: false } },
  ])
  mocks.prisma.$executeRaw.mockResolvedValue(1)
  mocks.prisma.voiceCallSession.findUnique.mockResolvedValue(null)
  mocks.prisma.voiceCallSession.create.mockResolvedValue({ id: "session-1" })
  mocks.prisma.voiceCallSession.updateMany.mockResolvedValue({ count: 1 })
  mocks.prisma.callLog.create.mockResolvedValue({ id: "call-log-1" })
  mocks.prisma.callLog.updateMany.mockResolvedValue({ count: 1 })
  mocks.prisma.$transaction.mockImplementation(async (operation: unknown) => {
    if (typeof operation === "function") return operation(mocks.prisma)
    return Promise.all(operation as Promise<unknown>[])
  })
  mocks.evaluatePolicy.mockResolvedValue(eligiblePolicy())
  mocks.initiateCall.mockResolvedValue({ success: false, error: "not exposed" })
})

describe("GET /api/v1/leads/:id/ai-call", () => {
  it("rejects bearer/API-key use before auth or policy evaluation", async () => {
    const response = await GET(request("GET", undefined, {
      authorization: "Bearer ld_example",
    }), context())
    expect(response.status).toBe(403)
    expect(mocks.evaluatePolicy).not.toHaveBeenCalled()
  })

  it("hides the endpoint outside the single runtime/callback pilot organization", async () => {
    process.env.VOICE_AGENT_ORGANIZATION_ID = "another-org"
    const response = await GET(request("GET"), context())
    expect(response.status).toBe(404)
    expect(mocks.evaluatePolicy).not.toHaveBeenCalled()
  })

  it("is a side-effect-free preflight with the exact public shape", async () => {
    const response = await GET(request("GET"), context())
    expect(response.status).toBe(200)
    expect(await json(response)).toEqual({
      success: true,
      data: eligiblePolicy().preflight,
    })
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    expect(mocks.initiateCall).not.toHaveBeenCalled()
  })

  it.each([
    ["voice_calling_hours_unconfigured"],
    ["outside_calling_hours"],
  ])("returns stable schedule blocker %s", async (blocker) => {
    mocks.evaluatePolicy.mockResolvedValue({
      ...eligiblePolicy(),
      preflight: {
        ...eligiblePolicy().preflight,
        eligible: false,
        blockers: [blocker],
      },
    })
    const response = await GET(request("GET"), context())
    expect((await json(response)).data?.blockers).toEqual([blocker])
  })
})

describe("POST /api/v1/leads/:id/ai-call", () => {
  const body = { idempotencyKey: IDEMPOTENCY_KEY, consentConfirmed: true }

  it("refuses AI dispatch while the PBX maintenance fence is active", async () => {
    process.env.VOICE_OUTBOUND_CALL_DISPATCH_PAUSED = "true"

    const response = await POST(request("POST", body), context())

    expect(response.status).toBe(503)
    expect(response.headers.get("retry-after")).toBe("60")
    expect((await json(response)).code).toBe("voice_outbound_dispatch_paused")
    expect(mocks.prisma.lead.findFirst).not.toHaveBeenCalled()
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    expect(mocks.initiateCall).not.toHaveBeenCalled()
  })

  it("honors the durable Asterisk pause before lead and phone locks", async () => {
    mocks.prisma.$queryRaw
      .mockResolvedValueOnce([
        { settings: { provider: "Asterisk", outboundCallDispatchPaused: true } },
      ])

    const response = await POST(request("POST", body), context())

    expect(response.status).toBe(503)
    expect((await json(response)).code).toBe("voice_outbound_dispatch_paused")
    expect(mocks.prisma.callLog.create).not.toHaveBeenCalled()
    expect(mocks.prisma.voiceCallSession.create).not.toHaveBeenCalled()
    expect(mocks.initiateCall).not.toHaveBeenCalled()
  })

  it("hides POST outside the single runtime/callback pilot organization", async () => {
    process.env.VOICE_AGENT_ORGANIZATION_ID = "another-org"
    const response = await POST(request("POST", body), context())
    expect(response.status).toBe(404)
    expect(mocks.prisma.lead.findFirst).not.toHaveBeenCalled()
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    expect(mocks.initiateCall).not.toHaveBeenCalled()
  })

  it("requires exact assignment for a custom non-manager and returns 404", async () => {
    Object.assign(mocks.auth, { role: "custom_sales" })
    mocks.prisma.lead.findFirst.mockResolvedValue(null)
    const response = await POST(request("POST", body), context())
    expect(response.status).toBe(404)
    expect(mocks.prisma.lead.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ assignedTo: "user-1" }),
    }))
    expect(mocks.initiateCall).not.toHaveBeenCalled()
  })

  it("allows manager-or-above access without an assignee predicate", async () => {
    Object.assign(mocks.auth, { role: "manager", userId: "manager-1" })
    mocks.prisma.voiceCallSession.findUnique.mockResolvedValue({
      id: "session-existing",
      leadId: "lead-1",
      requestedByUserId: "manager-1",
      callLogId: "call-existing",
      status: "dispatching",
    })
    const response = await POST(request("POST", body), context())
    expect(response.status).toBe(200)
    const where = mocks.prisma.lead.findFirst.mock.calls[0][0].where
    expect(where).not.toHaveProperty("assignedTo")
    expect((await json(response)).data?.replayed).toBe(true)
  })

  it("rejects body fields other than idempotencyKey and literal consentConfirmed=true", async () => {
    const response = await POST(request("POST", { ...body, toNumber: "+10000000000" }), context())
    expect(response.status).toBe(400)
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it("fails closed on an uncertain replay without provider redispatch", async () => {
    mocks.prisma.voiceCallSession.findUnique.mockResolvedValue({
      id: "session-existing",
      leadId: "lead-1",
      requestedByUserId: "user-1",
      callLogId: "call-existing",
      status: "dispatch_uncertain",
    })
    const response = await POST(request("POST", body), context())
    expect(response.status).toBe(503)
    expect(await json(response)).toEqual({
      success: false,
      code: "dispatch_uncertain",
      blockers: ["provider_unavailable"],
      replayed: true,
    })
    expect(mocks.initiateCall).not.toHaveBeenCalled()
  })

  it.each([
    ["failed", 502, "provider_failed", ["provider_unavailable"]],
    ["blocked", 409, "call_blocked", ["call_blocked"]],
    ["cancelled", 409, "call_cancelled", ["call_cancelled"]],
  ] as const)(
    "returns stored %s replay as a terminal error without redispatch",
    async (status, responseStatus, code, blockers) => {
      mocks.prisma.voiceCallSession.findUnique.mockResolvedValue({
        id: "session-existing",
        leadId: "lead-1",
        requestedByUserId: "user-1",
        callLogId: "call-existing",
        status,
      })

      const response = await POST(request("POST", body), context())

      expect(response.status).toBe(responseStatus)
      expect(await json(response)).toMatchObject({
        success: false,
        code,
        blockers: [...blockers],
        replayed: true,
      })
      expect(mocks.initiateCall).not.toHaveBeenCalled()
    },
  )

  it("maps a unique active-lead race to active_call_exists without dispatch", async () => {
    mocks.prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "6.19.3",
      }),
    )
    const response = await POST(request("POST", body), context())
    expect(response.status).toBe(409)
    expect(await json(response)).toMatchObject({
      success: false,
      code: "active_call_exists",
      blockers: ["active_call_exists"],
    })
    expect(mocks.initiateCall).not.toHaveBeenCalled()
  })

  it("keeps the active fence when provider dispatch is uncertain", async () => {
    mocks.initiateCall.mockResolvedValue({
      success: false,
      error: "uncertain",
      failureCertainty: "unknown_delivery",
    })
    const response = await POST(request("POST", body), context())
    expect(response.status).toBe(503)
    expect(await json(response)).toMatchObject({
      success: false,
      code: "provider_unavailable",
    })
    expect(mocks.initiateCall).toHaveBeenCalledWith(expect.objectContaining({
      toNumber: "994501234567",
      fromNumber: "100",
      voiceAgent: true,
      correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    }))
    const updateCalls = mocks.prisma.voiceCallSession.updateMany.mock.calls as Array<[
      { data?: Record<string, unknown> },
    ]>
    const uncertainUpdate = updateCalls.find(
      ([arg]) => arg.data?.status === "dispatch_uncertain",
    )?.[0]
    expect(uncertainUpdate).toBeDefined()
    expect(uncertainUpdate?.data).not.toHaveProperty("activeLeadKey")
    expect(uncertainUpdate?.data).not.toHaveProperty("leaseUntil")
  })

  it("closes both active fences after a definite provider rejection", async () => {
    mocks.initiateCall.mockResolvedValue({
      success: false,
      error: "rejected",
      failureCertainty: "definite_rejection",
    })

    const response = await POST(request("POST", body), context())

    expect(response.status).toBe(502)
    expect(await json(response)).toMatchObject({
      success: false,
      code: "provider_unavailable",
    })
    expect(mocks.initiateCall).toHaveBeenCalledTimes(1)
    expect(mocks.prisma.voiceCallSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "dispatching" }),
      data: expect.objectContaining({
        status: "failed",
        outcome: "failed",
        leaseUntil: null,
        activeOrganizationKey: null,
        activeLeadKey: null,
        activePhoneKey: null,
      }),
    }))
    expect(mocks.prisma.callLog.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "failed",
        providerOutcome: "failed",
        conversationOutcome: "failed",
        wasAnswered: false,
      }),
    }))
  })

  it("persists canonical policy/audit fields and accepts only matching correlation", async () => {
    mocks.initiateCall.mockImplementation(async (params: { correlationId: string }) => ({
      success: true,
      callSid: params.correlationId,
    }))
    const response = await POST(request("POST", body), context())
    expect(response.status).toBe(200)
    expect(await json(response)).toEqual({
      success: true,
      data: {
        sessionId: "session-1",
        callLogId: "call-log-1",
        status: "dispatching",
        replayed: false,
      },
    })
    expect(mocks.prisma.callLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        toNumber: "+994501234567",
        callMode: "ai",
        idempotencyKey: IDEMPOTENCY_KEY,
        consentAudit: expect.objectContaining({ consentConfirmed: true }),
      }),
    }))
    expect(mocks.prisma.voiceCallSession.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        activeOrganizationKey: "org-1",
        activeLeadKey: "lead-1",
        activePhoneKey: "+994501234567",
      }),
    }))
    expect(mocks.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    )
    expect(mocks.prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.prisma.$queryRaw.mock.invocationCallOrder[0],
    )
    expect(mocks.prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.prisma.$executeRaw.mock.invocationCallOrder[1],
    )
  })
})
