import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/* ─── Mocks ──────────────────────────────────────────────────────────── */

const mockInitiateCall = vi.fn()
const mockEndCall = vi.fn()
const mockCancelAndInspectCallFinality = vi.fn()
const mockTestConnection = vi.fn()

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    channelConfig: { findFirst: vi.fn(), findMany: vi.fn() },
    callLog: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    contact: { findFirst: vi.fn() },
    lead: { findMany: vi.fn() },
    socialConversation: { findFirst: vi.fn() },
    activity: { create: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    task: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    channelMessage: { updateMany: vi.fn() },
    voiceSuppression: { findFirst: vi.fn() },
    voiceConsent: { findFirst: vi.fn() },
    // The caller's own profile decides which phone rings on our side, so every
    // Asterisk manual call reads it. Absent from this mock, the route threw
    // before it ever dialled — which is what these tests were failing on.
    user: { findFirst: vi.fn() },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn(),
  requireAuth: vi.fn(),
  isAuthError: vi.fn((value: unknown) => value instanceof Response),
  orgHasModule: vi.fn().mockResolvedValue(true),
  moduleDisabledResponse: vi.fn(() => new Response("", { status: 403 })),
  // Read only when a browser call is asked for, so its default here is a
  // tenant that has NOT been switched on.
  getOrgModuleContext: vi.fn().mockResolvedValue({ modules: {} }),
}))

vi.mock("@/lib/voip", () => ({
  getVoipProvider: vi.fn(() => ({
    initiateCall: mockInitiateCall,
    endCall: mockEndCall,
    cancelAndInspectCallFinality: mockCancelAndInspectCallFinality,
    testConnection: mockTestConnection,
  })),
}))

vi.mock("@/lib/contact-events", () => ({
  trackContactEvent: vi.fn().mockResolvedValue(undefined),
}))

// Pass-through: ownership sanitize is unit-tested in lib-verify-owned-refs.test.ts.
vi.mock("@/lib/verify-owned-refs", () => ({
  sanitizeOwnedRefs: vi.fn(async (_o: string, r: any) => ({
    leadId: r.leadId || undefined,
    contactId: r.contactId || undefined,
    companyId: r.companyId || undefined,
    dealId: r.dealId || undefined,
    ticketId: r.ticketId || undefined,
    conversationId: r.conversationId || undefined,
  })),
}))

// 3CX webhook calls matchInboundLeadId on contact-less inbound (Slice 3b #1);
// stub it so the test doesn't hit un-mocked prisma.lead. Unit-tested in lib-inbound-lead-match.test.ts.
vi.mock("@/lib/inbound-lead-match", () => ({
  matchInboundLeadId: vi.fn(async () => undefined),
}))

import { POST as POST_CALL, GET as GET_CALLS } from "@/app/api/v1/calls/route"
import { PATCH as PATCH_DISPOSITION } from "@/app/api/v1/calls/[id]/disposition/route"
import { POST as POST_END } from "@/app/api/v1/calls/[id]/end/route"
import { PATCH as PATCH_NOTES } from "@/app/api/v1/calls/[id]/notes/route"
import { GET as GET_ACTIVE } from "@/app/api/v1/calls/active/route"
import { POST as POST_TEST } from "@/app/api/v1/calls/test/route"
import { POST as POST_TWIML } from "@/app/api/v1/calls/twiml/route"
import { POST as POST_WEBHOOK } from "@/app/api/v1/calls/webhook/route"
import { POST as POST_THREECX, GET as GET_THREECX } from "@/app/api/v1/calls/webhook/threecx/route"

import { prisma } from "@/lib/prisma"
import { getOrgId, getSession, orgHasModule, requireAuth, getOrgModuleContext } from "@/lib/api-auth"
import { readParkTicket } from "@/lib/voip/browser-softphone"
import { accessibleCallWhere } from "@/lib/calls/access"

function makeRequest(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  const headers = new Headers(init?.headers)
  if (init?.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json")
  }
  const parsedUrl = new URL(url, "http://localhost:3000")
  if (init?.method === "POST" && parsedUrl.pathname === "/api/v1/calls" && !headers.has("idempotency-key")) {
    headers.set("idempotency-key", "11111111-1111-4111-8111-111111111111")
  }
  return new NextRequest(parsedUrl, {
    ...init,
    headers,
  })
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function readyTwilioConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: "cfg_twilio",
    configName: "Twilio",
    phoneNumber: "+100",
    apiKey: "auth-token",
    settings: { provider: "twilio", accountSid: "AC123", twilioNumber: "+100" },
    isActive: true,
    ...overrides,
  }
}

function readyThreeCxConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: "cfg_3cx",
    configName: "3CX",
    phoneNumber: null,
    apiKey: "key",
    settings: { provider: "threecx", serverUrl: "https://pbx.example.com", extension: "101", apiKey: "key" },
    isActive: true,
    ...overrides,
  }
}

function readyAsteriskConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: "cfg_asterisk",
    configName: "Asterisk",
    phoneNumber: null,
    apiKey: null,
    settings: {
      provider: "asterisk",
      ariHost: "pbx.example.com",
      ariPort: 8088,
      username: "ari-user",
      password: "secret",
      context: "outbound-routes",
      callerExtension: "100",
      voiceAgentEnabled: true,
      voiceAgentMode: "outbound",
    },
    isActive: true,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.VOICE_OUTBOUND_CALL_DISPATCH_PAUSED
  vi.mocked(requireAuth).mockImplementation(async (request) => {
    const session = await getSession(request)
    if (!session?.orgId || !session?.userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) as any
    }
    return {
      orgId: session.orgId,
      userId: session.userId,
      role: session.role || "viewer",
      email: session.email || null,
      name: session.name || null,
    } as any
  })
  vi.mocked(orgHasModule).mockResolvedValue(true)
  vi.mocked(prisma.voiceSuppression.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.voiceConsent.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as never)
  vi.mocked(prisma.$queryRaw).mockResolvedValue([
    { settings: { provider: "asterisk", outboundCallDispatchPaused: false } },
  ] as never)
  vi.mocked(prisma.$transaction).mockImplementation(async (operation: any) => operation(prisma))
  vi.mocked(prisma.task.findMany).mockResolvedValue([] as never)
  // A salesperson who can be reached. Tests that care about the opposite say so.
  vi.mocked(prisma.user.findFirst).mockResolvedValue({
    phone: "+994501112233",
    verifiedPhone: null,
  } as never)
})

/* ─── POST /api/v1/calls (initiate call) ─────────────────────────────── */

describe("POST /api/v1/calls", () => {
  it("requires a strict client idempotency key before reading call configuration", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1" } as any)
    const res = await POST_CALL(new NextRequest("http://localhost:3000/api/v1/calls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "voip", toNumber: "+1234567" }),
    }))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: "valid_idempotency_key_required" })
    expect(prisma.channelConfig.findMany).not.toHaveBeenCalled()
    expect(mockInitiateCall).not.toHaveBeenCalled()
  })

  it("refuses provider dispatch while the PBX maintenance fence is active", async () => {
    process.env.VOICE_OUTBOUND_CALL_DISPATCH_PAUSED = "true"
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1" } as any)

    const res = await POST_CALL(
      makeRequest("/api/v1/calls", {
        method: "POST",
        body: JSON.stringify({ provider: "voip", toNumber: "+1234567" }),
      }),
    )

    expect(res.status).toBe(503)
    expect(res.headers.get("retry-after")).toBe("60")
    await expect(res.json()).resolves.toEqual({ error: "voice_outbound_dispatch_paused" })
    expect(prisma.channelConfig.findMany).not.toHaveBeenCalled()
    expect(mockInitiateCall).not.toHaveBeenCalled()
  })

  it("honors the durable Asterisk pause under the shared database lock", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1" } as any)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([readyAsteriskConfig()] as any)
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([
        { settings: { provider: "Asterisk", outboundCallDispatchPaused: true } },
      ] as never)

    const res = await POST_CALL(
      makeRequest("/api/v1/calls", {
        method: "POST",
        body: JSON.stringify({ provider: "voip", toNumber: "+1234567" }),
      }),
    )

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: "voice_outbound_dispatch_paused" })
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
    expect(prisma.callLog.create).not.toHaveBeenCalled()
    expect(mockInitiateCall).not.toHaveBeenCalled()
  })

  it("returns 401 when not authenticated", async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await POST_CALL(
      makeRequest("/api/v1/calls", { method: "POST", body: JSON.stringify({ toNumber: "+1234" }) }),
    )
    expect(res.status).toBe(401)
  })

  it("requires VoIP write permission before initiating any outbound call", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }) as any,
    )

    const res = await POST_CALL(
      makeRequest("/api/v1/calls", {
        method: "POST",
        body: JSON.stringify({ provider: "voip", toNumber: "+1234567" }),
      }),
    )

    expect(res.status).toBe(403)
    expect(requireAuth).toHaveBeenCalledWith(expect.any(NextRequest), "voip", "write")
    expect(prisma.channelConfig.findMany).not.toHaveBeenCalled()
    expect(mockInitiateCall).not.toHaveBeenCalled()
  })

  it("returns 400 when toNumber missing", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1" } as any)
    const res = await POST_CALL(
      makeRequest("/api/v1/calls", { method: "POST", body: JSON.stringify({}) }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 when VoIP not configured", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1" } as any)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([])
    const res = await POST_CALL(
      makeRequest("/api/v1/calls", { method: "POST", body: JSON.stringify({ provider: "voip", toNumber: "+1234567" }) }),
    )
    expect(res.status).toBe(400)
  })

  it("requires an explicit call provider before using the regular VoIP endpoint", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1" } as any)
    const res = await POST_CALL(
      makeRequest("/api/v1/calls", { method: "POST", body: JSON.stringify({ toNumber: "+1234" }) }),
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      error: "provider is required. Use provider=voip for regular phone calls. WhatsApp Calling uses /api/v1/calls/whatsapp/* actions.",
    })
    expect(prisma.channelConfig.findMany).not.toHaveBeenCalled()
  })

  it("initiates call and returns callLogId", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1" } as any)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([readyTwilioConfig()] as any)
    vi.mocked(prisma.callLog.create).mockResolvedValue({ id: "cl1" } as any)
    mockInitiateCall.mockResolvedValue({ success: true, callSid: "sid123" })
    vi.mocked(prisma.callLog.update).mockResolvedValue({} as any)

    const res = await POST_CALL(
      makeRequest("/api/v1/calls", { method: "POST", body: JSON.stringify({ provider: "voip", toNumber: "+1234567" }) }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.callLogId).toBe("cl1")
    expect(json.callSid).toBe("sid123")
  })

  it("replays the same human-call request without a second provider dispatch", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1" } as any)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([readyAsteriskConfig()] as any)
    vi.mocked(prisma.callLog.findFirst).mockResolvedValueOnce({
      id: "cl-existing",
      direction: "outbound",
      fromNumber: "100",
      toNumber: "+1234567",
      targetPhoneE164: "+1234567",
      status: "initiated",
      contactId: null,
      conversationId: null,
      leadId: null,
      companyId: null,
      dealId: null,
      ticketId: null,
      userId: "u1",
      provider: "asterisk",
      callSid: "9f5fa15c-a6f0-4f6f-af73-c5049e3d9de7",
      channelConfigId: "cfg_asterisk",
      callMode: "human",
      providerOutcome: null,
      conversationOutcome: null,
      endedAt: null,
    } as any)

    const res = await POST_CALL(makeRequest("/api/v1/calls", {
      method: "POST",
      body: JSON.stringify({ provider: "voip", toNumber: "+1234567" }),
    }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual(expect.objectContaining({
      success: true,
      callLogId: "cl-existing",
      replayed: true,
    }))
    expect(prisma.callLog.create).not.toHaveBeenCalled()
    expect(mockInitiateCall).not.toHaveBeenCalled()
  })

  it("rejects reuse of a human-call idempotency key with a changed destination", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1" } as any)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([readyAsteriskConfig()] as any)
    vi.mocked(prisma.callLog.findFirst).mockResolvedValueOnce({
      id: "cl-existing",
      direction: "outbound",
      fromNumber: "100",
      toNumber: "+7654321",
      targetPhoneE164: "+7654321",
      status: "initiated",
      contactId: null,
      conversationId: null,
      leadId: null,
      companyId: null,
      dealId: null,
      ticketId: null,
      userId: "u1",
      provider: "asterisk",
      callSid: "9f5fa15c-a6f0-4f6f-af73-c5049e3d9de7",
      channelConfigId: "cfg_asterisk",
      callMode: "human",
      providerOutcome: null,
      conversationOutcome: null,
      endedAt: null,
    } as any)

    const res = await POST_CALL(makeRequest("/api/v1/calls", {
      method: "POST",
      body: JSON.stringify({ provider: "voip", toNumber: "+1234567" }),
    }))

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: "idempotency_key_conflict" })
    expect(prisma.callLog.create).not.toHaveBeenCalled()
    expect(mockInitiateCall).not.toHaveBeenCalled()
  })

  it("blocks a new key while the same canonical destination has unresolved call truth", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1" } as any)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([readyAsteriskConfig()] as any)
    vi.mocked(prisma.callLog.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "cl-unresolved" } as any)

    const res = await POST_CALL(makeRequest("/api/v1/calls", {
      method: "POST",
      headers: { "Idempotency-Key": "22222222-2222-4222-8222-222222222222" },
      body: JSON.stringify({ provider: "voip", toNumber: "+1234567" }),
    }))

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: "active_voice_call_exists" })
    expect(prisma.callLog.findFirst).toHaveBeenLastCalledWith({
      where: {
        organizationId: "org1",
        direction: "outbound",
        targetPhoneE164: "+1234567",
        callMode: { in: ["human", "ai"] },
        providerOutcome: null,
        OR: [
          { endedAt: null },
          { conversationOutcome: "provider_unknown_no_redial" },
        ],
      },
      select: { id: true },
    })
    expect(prisma.callLog.create).not.toHaveBeenCalled()
    expect(mockInitiateCall).not.toHaveBeenCalled()
  })

  it("refuses an Asterisk call from a caller with no number, before the customer is dialled", async () => {
    // Measured on the PBX 2026-08-23: of 14 calls with both legs recorded, 2
    // were customer=ANSWERED / agent=NO ANSWER — the customer answered into
    // silence because the shared line nobody watches was substituted for the
    // caller's own phone. A refused click disturbs nobody; a silent
    // substitution disturbs a customer and hides itself.
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "sales" } as any)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([readyAsteriskConfig()] as any)
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ phone: null, verifiedPhone: null } as never)

    const res = await POST_CALL(
      makeRequest("/api/v1/calls", {
        method: "POST",
        body: JSON.stringify({ provider: "voip", toNumber: "+1234567" }),
      }),
    )

    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({ error: "agent_phone_required" })
    // Nothing was dialled and nothing was written: the customer's phone never rang.
    expect(mockInitiateCall).not.toHaveBeenCalled()
    expect(prisma.callLog.create).not.toHaveBeenCalled()
  })

  it("refuses a foreign profile number instead of routing the trunk to it", async () => {
    // A profile phone is self-service. Without this bound, pointing it at a
    // premium-rate line abroad and pressing "call" bills the company's trunk.
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "sales" } as any)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([readyAsteriskConfig()] as any)
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ phone: "+18005551234", verifiedPhone: null } as never)

    const res = await POST_CALL(
      makeRequest("/api/v1/calls", {
        method: "POST",
        body: JSON.stringify({ provider: "voip", toNumber: "+1234567" }),
      }),
    )

    expect(res.status).toBe(422)
    // A DIFFERENT code from the missing-number case: "you have none" and "yours
    // is not one we can dial" need different sentences, or the second is a dead
    // end — the profile form accepts any E.164.
    await expect(res.json()).resolves.toEqual({ error: "agent_phone_unsupported" })
    expect(mockInitiateCall).not.toHaveBeenCalled()
  })

  it("still tells every other provider which phone rings", async () => {
    // The refusal is asterisk-only, but the LOOKUP behind `agentLeg` is not:
    // gating the lookup on the provider made every Twilio reply claim the
    // shared line, which is how this change first turned an untouched test red.
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "sales" } as any)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([readyTwilioConfig()] as any)
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ phone: "+994501112233", verifiedPhone: null } as never)
    vi.mocked(prisma.callLog.create).mockResolvedValue({ id: "cl-twilio-own" } as any)
    mockInitiateCall.mockResolvedValue({ success: true, callSid: "sid-own" })
    vi.mocked(prisma.callLog.update).mockResolvedValue({} as any)

    const res = await POST_CALL(
      makeRequest("/api/v1/calls", {
        method: "POST",
        body: JSON.stringify({ provider: "voip", toNumber: "+1234567" }),
      }),
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual(expect.objectContaining({ agentLeg: "own" }))
  })

  it("refuses a browser call the tenant has not been switched on for", async () => {
    // Refusing beats quietly serving it as a phone call: a salesperson waiting
    // at a silent browser while a phone rings somewhere else is the very defect
    // this feature exists to remove.
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "sales" } as any)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([readyAsteriskConfig()] as any)

    const res = await POST_CALL(
      makeRequest("/api/v1/calls", {
        method: "POST",
        body: JSON.stringify({ provider: "voip", toNumber: "+1234567", browserAudio: true }),
      }),
    )

    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({ error: "browser_calls_unavailable" })
    expect(mockInitiateCall).not.toHaveBeenCalled()
    expect(prisma.callLog.create).not.toHaveBeenCalled()
  })

  it("bridges a switched-on browser call and needs no phone number for it", async () => {
    // The whole point is to work for people who have no company phone, so the
    // profile requirement that guards the second leg must not apply here —
    // there is no second leg to ring.
    process.env.BROWSER_SOFTPHONE_ENABLED = "1"
    process.env.BROWSER_SOFTPHONE_TICKET_SECRET = "s".repeat(48)
    process.env.SOFTPHONE_RELAY_URL = "wss://relay.example/browser"
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "sales" } as any)
    vi.mocked(getOrgModuleContext).mockResolvedValue({ modules: { browserSoftphone: true } } as any)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([readyAsteriskConfig()] as any)
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ phone: null, verifiedPhone: null } as never)
    vi.mocked(prisma.callLog.create).mockResolvedValue({ id: "cl-browser" } as any)
    mockInitiateCall.mockResolvedValue({ success: true, callSid: "sid-browser" })
    vi.mocked(prisma.callLog.update).mockResolvedValue({} as any)

    const res = await POST_CALL(
      makeRequest("/api/v1/calls", {
        method: "POST",
        body: JSON.stringify({ provider: "voip", toNumber: "+1234567", browserAudio: true }),
      }),
    )

    expect(res.status).toBe(200)
    expect(mockInitiateCall).toHaveBeenCalledWith(expect.objectContaining({ browserAudio: true }))
    const json = await res.json()
    expect(json.agentLeg).toBe("browser")
    // The ticket names this call and is what the relay will check.
    expect(typeof json.parkTicket).toBe("string")
    expect(readParkTicket(json.parkTicket)).toEqual(expect.objectContaining({
      orgId: "org1",
      userId: "u1",
      callLogId: "cl-browser",
    }))

    delete process.env.BROWSER_SOFTPHONE_ENABLED
    delete process.env.BROWSER_SOFTPHONE_TICKET_SECRET
    delete process.env.SOFTPHONE_RELAY_URL
  })

  it("will not dial a customer it cannot finish the call with", async () => {
    // Flags on, configuration half-done: no relay address to send the browser
    // to. Refuse BEFORE the phone rings — discovering this after the customer
    // has answered is the silence this feature exists to remove.
    process.env.BROWSER_SOFTPHONE_ENABLED = "1"
    process.env.BROWSER_SOFTPHONE_TICKET_SECRET = "s".repeat(48)
    delete process.env.SOFTPHONE_RELAY_URL
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "sales" } as any)
    vi.mocked(getOrgModuleContext).mockResolvedValue({ modules: { browserSoftphone: true } } as any)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([readyAsteriskConfig()] as any)

    const res = await POST_CALL(
      makeRequest("/api/v1/calls", {
        method: "POST",
        body: JSON.stringify({ provider: "voip", toNumber: "+1234567", browserAudio: true }),
      }),
    )

    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({ error: "browser_calls_unavailable" })
    expect(mockInitiateCall).not.toHaveBeenCalled()
    expect(prisma.callLog.create).not.toHaveBeenCalled()

    delete process.env.BROWSER_SOFTPHONE_ENABLED
    delete process.env.BROWSER_SOFTPHONE_TICKET_SECRET
  })

  it("leaves providers that do not ring a second leg of ours alone", async () => {
    // Twilio's click-to-call does not dial an agent leg through our trunk, so a
    // missing profile number cannot strand a customer there. Refusing it would
    // break a working flow for a defect it does not have.
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "sales" } as any)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([readyTwilioConfig()] as any)
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ phone: null, verifiedPhone: null } as never)
    vi.mocked(prisma.callLog.create).mockResolvedValue({ id: "cl-twilio" } as any)
    mockInitiateCall.mockResolvedValue({ success: true, callSid: "sid-twilio" })
    vi.mocked(prisma.callLog.update).mockResolvedValue({} as any)

    const res = await POST_CALL(
      makeRequest("/api/v1/calls", {
        method: "POST",
        body: JSON.stringify({ provider: "voip", toNumber: "+1234567" }),
      }),
    )

    expect(res.status).toBe(200)
    expect(mockInitiateCall).toHaveBeenCalled()
  })

  it("persists an ordinary Asterisk UUID before dispatch and passes its human mode to the provider", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "sales" } as any)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([readyAsteriskConfig()] as any)
    vi.mocked(prisma.callLog.create).mockResolvedValue({ id: "cl-human-asterisk" } as any)
    mockInitiateCall.mockResolvedValue({ success: true, callSid: "response-leg-id-must-not-replace-correlation" })
    vi.mocked(prisma.callLog.update).mockResolvedValue({} as any)

    const res = await POST_CALL(
      makeRequest("/api/v1/calls", {
        method: "POST",
        body: JSON.stringify({ provider: "voip", toNumber: "+1234567" }),
      }),
    )

    expect(res.status).toBe(200)
    const providerInput = mockInitiateCall.mock.calls[0]?.[0]
    expect(providerInput).toEqual(expect.objectContaining({
      voiceAgent: false,
      correlationId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
    }))
    const correlationId = providerInput.correlationId
    expect(prisma.callLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org1",
        provider: "asterisk",
        callMode: "human",
        callSid: correlationId,
        providerCallId: correlationId,
      }),
    })
    expect(vi.mocked(prisma.callLog.create).mock.invocationCallOrder[0]).toBeLessThan(
      mockInitiateCall.mock.invocationCallOrder[0],
    )
    expect(prisma.callLog.update).toHaveBeenCalledWith({
      where: { id: "cl-human-asterisk" },
      data: { callSid: correlationId, providerCallId: correlationId },
    })
    await expect(res.json()).resolves.toEqual(expect.objectContaining({
      success: true,
      callLogId: "cl-human-asterisk",
      callSid: correlationId,
      provider: "asterisk",
    }))
  })

  it("rejects AI voice calls on the generic click-to-call route", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1" } as any)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([readyAsteriskConfig()] as any)
    vi.mocked(prisma.callLog.create).mockResolvedValue({ id: "cl-ai" } as any)
    mockInitiateCall.mockResolvedValue({ success: true, callSid: "sid-ai" })
    vi.mocked(prisma.callLog.update).mockResolvedValue({} as any)

    const res = await POST_CALL(
      makeRequest("/api/v1/calls", {
        method: "POST",
        body: JSON.stringify({ provider: "voip", toNumber: "+1234", voiceAgent: true }),
      }),
    )

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: "manual_lead_ai_call_required" })
    expect(prisma.channelConfig.findMany).not.toHaveBeenCalled()
    expect(prisma.callLog.create).not.toHaveBeenCalled()
    expect(mockInitiateCall).not.toHaveBeenCalled()
  })

  it("fails closed when an outbound AI voice call is not enabled", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1" } as any)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([
      readyAsteriskConfig({
        settings: {
          provider: "asterisk",
          ariHost: "pbx.example.com",
          username: "ari-user",
          password: "secret",
          context: "outbound-routes",
          callerExtension: "100",
          voiceAgentEnabled: false,
          voiceAgentMode: "outbound",
        },
      }),
    ] as any)

    const res = await POST_CALL(
      makeRequest("/api/v1/calls", {
        method: "POST",
        body: JSON.stringify({ provider: "voip", toNumber: "+1234", voiceAgent: true }),
      }),
    )

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: "manual_lead_ai_call_required" })
    expect(prisma.channelConfig.findMany).not.toHaveBeenCalled()
    expect(prisma.callLog.create).not.toHaveBeenCalled()
    expect(mockInitiateCall).not.toHaveBeenCalled()
  })

  it("returns 400 before creating a call log when 3CX settings are incomplete", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1" } as any)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([
      readyThreeCxConfig({
        apiKey: "",
        settings: { provider: "threecx", serverUrl: "https://pbx.example.com", extension: "", apiKey: "" },
      }),
    ] as any)

    const res = await POST_CALL(
      makeRequest("/api/v1/calls", { method: "POST", body: JSON.stringify({ provider: "voip", toNumber: "+1234567" }) }),
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: "VoIP provider is not ready.",
      missingFields: ["Extension", "API Key"],
    })
    expect(prisma.callLog.create).not.toHaveBeenCalled()
  })

  it("stores the provider failure reason on the call log", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1" } as any)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([readyThreeCxConfig()] as any)
    vi.mocked(prisma.callLog.create).mockResolvedValue({ id: "cl1" } as any)
    mockInitiateCall.mockResolvedValue({ success: false, error: "3CX API error (403): Forbidden" })
    vi.mocked(prisma.callLog.updateMany).mockResolvedValue({ count: 1 } as never)

    const res = await POST_CALL(
      makeRequest("/api/v1/calls", { method: "POST", body: JSON.stringify({ provider: "voip", toNumber: "+1234567" }) }),
    )

    expect(res.status).toBe(500)
    expect(prisma.callLog.updateMany).toHaveBeenCalledWith({
      where: {
        id: "cl1",
        organizationId: "org1",
        providerOutcome: null,
        wasAnswered: false,
        endedAt: null,
      },
      data: expect.objectContaining({
        status: "failed",
        wasAnswered: false,
        providerOutcome: "failed",
        endedAt: expect.any(Date),
        notes: "[VoIP failure] threecx: 3CX API error (403): Forbidden",
      }),
    })
  })

  it("keeps an uncertain Asterisk dispatch non-terminal for a later PBX lifecycle result", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "sales" } as any)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([readyAsteriskConfig()] as any)
    vi.mocked(prisma.callLog.create).mockResolvedValue({ id: "cl-uncertain" } as any)
    mockInitiateCall.mockResolvedValue({
      success: false,
      error: "Asterisk request timed out",
      failureCertainty: "unknown_delivery",
    })
    vi.mocked(prisma.callLog.updateMany).mockResolvedValue({ count: 1 } as any)

    const response = await POST_CALL(
      makeRequest("/api/v1/calls", {
        method: "POST",
        body: JSON.stringify({ provider: "voip", toNumber: "+1234567" }),
      }),
    )

    expect(response.status).toBe(503)
    expect(prisma.callLog.updateMany).toHaveBeenCalledWith({
      where: {
        id: "cl-uncertain",
        organizationId: "org1",
        providerOutcome: null,
        wasAnswered: false,
        endedAt: null,
      },
      data: {
        notes: "[VoIP failure] asterisk: Asterisk request timed out",
      },
    })
  })

  it("cannot overwrite a fast PBX answer or terminal callback after dispatch failure", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "sales" } as any)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([readyAsteriskConfig()] as any)
    vi.mocked(prisma.callLog.create).mockResolvedValue({ id: "cl-fast-callback" } as any)
    mockInitiateCall.mockResolvedValue({
      success: false,
      error: "Asterisk rejected the request",
      failureCertainty: "definite_rejection",
    })
    // A lifecycle callback already changed wasAnswered/providerOutcome, so the
    // conditional failure write loses without corrupting the proven state.
    vi.mocked(prisma.callLog.updateMany).mockResolvedValue({ count: 0 } as any)

    const response = await POST_CALL(
      makeRequest("/api/v1/calls", {
        method: "POST",
        body: JSON.stringify({ provider: "voip", toNumber: "+1234567" }),
      }),
    )

    expect(response.status).toBe(500)
    expect(prisma.callLog.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "cl-fast-callback",
        providerOutcome: null,
        wasAnswered: false,
        endedAt: null,
      }),
    }))
    expect(prisma.callLog.update).not.toHaveBeenCalled()
  })

  it("persists a tenant-sanitized conversationId when call is initiated from an inbox conversation", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1" } as any)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([readyTwilioConfig()] as any)
    vi.mocked(prisma.callLog.create).mockResolvedValue({ id: "cl1" } as any)
    mockInitiateCall.mockResolvedValue({ success: true, callSid: "sid123" })
    vi.mocked(prisma.callLog.update).mockResolvedValue({} as any)

    const res = await POST_CALL(
      makeRequest("/api/v1/calls", {
        method: "POST",
        body: JSON.stringify({ provider: "voip", toNumber: "+1234567", conversationId: "sc_1" }),
      }),
    )
    expect(res.status).toBe(200)
    expect(prisma.callLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org1",
        conversationId: "sc_1",
      }),
    })
  })
})

/* ─── GET /api/v1/calls (history) ─────────────────────────────────────── */

describe("GET /api/v1/calls", () => {
  it("returns 401 when not authenticated", async () => {
    // withRls resolves session.orgId first; null both (clearAllMocks doesn't reset impls).
    vi.mocked(getSession).mockResolvedValue(null)
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await GET_CALLS(makeRequest("/api/v1/calls"))
    expect(res.status).toBe(401)
  })

  it("returns paginated call history", async () => {
    vi.mocked(getSession).mockResolvedValueOnce({ orgId: "org1", userId: "sales-1", role: "sales" } as any)
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(prisma.callLog.findMany).mockResolvedValue([{ id: "cl1" }] as any)
    vi.mocked(prisma.callLog.count).mockResolvedValue(1)
    const res = await GET_CALLS(makeRequest("/api/v1/calls?page=1&limit=10"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toHaveLength(1)
    expect(json.pagination.total).toBe(1)
    expect(prisma.callLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({
                OR: expect.arrayContaining([{ callMode: "ai", userId: "sales-1" }]),
              }),
            ]),
          }),
        ]),
      }),
    }))
  })

  it("filters call history by conversationId", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(prisma.callLog.findMany).mockResolvedValue([{ id: "cl1" }] as any)
    vi.mocked(prisma.callLog.count).mockResolvedValue(1)
    const res = await GET_CALLS(makeRequest("/api/v1/calls?conversationId=sc_1"))
    expect(res.status).toBe(200)
    expect(prisma.callLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: "org1", conversationId: "sc_1" }),
    }))
    expect(prisma.callLog.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ organizationId: "org1", conversationId: "sc_1" }),
    })
  })

  it("filters call history by provider and callSid for WhatsApp Calling smoke checks", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(prisma.callLog.findMany).mockResolvedValue(
      [{ id: "cl_wa", callSid: "wacid.test.1" }] as unknown as Awaited<ReturnType<typeof prisma.callLog.findMany>>,
    )
    vi.mocked(prisma.callLog.count).mockResolvedValue(1)

    const res = await GET_CALLS(makeRequest("/api/v1/calls?provider=whatsapp&callSid=wacid.test.1&limit=1"))

    expect(res.status).toBe(200)
    expect(prisma.callLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org1",
        provider: "whatsapp",
        callSid: "wacid.test.1",
      }),
      take: 1,
    }))
    expect(prisma.callLog.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        organizationId: "org1",
        provider: "whatsapp",
        callSid: "wacid.test.1",
      }),
    })
  })

  it("keeps the full CallLog row flowing to the client, minus the sanitized fields", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(prisma.callLog.findMany).mockResolvedValue([{
      id: "cl_fail",
      provider: "asterisk",
      status: "failed",
      providerOutcome: "failed",
      providerDialStatus: "CHANUNAVAIL",
      providerHangupCause: "1",
      recordingUrl: "https://provider.example/recording.mp3",
      leadCallClaimToken: "claim-token",
    }] as unknown as Awaited<ReturnType<typeof prisma.callLog.findMany>>)
    vi.mocked(prisma.callLog.count).mockResolvedValue(1)

    const res = await GET_CALLS(makeRequest("/api/v1/calls?limit=1"))

    expect(res.status).toBe(200)
    const json = await res.json()
    // support/voip and the inbox side panel render dial diagnostics from
    // whole-row fields this route returns via `include` with no `select`.
    // Narrowing it to a select list would blank providerDialStatus /
    // providerHangupCause on every card with no compile-time signal — this
    // test is the tripwire.
    const [findManyArgs] = vi.mocked(prisma.callLog.findMany).mock.calls.at(-1)!
    expect(findManyArgs).not.toHaveProperty("select")
    expect(json.data[0]).toMatchObject({
      provider: "asterisk",
      providerOutcome: "failed",
      providerDialStatus: "CHANUNAVAIL",
      providerHangupCause: "1",
    })
    // Full row does not mean unsanitized: the provider URL and the claim
    // token still never reach the browser.
    expect(json.data[0]).not.toHaveProperty("recordingUrl")
    expect(json.data[0]).not.toHaveProperty("leadCallClaimToken")
    expect(json.data[0].hasRecording).toBe(true)
  })

  it("resolves an exact journal deep-link through the same tenant and call-access predicates", async () => {
    vi.mocked(getSession).mockResolvedValueOnce({
      orgId: "org1",
      userId: "sales-1",
      role: "sales",
    } as any)
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(prisma.callLog.findMany).mockResolvedValue([{
      id: "call/unsafe",
      callMode: "human",
      userId: "sales-1",
      transcription: "Customer said <script>alert(1)</script>",
      recordingUrl: "https://provider.example/private.wav",
    }] as unknown as Awaited<ReturnType<typeof prisma.callLog.findMany>>)
    vi.mocked(prisma.callLog.count).mockResolvedValue(1)

    const res = await GET_CALLS(makeRequest("/api/v1/calls?id=call%2Funsafe&limit=1"))

    expect(res.status).toBe(200)
    const expectedWhere = {
      organizationId: "org1",
      id: "call/unsafe",
      AND: [accessibleCallWhere("sales", "sales-1")],
    }
    expect(prisma.callLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expectedWhere,
      take: 1,
    }))
    expect(prisma.callLog.count).toHaveBeenCalledWith({ where: expectedWhere })

    const json = await res.json()
    expect(json.data).toHaveLength(1)
    expect(json.data[0]).toMatchObject({
      id: "call/unsafe",
      transcription: "Customer said <script>alert(1)</script>",
      hasRecording: true,
      recordingPlaybackUrl: "/api/v1/calls/call%2Funsafe/recording",
    })
    expect(json.data[0]).not.toHaveProperty("recordingUrl")
  })
})

/* ─── PATCH /api/v1/calls/[id]/disposition ────────────────────────────── */

describe("PATCH /api/v1/calls/[id]/disposition", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockResolvedValue({
      orgId: "org1",
      userId: "sales-1",
      role: "sales",
    } as never)
  })

  it("returns 401 when not authenticated", async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await PATCH_DISPOSITION(
      makeRequest("/api/v1/calls/cl1/disposition", { method: "PATCH", body: JSON.stringify({ disposition: "interested" }) }),
      makeParams("cl1") as never,
    )
    expect(res.status).toBe(401)
  })

  it("requires voip write permission before changing a call outcome", async () => {
    vi.mocked(getSession).mockResolvedValue({
      orgId: "org1",
      userId: "viewer-1",
      role: "viewer",
    } as never)
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(requireAuth).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }) as never,
    )
    vi.mocked(prisma.callLog.updateMany).mockResolvedValue({ count: 1 } as never)

    const res = await PATCH_DISPOSITION(
      makeRequest("/api/v1/calls/cl1/disposition", {
        method: "PATCH",
        body: JSON.stringify({ disposition: "interested" }),
      }),
      makeParams("cl1") as never,
    )

    expect(res.status).toBe(403)
    expect(requireAuth).toHaveBeenCalledWith(expect.any(NextRequest), "voip", "write")
    expect(prisma.callLog.updateMany).not.toHaveBeenCalled()
  })

  it("does not let a salesperson change another seller's manual call outcome", async () => {
    vi.mocked(prisma.callLog.updateMany).mockImplementationOnce(async (args) => ({
      // Model a stored manual call owned by sales-2. With no userId predicate
      // the update matches it; with the required sales-1 predicate it does not.
      count: !args.where?.userId || args.where.userId === "sales-2" ? 1 : 0,
    }))

    const res = await PATCH_DISPOSITION(
      makeRequest("/api/v1/calls/call-sales-2/disposition", {
        method: "PATCH",
        body: JSON.stringify({ disposition: "interested" }),
      }),
      makeParams("call-sales-2") as never,
    )

    expect(res.status).toBe(404)
    expect(prisma.activity.deleteMany).not.toHaveBeenCalled()
    expect(prisma.activity.upsert).not.toHaveBeenCalled()
  })

  it("does not let the human outcome endpoint label an AI call", async () => {
    vi.mocked(prisma.callLog.updateMany).mockImplementationOnce(async (args) => ({
      // Model an AI call with this id. An unconstrained update reaches it; a
      // human-only update correctly leaves the AI analysis as the sole writer.
      count: args.where?.callMode === "human" ? 0 : 1,
    }))

    const res = await PATCH_DISPOSITION(
      makeRequest("/api/v1/calls/ai-call/disposition", {
        method: "PATCH",
        body: JSON.stringify({ disposition: "interested" }),
      }),
      makeParams("ai-call") as never,
    )

    expect(res.status).toBe(404)
    expect(prisma.callLog.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ callMode: "human" }),
    }))
    expect(prisma.activity.upsert).not.toHaveBeenCalled()
    expect(prisma.activity.deleteMany).not.toHaveBeenCalled()
  })

  it("returns 400 for invalid disposition", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    const res = await PATCH_DISPOSITION(
      makeRequest("/api/v1/calls/cl1/disposition", { method: "PATCH", body: JSON.stringify({ disposition: "invalid" }) }),
      makeParams("cl1") as any,
    )
    expect(res.status).toBe(400)
  })

  it("updates disposition successfully", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(prisma.callLog.updateMany).mockResolvedValue({ count: 1 } as never)
    const res = await PATCH_DISPOSITION(
      makeRequest("/api/v1/calls/cl1/disposition", { method: "PATCH", body: JSON.stringify({ disposition: "interested" }) }),
      makeParams("cl1") as never,
    )
    expect(res.status).toBe(200)
  })

  it("requires an exact time for a callback outcome", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(prisma.callLog.updateMany).mockResolvedValue({ count: 1 } as never)

    const res = await PATCH_DISPOSITION(
      makeRequest("/api/v1/calls/cl1/disposition", {
        method: "PATCH",
        body: JSON.stringify({ disposition: "callback" }),
      }),
      makeParams("cl1") as never,
    )

    expect(res.status).toBe(400)
    expect(prisma.callLog.updateMany).not.toHaveBeenCalled()
  })

  it("rejects a callback time that is already past", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(prisma.callLog.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await PATCH_DISPOSITION(
      makeRequest("/api/v1/calls/cl1/disposition", {
        method: "PATCH",
        body: JSON.stringify({
          disposition: "callback",
          callbackAt: new Date(Date.now() - 86_400_000).toISOString(),
        }),
      }),
      makeParams("cl1") as any,
    )

    expect(res.status).toBe(400)
    expect(prisma.callLog.updateMany).not.toHaveBeenCalled()
  })

  it("does not accept callback time on another disposition", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(prisma.callLog.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await PATCH_DISPOSITION(
      makeRequest("/api/v1/calls/cl1/disposition", {
        method: "PATCH",
        body: JSON.stringify({
          disposition: "interested",
          callbackAt: new Date(Date.now() + 86_400_000).toISOString(),
        }),
      }),
      makeParams("cl1") as any,
    )

    expect(res.status).toBe(400)
    expect(prisma.callLog.updateMany).not.toHaveBeenCalled()
  })

  it("stores the disposition and scheduled lead activity in one transaction", async () => {
    const callbackAt = new Date(Date.now() + 86_400_000).toISOString()
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "sales-1", role: "sales" } as never)
    vi.mocked(prisma.callLog.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({
      id: "cl1",
      leadId: "lead1",
      contactId: null,
      companyId: null,
      dealId: null,
      ticketId: null,
      conversationId: null,
      userId: "sales-1",
    } as never)
    vi.mocked(prisma.activity.upsert).mockResolvedValue({ id: "call_callback_cl1" } as never)

    const res = await PATCH_DISPOSITION(
      makeRequest("/api/v1/calls/cl1/disposition", {
        method: "PATCH",
        body: JSON.stringify({ disposition: "callback", callbackAt }),
      }),
      makeParams("cl1") as never,
    )

    expect(res.status).toBe(200)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.callLog.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "cl1", organizationId: "org1" }),
      data: { disposition: "callback" },
    }))
    expect(prisma.activity.upsert).toHaveBeenCalledWith({
      where: { id: "call_callback_cl1" },
      create: expect.objectContaining({
        id: "call_callback_cl1",
        organizationId: "org1",
        type: "task",
        relatedType: "lead",
        relatedId: "lead1",
        scheduledAt: new Date(callbackAt),
      }),
      update: expect.objectContaining({
        scheduledAt: new Date(callbackAt),
      }),
    })
  })

  it("reuses the same callback activity on a lost-response retry", async () => {
    const callbackAt = new Date(Date.now() + 86_400_000).toISOString()
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "sales-1", role: "sales" } as never)
    vi.mocked(prisma.callLog.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({
      id: "cl1",
      leadId: "lead1",
      contactId: null,
      companyId: null,
      dealId: null,
      ticketId: null,
      conversationId: null,
      userId: "sales-1",
    } as never)
    vi.mocked(prisma.activity.upsert).mockResolvedValue({ id: "call_callback_cl1" } as never)

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = await PATCH_DISPOSITION(
        makeRequest("/api/v1/calls/cl1/disposition", {
          method: "PATCH",
          body: JSON.stringify({ disposition: "callback", callbackAt }),
        }),
        makeParams("cl1") as never,
      )
      expect(res.status).toBe(200)
    }

    const activityIds = vi.mocked(prisma.activity.upsert).mock.calls.map(([args]) => args.where.id)
    expect(activityIds).toEqual(["call_callback_cl1", "call_callback_cl1"])
  })

  it("files a deterministic task for the installed callback reminder", async () => {
    const callbackAt = new Date(Date.now() + 86_400_000).toISOString()
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "sales-1", role: "sales" } as never)
    const txCallLogUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
    const txCallLogFindFirst = vi.fn().mockResolvedValue({
      id: "cl1",
      leadId: "lead1",
      contactId: null,
      companyId: null,
      dealId: null,
      ticketId: null,
      conversationId: null,
      userId: "sales-1",
    })
    const txActivityUpsert = vi.fn().mockResolvedValue({ id: "call_callback_cl1" })
    const txTaskUpsert = vi.fn().mockResolvedValue({ id: "call_callback_cl1" })
    const txTaskFindMany = vi.fn().mockResolvedValue([])
    const txTaskUpdateMany = vi.fn().mockResolvedValue({ count: 0 })
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (operation: any) => operation({
      callLog: { updateMany: txCallLogUpdateMany, findFirst: txCallLogFindFirst },
      activity: { upsert: txActivityUpsert },
      task: {
        findMany: txTaskFindMany,
        upsert: txTaskUpsert,
        updateMany: txTaskUpdateMany,
      },
    }))

    const res = await PATCH_DISPOSITION(
      makeRequest("/api/v1/calls/cl1/disposition", {
        method: "PATCH",
        body: JSON.stringify({ disposition: "callback", callbackAt }),
      }),
      makeParams("cl1") as never,
    )

    expect(res.status).toBe(200)
    expect(txTaskUpsert).toHaveBeenCalledWith({
      where: { id: "call_callback_cl1" },
      create: expect.objectContaining({
        id: "call_callback_cl1",
        organizationId: "org1",
        title: "Callback",
        dueDate: new Date(callbackAt),
        assignedTo: "sales-1",
        relatedType: "lead",
        relatedId: "lead1",
        createdBy: "sales-1",
        customFields: {
          commitmentCallId: "cl1",
          callbackSource: "manual-disposition",
        },
      }),
      update: expect.objectContaining({
        dueDate: new Date(callbackAt),
        status: "pending",
        completedAt: null,
      }),
    })
    const retryUpdate = txTaskUpsert.mock.calls[0][0].update
    for (const preserved of ["title", "assignedTo", "relatedType", "relatedId", "customFields"]) {
      expect(retryUpdate).not.toHaveProperty(preserved)
    }
    expect(prisma.task.upsert).not.toHaveBeenCalled()
  })

  it("removes the scheduled promise when callback is corrected to another outcome", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(prisma.callLog.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.activity.deleteMany).mockResolvedValue({ count: 1 } as never)

    const res = await PATCH_DISPOSITION(
      makeRequest("/api/v1/calls/cl1/disposition", {
        method: "PATCH",
        body: JSON.stringify({ disposition: "interested" }),
      }),
      makeParams("cl1") as never,
    )

    expect(res.status).toBe(200)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.activity.deleteMany).toHaveBeenCalledWith({
      where: { id: "call_callback_cl1", organizationId: "org1" },
    })
  })

  it("soft-cancels the reminder without cascading away its task history", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    const txCallLogUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
    const txActivityDeleteMany = vi.fn().mockResolvedValue({ count: 1 })
    const txTaskDelete = vi.fn().mockResolvedValue({ id: "call_callback_cl1" })
    const txTaskDeleteMany = vi.fn().mockResolvedValue({ count: 1 })
    const txTaskUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (operation: any) => operation({
      callLog: { updateMany: txCallLogUpdateMany },
      activity: { deleteMany: txActivityDeleteMany },
      task: {
        delete: txTaskDelete,
        deleteMany: txTaskDeleteMany,
        updateMany: txTaskUpdateMany,
      },
    }))

    const res = await PATCH_DISPOSITION(
      makeRequest("/api/v1/calls/cl1/disposition", {
        method: "PATCH",
        body: JSON.stringify({ disposition: "interested" }),
      }),
      makeParams("cl1") as never,
    )

    expect(res.status).toBe(200)
    expect(txTaskDelete).not.toHaveBeenCalled()
    expect(txTaskDeleteMany).not.toHaveBeenCalled()
    expect(txTaskUpdateMany).toHaveBeenCalledTimes(1)
    expect(txTaskUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ organizationId: "org1" }),
      data: expect.objectContaining({
        status: "cancelled",
        deletedAt: expect.any(Date),
      }),
    })
    const cancellation = txTaskUpdateMany.mock.calls[0][0].data
    // Even a task somebody already marked done/cancelled must leave the active
    // callback report when the call outcome itself is corrected.
    expect(txTaskUpdateMany.mock.calls[0][0].where).not.toHaveProperty("status")
    for (const preserved of ["title", "assignedTo", "relatedType", "relatedId", "customFields"]) {
      expect(cancellation).not.toHaveProperty(preserved)
    }
    expect(prisma.task.deleteMany).not.toHaveBeenCalled()
  })

  it("reschedules the existing task without erasing its owner or custom fields", async () => {
    const callbackAt = new Date(Date.now() + 86_400_000).toISOString()
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "sales-1", role: "sales" } as never)
    const txCallLogUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
    const txCallLogFindFirst = vi.fn().mockResolvedValue({
      id: "cl1",
      leadId: "lead1",
      contactId: null,
      companyId: null,
      dealId: null,
      ticketId: null,
      conversationId: null,
      userId: "sales-1",
    })
    const existingUpdatedAt = new Date("2026-08-27T04:00:00.000Z")
    const txTaskFindMany = vi.fn().mockResolvedValue([{
      id: "call_callback_cl1",
      updatedAt: existingUpdatedAt,
      customFields: {
        commitmentCallId: "cl1",
        callbackSource: "manual-disposition",
        brand: "VIP",
        requiredCode: "R1",
        overdueNotifiedAt: "2026-08-27T03:00:00.000Z",
        escalatedAt: "2026-08-27T03:45:00.000Z",
      },
    }])
    const txTaskUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
    const txTaskUpsert = vi.fn()
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (operation: any) => operation({
      callLog: { updateMany: txCallLogUpdateMany, findFirst: txCallLogFindFirst },
      activity: { upsert: vi.fn().mockResolvedValue({ id: "call_callback_cl1" }) },
      task: {
        findMany: txTaskFindMany,
        updateMany: txTaskUpdateMany,
        upsert: txTaskUpsert,
      },
    }))

    const res = await PATCH_DISPOSITION(
      makeRequest("/api/v1/calls/cl1/disposition", {
        method: "PATCH",
        body: JSON.stringify({ disposition: "callback", callbackAt }),
      }),
      makeParams("cl1") as never,
    )

    expect(res.status).toBe(200)
    expect(txTaskUpsert).not.toHaveBeenCalled()
    expect(txTaskUpdateMany).toHaveBeenCalledTimes(1)
    const [{ where, data }] = txTaskUpdateMany.mock.calls[0]
    expect(where).toEqual({
      id: "call_callback_cl1",
      organizationId: "org1",
      updatedAt: existingUpdatedAt,
    })
    expect(data).toMatchObject({
      dueDate: new Date(callbackAt),
      status: "pending",
      completedAt: null,
      deletedAt: null,
      customFields: {
        commitmentCallId: "cl1",
        callbackSource: "manual-disposition",
        brand: "VIP",
        requiredCode: "R1",
      },
    })
    expect(data).not.toHaveProperty("title")
    expect(data).not.toHaveProperty("assignedTo")
    expect(data).not.toHaveProperty("relatedType")
    expect(data).not.toHaveProperty("relatedId")
    expect(data.customFields).not.toHaveProperty("overdueNotifiedAt")
    expect(data.customFields).not.toHaveProperty("escalatedAt")
  })

  it("reuses a legacy AI commitment task instead of creating a second callback", async () => {
    const callbackAt = new Date(Date.now() + 86_400_000).toISOString()
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "sales-1", role: "sales" } as never)
    const txTaskFindMany = vi.fn().mockResolvedValue([{
      id: "legacy-ai-task",
      updatedAt: new Date("2026-08-27T04:00:00.000Z"),
      customFields: {
        commitmentCallId: "cl1",
        commitmentStatedByCustomer: true,
        brand: "VIP",
      },
    }])
    const txTaskUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
    const txTaskUpsert = vi.fn()
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (operation: any) => operation({
      callLog: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst: vi.fn().mockResolvedValue({
          id: "cl1",
          leadId: "lead1",
          contactId: null,
          companyId: null,
          dealId: null,
          ticketId: null,
          conversationId: null,
          userId: "sales-1",
        }),
      },
      activity: { upsert: vi.fn().mockResolvedValue({ id: "call_callback_cl1" }) },
      task: {
        findMany: txTaskFindMany,
        updateMany: txTaskUpdateMany,
        upsert: txTaskUpsert,
      },
    }))

    const res = await PATCH_DISPOSITION(
      makeRequest("/api/v1/calls/cl1/disposition", {
        method: "PATCH",
        body: JSON.stringify({ disposition: "callback", callbackAt }),
      }),
      makeParams("cl1") as never,
    )

    expect(res.status).toBe(200)
    expect(txTaskUpsert).not.toHaveBeenCalled()
    expect(txTaskUpdateMany).toHaveBeenCalledTimes(1)
    const [{ where, data }] = txTaskUpdateMany.mock.calls[0]
    expect(where).toMatchObject({ id: "legacy-ai-task", organizationId: "org1" })
    expect(data.dueDate).toEqual(new Date(callbackAt))
    expect(data.customFields).toEqual({
      commitmentCallId: "cl1",
      commitmentStatedByCustomer: true,
      brand: "VIP",
      callbackSource: "manual-disposition",
    })
  })

  it("creates no activity when the ownership-scoped call update finds nothing", async () => {
    const callbackAt = new Date(Date.now() + 86_400_000).toISOString()
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(prisma.callLog.updateMany).mockResolvedValue({ count: 0 } as never)

    const res = await PATCH_DISPOSITION(
      makeRequest("/api/v1/calls/cl1/disposition", {
        method: "PATCH",
        body: JSON.stringify({ disposition: "callback", callbackAt }),
      }),
      makeParams("cl1") as never,
    )

    expect(res.status).toBe(404)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.activity.upsert).not.toHaveBeenCalled()
    expect(prisma.task.upsert).not.toHaveBeenCalled()
    expect(prisma.task.deleteMany).not.toHaveBeenCalled()
  })
})

/* ─── POST /api/v1/calls/[id]/end ─────────────────────────────────────── */

describe("POST /api/v1/calls/[id]/end", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    const res = await POST_END(
      makeRequest("/api/v1/calls/cl1/end", { method: "POST" }),
      makeParams("cl1") as any,
    )
    expect(res.status).toBe(401)
  })

  it("returns 404 when call not found", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "sales-1", role: "sales" } as any)
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue(null)
    const res = await POST_END(
      makeRequest("/api/v1/calls/cl1/end", { method: "POST" }),
      makeParams("cl1") as any,
    )
    expect(res.status).toBe(404)
  })

  it("ends call via provider", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "sales-1", role: "sales" } as any)
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({ id: "cl1", callSid: "sid1" } as any)
    vi.mocked(prisma.channelConfig.findFirst).mockResolvedValue({
      settings: { provider: "twilio" },
    } as any)
    mockEndCall.mockResolvedValue({ success: true })
    vi.mocked(prisma.callLog.update).mockResolvedValue({} as any)
    const res = await POST_END(
      makeRequest("/api/v1/calls/cl1/end", { method: "POST" }),
      makeParams("cl1") as any,
    )
    expect(res.status).toBe(200)
  })

  it("does not bypass the correlated lifecycle when ending an AI call", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "sales-1", role: "sales" } as any)
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({
      id: "cl-ai",
      callSid: "sid-ai",
      callMode: "ai",
      userId: "sales-1",
    } as any)

    const res = await POST_END(
      makeRequest("/api/v1/calls/cl-ai/end", { method: "POST" }),
      makeParams("cl-ai") as any,
    )

    expect(res.status).toBe(409)
    expect(mockEndCall).not.toHaveBeenCalled()
  })

  it("installs a durable PBX cancellation tombstone before a registry channel exists", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "sales-1", role: "sales" } as any)
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({
      id: "cl-human",
      callSid: "9f5fa15c-a6f0-4f6f-af73-c5049e3d9de7",
      callMode: "human",
      provider: "asterisk",
    } as any)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([
      readyAsteriskConfig({
        settings: {
          ...readyAsteriskConfig().settings,
          voiceAttemptRegistryEnabled: true,
        },
      }),
    ] as any)
    mockCancelAndInspectCallFinality.mockResolvedValue({
      state: "not_accepted",
      revision: 2,
      updatedAt: "2026-08-10T08:00:00.000Z",
    })
    vi.mocked(prisma.callLog.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await POST_END(
      makeRequest("/api/v1/calls/cl-human/end", { method: "POST" }),
      makeParams("cl-human") as any,
    )

    expect(res.status).toBe(200)
    expect(mockCancelAndInspectCallFinality).toHaveBeenCalledTimes(1)
    expect(mockEndCall).not.toHaveBeenCalled()
    expect(prisma.callLog.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "cl-human",
        providerOutcome: null,
        wasAnswered: false,
        endedAt: null,
      },
      data: expect.objectContaining({
        status: "canceled",
        providerOutcome: "cancelled",
        wasAnswered: false,
        duration: 0,
      }),
    }))
  })

  it("keeps CRM open while the PBX cancellation is accepted but not terminal", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "sales-1", role: "sales" } as any)
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({
      id: "cl-human",
      callSid: "9f5fa15c-a6f0-4f6f-af73-c5049e3d9de7",
      callMode: "human",
      provider: "asterisk",
    } as any)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([
      readyAsteriskConfig({
        settings: {
          ...readyAsteriskConfig().settings,
          voiceAttemptRegistryEnabled: true,
        },
      }),
    ] as any)
    mockCancelAndInspectCallFinality.mockResolvedValue({
      state: "accepted",
      revision: 3,
      updatedAt: "2026-08-10T08:00:00.000Z",
    })

    const res = await POST_END(
      makeRequest("/api/v1/calls/cl-human/end", { method: "POST" }),
      makeParams("cl-human") as any,
    )

    expect(res.status).toBe(202)
    expect(prisma.callLog.update).not.toHaveBeenCalled()
    expect(prisma.callLog.updateMany).not.toHaveBeenCalled()
    expect(mockEndCall).not.toHaveBeenCalled()
  })

  it("waits for the authoritative lifecycle callback after a terminal registry result", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "sales-1", role: "sales" } as any)
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({
      id: "cl-human",
      callSid: "9f5fa15c-a6f0-4f6f-af73-c5049e3d9de7",
      callMode: "human",
      provider: "asterisk",
    } as any)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([
      readyAsteriskConfig({
        settings: {
          ...readyAsteriskConfig().settings,
          voiceAttemptRegistryEnabled: true,
        },
      }),
    ] as any)
    mockCancelAndInspectCallFinality.mockResolvedValue({
      state: "terminal",
      outcome: "cancelled",
      revision: 4,
      updatedAt: "2026-08-10T08:00:00.000Z",
    })

    const res = await POST_END(
      makeRequest("/api/v1/calls/cl-human/end", { method: "POST" }),
      makeParams("cl-human") as any,
    )

    expect(res.status).toBe(202)
    expect(prisma.callLog.updateMany).not.toHaveBeenCalled()
  })

  it("does not close a registry call when cancellation finality is unknown", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "sales-1", role: "sales" } as any)
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({
      id: "cl-human",
      callSid: "9f5fa15c-a6f0-4f6f-af73-c5049e3d9de7",
      callMode: "human",
      provider: "asterisk",
    } as any)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([
      readyAsteriskConfig({
        settings: {
          ...readyAsteriskConfig().settings,
          voiceAttemptRegistryEnabled: true,
        },
      }),
    ] as any)
    mockCancelAndInspectCallFinality.mockResolvedValue({ state: "unknown" })

    const res = await POST_END(
      makeRequest("/api/v1/calls/cl-human/end", { method: "POST" }),
      makeParams("cl-human") as any,
    )

    expect(res.status).toBe(503)
    expect(prisma.callLog.update).not.toHaveBeenCalled()
    expect(prisma.callLog.updateMany).not.toHaveBeenCalled()
  })

  it("rejects a caller without voip write permission before reading the call", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }) as any,
    )

    const res = await POST_END(
      makeRequest("/api/v1/calls/cl-human/end", { method: "POST" }),
      makeParams("cl-human") as any,
    )

    expect(res.status).toBe(403)
    expect(prisma.callLog.findFirst).not.toHaveBeenCalled()
    expect(mockEndCall).not.toHaveBeenCalled()
    expect(mockCancelAndInspectCallFinality).not.toHaveBeenCalled()
  })
})

/* ─── PATCH /api/v1/calls/[id]/notes ──────────────────────────────────── */

describe("PATCH /api/v1/calls/[id]/notes", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await PATCH_NOTES(
      makeRequest("/api/v1/calls/cl1/notes", { method: "PATCH", body: JSON.stringify({ notes: "test" }) }),
      makeParams("cl1") as any,
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 when notes is not a string", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    const res = await PATCH_NOTES(
      makeRequest("/api/v1/calls/cl1/notes", { method: "PATCH", body: JSON.stringify({ notes: 123 }) }),
      makeParams("cl1") as any,
    )
    expect(res.status).toBe(400)
  })

  it("returns 404 when call not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(prisma.callLog.updateMany).mockResolvedValue({ count: 0 } as any)
    const res = await PATCH_NOTES(
      makeRequest("/api/v1/calls/cl1/notes", { method: "PATCH", body: JSON.stringify({ notes: "test" }) }),
      makeParams("cl1") as any,
    )
    expect(res.status).toBe(404)
  })

  it("saves notes successfully", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org1")
    vi.mocked(prisma.callLog.updateMany).mockResolvedValue({ count: 1 } as any)
    const res = await PATCH_NOTES(
      makeRequest("/api/v1/calls/cl1/notes", { method: "PATCH", body: JSON.stringify({ notes: "Follow up needed" }) }),
      makeParams("cl1") as any,
    )
    expect(res.status).toBe(200)
  })
})

/* ─── GET /api/v1/calls/active ────────────────────────────────────────── */

describe("GET /api/v1/calls/active", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await GET_ACTIVE(makeRequest("/api/v1/calls/active"))
    expect(res.status).toBe(401)
  })

  it("returns active calls", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "admin-1", role: "admin" } as never)
    vi.mocked(prisma.callLog.findMany).mockResolvedValue([{
      id: "cl1",
      status: "ringing",
      provider: "asterisk",
      conversationId: null,
      leadId: "lead-1",
    }] as never)
    vi.mocked(prisma.lead.findMany).mockResolvedValue([{
      id: "lead-1",
      contactName: "Inbound Lead",
      companyName: "Acme",
    }] as never)
    const res = await GET_ACTIVE(makeRequest("/api/v1/calls/active"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toHaveLength(1)
    expect(json.data[0]).toMatchObject({
      id: "cl1",
      provider: "asterisk",
      leadId: "lead-1",
      lead: { contactName: "Inbound Lead", companyName: "Acme" },
    })
    expect(prisma.callLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org1",
        AND: [accessibleCallWhere("admin", "admin-1")],
        status: { in: ["ringing", "answering", "in-progress", "initiated"] },
        startedAt: { gte: expect.any(Date) },
      }),
      select: expect.objectContaining({
        id: true,
        provider: true,
        conversationId: true,
        callSid: true,
        leadId: true,
        browserAnswerClaimExpiresAt: true,
        contact: { select: { fullName: true, email: true } },
      }),
    }))
    const activeQuery = vi.mocked(prisma.callLog.findMany).mock.calls[0]?.[0]
    expect(activeQuery?.where).not.toHaveProperty("createdAt")
    expect(activeQuery?.select).not.toHaveProperty("lead")
    expect(prisma.lead.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org1", id: { in: ["lead-1"] } },
      select: { id: true, contactName: true, companyName: true },
    })
  })

  it("does not expose lead identity to a role without leads read access", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "support-1", role: "support" } as never)
    vi.mocked(prisma.callLog.findMany).mockResolvedValue([{
      id: "ticket-call",
      status: "ringing",
      provider: "asterisk",
      ticketId: "ticket-1",
      leadId: "lead-private",
      lead: { contactName: "Private Lead", companyName: "Private Company" },
    }] as never)

    const res = await GET_ACTIVE(makeRequest("/api/v1/calls/active"))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data[0]).toMatchObject({ leadId: null, lead: null })
    expect(prisma.lead.findMany).not.toHaveBeenCalled()
    const activeQuery = vi.mocked(prisma.callLog.findMany).mock.calls[0]?.[0]
    expect(activeQuery?.where?.AND).toEqual([accessibleCallWhere("support", "support-1")])
  })

  it("shows a fresh inbound browser claim only to its owner and releases an expired ringing row", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "sales-2", role: "sales" } as never)
    const now = Date.now()
    vi.mocked(prisma.callLog.findMany).mockResolvedValue([
      {
        id: "claimed-by-other",
        direction: "inbound",
        status: "ringing",
        provider: "asterisk",
        leadId: null,
        claimedByUserId: "sales-1",
        claimedAt: new Date(now - 1_000),
        browserAnswerClaimExpiresAt: new Date(now + 20_000),
      },
      {
        id: "expired",
        direction: "inbound",
        status: "ringing",
        provider: "asterisk",
        leadId: null,
        claimedByUserId: "sales-1",
        claimedAt: new Date(now - 60_000),
        browserAnswerClaimExpiresAt: new Date(now - 30_000),
      },
      {
        id: "answering-mine",
        direction: "inbound",
        status: "answering",
        provider: "asterisk",
        leadId: null,
        claimedByUserId: "sales-2",
        claimedAt: new Date(now - 1_000),
        browserAnswerClaimExpiresAt: new Date(now + 20_000),
      },
    ] as never)

    const res = await GET_ACTIVE(makeRequest("/api/v1/calls/active"))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.map((call: { id: string }) => call.id)).toEqual(["expired", "answering-mine"])
    expect(json.data[0]).toEqual(expect.objectContaining({
      claimedByUserId: null,
      claimedAt: null,
      browserAnswerClaimExpiresAt: null,
    }))
  })

  it("requires VoIP read permission before polling call state", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }) as never,
    )

    const res = await GET_ACTIVE(makeRequest("/api/v1/calls/active"))

    expect(res.status).toBe(403)
    expect(requireAuth).toHaveBeenCalledWith(expect.any(NextRequest), "voip", "read")
    expect(prisma.callLog.findMany).not.toHaveBeenCalled()
  })
})

/* ─── POST /api/v1/calls/test ─────────────────────────────────────────── */

describe("POST /api/v1/calls/test", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await POST_TEST(makeRequest("/api/v1/calls/test", { method: "POST" }))
    expect(res.status).toBe(401)
  })

  it("returns 400 when VoIP not configured", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "admin" } as any)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([])
    const res = await POST_TEST(makeRequest("/api/v1/calls/test", { method: "POST" }))
    expect(res.status).toBe(400)
  })

  it("tests connection and returns result", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "admin" } as any)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([readyTwilioConfig()] as any)
    mockTestConnection.mockResolvedValue({ success: true, message: "Connected" })
    const res = await POST_TEST(makeRequest("/api/v1/calls/test", { method: "POST" }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.provider).toBe("twilio")
  })

  it("rejects a non-admin before reading provider configuration", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "sales" } as any)

    const res = await POST_TEST(makeRequest("/api/v1/calls/test", { method: "POST" }))

    expect(res.status).toBe(403)
    expect(prisma.channelConfig.findMany).not.toHaveBeenCalled()
    expect(mockTestConnection).not.toHaveBeenCalled()
  })

  it("requires the VoIP entitlement for a tenant admin", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "admin" } as any)
    vi.mocked(orgHasModule).mockResolvedValue(false)

    const res = await POST_TEST(makeRequest("/api/v1/calls/test", { method: "POST" }))

    expect(res.status).toBe(403)
    expect(prisma.channelConfig.findMany).not.toHaveBeenCalled()
    expect(mockTestConnection).not.toHaveBeenCalled()
  })

  it("rejects bearer/API-key access before probing the provider", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org1", userId: "u1", role: "admin" } as any)

    const res = await POST_TEST(makeRequest("/api/v1/calls/test", {
      method: "POST",
      headers: { authorization: "Bearer ld_test" },
    }))

    expect(res.status).toBe(403)
    expect(prisma.channelConfig.findMany).not.toHaveBeenCalled()
    expect(mockTestConnection).not.toHaveBeenCalled()
  })
})

/* ─── POST /api/v1/calls/twiml ────────────────────────────────────────── */

describe("POST /api/v1/calls/twiml", () => {
  it("returns TwiML with error message when no To number", async () => {
    // FormData parsing will fail with empty body, falls back to searchParams
    const res = await POST_TWIML(makeRequest("/api/v1/calls/twiml", { method: "POST" }))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain("<Say>")
    expect(text).toContain("could not determine")
  })

  it("never resolves an Asterisk AI call through the Twilio fallback", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue(null)
    const formBody = new URLSearchParams({ CallSid: "shared-correlation" })

    const res = await POST_TWIML(makeRequest("/api/v1/calls/twiml", {
      method: "POST",
      body: formBody.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }))

    expect(res.status).toBe(200)
    expect(prisma.callLog.findFirst).toHaveBeenCalledWith({
      where: {
        callSid: "shared-correlation",
        provider: "twilio",
        callMode: { not: "ai" },
      },
    })
  })
})

/* ─── POST /api/v1/calls/webhook (Twilio status) ─────────────────────── */

describe("POST /api/v1/calls/webhook", () => {
  it("returns 400 when CallSid missing", async () => {
    const formBody = new URLSearchParams({ CallStatus: "completed" })
    const res = await POST_WEBHOOK(
      makeRequest("/api/v1/calls/webhook", {
        method: "POST",
        body: formBody.toString(),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns XML response when call not found", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue(null)
    const formBody = new URLSearchParams({ CallSid: "sid1", CallStatus: "completed" })
    const res = await POST_WEBHOOK(
      makeRequest("/api/v1/calls/webhook", {
        method: "POST",
        body: formBody.toString(),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }),
    )
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain("<Response/>")
    expect(prisma.callLog.findFirst).toHaveBeenCalledWith({
      where: {
        callSid: "sid1",
        provider: "twilio",
        callMode: { not: "ai" },
      },
    })
  })
})

/* ─── 3CX Webhook ─────────────────────────────────────────────────────── */

describe("POST /api/v1/calls/webhook/threecx", () => {
  it("returns 400 when orgId missing", async () => {
    const res = await POST_THREECX(
      makeRequest("/api/v1/calls/webhook/threecx", { method: "POST", body: JSON.stringify({ event: "call.ringing" }) }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 401 when secret is wrong (length mismatch — fast reject)", async () => {
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([
      { id: "cfg", isActive: true, settings: { webhookSecret: "correct-secret" } },
    ] as any)
    const res = await POST_THREECX(
      makeRequest("/api/v1/calls/webhook/threecx?orgId=org1&secret=wrong", {
        method: "POST",
        body: JSON.stringify({ event: "call.ringing", call: { callId: "c1", callerNumber: "+1", calleeNumber: "+2" } }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it("returns 401 when secret has matching length but different content (timingSafeEqual branch)", async () => {
    // Locks in the constant-time-compare path that replaced the
    // timing-unsafe `!==` check (gap #4 in rate-limit-policy.md).
    // "wrongsecret123" has the same length as "correctsecret!" so the
    // length-mismatch fast-reject above doesn't fire — request only
    // gets rejected by `timingSafeEqual`.
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([
      { id: "cfg", isActive: true, settings: { webhookSecret: "correctsecret!" } },
    ] as any)
    const res = await POST_THREECX(
      makeRequest("/api/v1/calls/webhook/threecx?orgId=org1&secret=wrongsecret123", { // gitleaks:allow -- synthetic test/public display literal
        method: "POST",
        body: JSON.stringify({ event: "call.ringing", call: { callId: "c1", callerNumber: "+1", calleeNumber: "+2" } }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it("returns 401 when secret query param is missing but config has webhookSecret", async () => {
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([
      { id: "cfg", isActive: true, settings: { webhookSecret: "expected" } },
    ] as any)
    const res = await POST_THREECX(
      makeRequest("/api/v1/calls/webhook/threecx?orgId=org1", {
        method: "POST",
        body: JSON.stringify({ event: "call.ringing", call: { callId: "c1", callerNumber: "+1", calleeNumber: "+2" } }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it("returns 401 when the org has no webhook secret configured", async () => {
    // The secret is mandatory: without one, anybody holding the orgId could
    // write call history into the tenant.
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([{ id: "cfg", isActive: true, settings: {} }] as any)
    const res = await POST_THREECX(
      makeRequest("/api/v1/calls/webhook/threecx?orgId=org1&secret=s", {
        method: "POST",
        body: JSON.stringify({
          event: "call.ringing",
          call: { callId: "c1", callerNumber: "+1234", calleeNumber: "+5678", direction: "inbound" },
        }),
      }),
    )
    expect(res.status).toBe(401)
    expect(prisma.callLog.create).not.toHaveBeenCalled()
  })

  it("creates call log on ringing event", async () => {
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([{ id: "cfg", isActive: true, settings: { webhookSecret: "s" } }] as any)
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.callLog.create).mockResolvedValue({ id: "cl1" } as any)
    const res = await POST_THREECX(
      makeRequest("/api/v1/calls/webhook/threecx?orgId=org1&secret=s", {
        method: "POST",
        body: JSON.stringify({
          event: "call.ringing",
          call: { callId: "c1", callerNumber: "+1234", calleeNumber: "+5678", direction: "inbound" },
        }),
      }),
    )
    expect(res.status).toBe(200)
    expect(prisma.callLog.create).toHaveBeenCalled()
  })
})

describe("GET /api/v1/calls/webhook/threecx", () => {
  it("returns ok status", async () => {
    const res = await GET_THREECX()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.service).toBe("3cx-webhook")
  })
})
