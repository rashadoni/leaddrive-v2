import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mockInitiateCall = vi.fn()

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
    channelConfig: { findMany: vi.fn() },
    lead: { findFirst: vi.fn() },
    // The route reads the caller's own number so the call rings THEM, not one
    // organisation-wide extension.
    user: { findFirst: vi.fn().mockResolvedValue({ phone: null, verifiedPhone: null }) },
    callLog: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    voiceSuppression: { findFirst: vi.fn() },
    voiceConsent: { findFirst: vi.fn() },
  },
}))
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn(),
  requireAuth: vi.fn(),
  isAuthError: vi.fn((value: unknown) => value instanceof Response),
  orgHasModule: vi.fn().mockResolvedValue(true),
  moduleDisabledResponse: vi.fn(() => new Response("", { status: 403 })),
}))
vi.mock("@/lib/voip", () => ({
  getVoipProvider: vi.fn(() => ({ initiateCall: mockInitiateCall })),
}))
vi.mock("@/lib/contact-events", () => ({ trackContactEvent: vi.fn() }))
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

import { POST } from "@/app/api/v1/calls/route"
import { prisma } from "@/lib/prisma"
import { getSession, requireAuth } from "@/lib/api-auth"

const makeReq = (body: any, key = "33333333-3333-4333-8333-333333333333") =>
  new NextRequest("http://localhost:3000/api/v1/calls", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // A distinct key per intent: the route replays a repeat of the same key,
      // which is right in production and hides assertions in a test file.
      "Idempotency-Key": key,
    },
    body: JSON.stringify(body),
  })

describe("POST /api/v1/calls — click-to-call from a lead (Slice 3b)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getSession).mockResolvedValue({ orgId: "org-1", userId: "u1", role: "sales" } as any)
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "u1", role: "sales" } as any)
    vi.mocked(prisma.$transaction).mockImplementation(async (operation: any) => operation(prisma))
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: "lead-3" }] as never)
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as never)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([{
      id: "cfg_twilio",
      configName: "Twilio",
      phoneNumber: "+100",
      apiKey: "auth-token",
      settings: { provider: "twilio", accountSid: "AC123", twilioNumber: "+100" },
      isActive: true,
    }] as any)
    vi.mocked(prisma.lead.findFirst).mockResolvedValue({ phone: "+994501112233" } as any)
    vi.mocked(prisma.voiceSuppression.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.voiceConsent.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.callLog.create).mockResolvedValue({ id: "cl1" } as any)
    vi.mocked(prisma.callLog.update).mockResolvedValue({} as any)
    mockInitiateCall.mockResolvedValue({ success: true, callSid: "sid1" })
  })

  it("rejects a cross-origin browser mutation before provider or database work", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/calls", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://untrusted.example",
        "Sec-Fetch-Site": "cross-site",
      },
      body: JSON.stringify({ provider: "voip", toNumber: "+994501112233" }),
    })

    const res = await POST(req)

    expect(res.status).toBe(403)
    expect(prisma.channelConfig.findMany).not.toHaveBeenCalled()
    expect(mockInitiateCall).not.toHaveBeenCalled()
  })

  it("persists leadId on the CallLog when the call is initiated from a lead", async () => {
    const res = await POST(makeReq({ provider: "voip", toNumber: "+994501112233", leadId: "lead-3" }))
    expect(res.status).toBe(200)
    const data = vi.mocked(prisma.callLog.create).mock.calls[0][0]!.data as any
    expect(data.leadId).toBe("lead-3")
    expect(data.direction).toBe("outbound")
    expect(data.organizationId).toBe("org-1")
    expect(data.targetPhoneE164).toBe("+994501112233")
    expect(prisma.lead.findFirst).toHaveBeenCalledWith({
      where: {
        id: "lead-3",
        organizationId: "org-1",
        assignedTo: "u1",
      },
      select: { phone: true },
    })
    const executeOrders = vi.mocked(prisma.$executeRaw).mock.invocationCallOrder
    expect(vi.mocked(prisma.$queryRaw).mock.invocationCallOrder[0]).toBeLessThan(
      executeOrders[executeOrders.length - 1],
    )
  })

  it("rejects a client lead reference whose canonical phone differs from the destination", async () => {
    vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce({ phone: "+994502223344" } as any)

    const res = await POST(makeReq({
      provider: "voip",
      toNumber: "+994501112233",
      leadId: "lead-3",
    }))

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: "lead_phone_mismatch" })
    expect(prisma.callLog.create).not.toHaveBeenCalled()
    expect(mockInitiateCall).not.toHaveBeenCalled()
  })

  it("canonicalizes supported formatting and rejects an unknown national country", async () => {
    await POST(makeReq({ provider: "voip", toNumber: "+994 (50) 111-22-33", leadId: "lead-3" }))
    const data = vi.mocked(prisma.callLog.create).mock.calls[0][0]!.data as Record<string, unknown>
    expect(data.targetPhoneE164).toBe("+994501112233")

    vi.mocked(prisma.callLog.create).mockClear()
    const response = await POST(makeReq({ provider: "voip", toNumber: "201 234 56 78", leadId: "lead-3" }))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "invalid_phone_number" })
    expect(prisma.callLog.create).not.toHaveBeenCalled()
  })

  it("leadId is null when not provided (contact/other calls unaffected)", async () => {
    const res = await POST(makeReq({ provider: "voip", toNumber: "+994501112233", contactId: "c9" }))
    expect(res.status).toBe(200)
    const data = vi.mocked(prisma.callLog.create).mock.calls[0][0]!.data as any
    expect(data.leadId).toBeNull()
    expect(data.contactId).toBe("c9")
  })

  it("blocks ordinary CRM calls when the canonical destination has an active do-not-call record", async () => {
    vi.mocked(prisma.voiceSuppression.findFirst).mockResolvedValueOnce({ id: "dnc-1" } as never)

    const res = await POST(makeReq({
      provider: "voip",
      toNumber: "+994 (50) 111-22-33",
      leadId: "lead-3",
    }))

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: "voice_contact_blocked" })
    expect(prisma.voiceSuppression.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        organizationId: "org-1",
        phoneE164: "+994501112233",
        scope: { in: ["sales", "all"] },
        isActive: true,
      }),
      select: { id: true },
    })
    expect(prisma.callLog.create).not.toHaveBeenCalled()
    expect(mockInitiateCall).not.toHaveBeenCalled()
  })

  it("also blocks ordinary CRM calls when durable sales consent is blocked", async () => {
    vi.mocked(prisma.voiceConsent.findFirst).mockResolvedValueOnce({ id: "consent-block" } as never)

    const res = await POST(makeReq({
      provider: "voip",
      toNumber: "+994501112233",
      leadId: "lead-3",
    }))

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: "voice_contact_blocked" })
    expect(prisma.callLog.create).not.toHaveBeenCalled()
    expect(mockInitiateCall).not.toHaveBeenCalled()
  })

  it("does not let an unrelated conversation reference bypass a sales block", async () => {
    vi.mocked(prisma.voiceSuppression.findFirst).mockImplementationOnce(async (args: any) => (
      args.where.scope.in.includes("sales") ? { id: "sales-only-dnc" } : null
    ))

    const res = await POST(makeReq({
      provider: "voip",
      toNumber: "+994501112233",
      conversationId: "conversation-1",
    }))

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: "voice_contact_blocked" })
    expect(prisma.voiceSuppression.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ scope: { in: ["sales", "all"] } }),
    }))
    expect(mockInitiateCall).not.toHaveBeenCalled()
  })

  it("persists companyId on the CallLog (company-card click-to-call; enables /calls?companyId + future company timeline)", async () => {
    const res = await POST(makeReq({ provider: "voip", toNumber: "+994501112233", companyId: "co-2" }))
    expect(res.status).toBe(200)
    const data = vi.mocked(prisma.callLog.create).mock.calls[0][0]!.data as any
    expect(data.companyId).toBe("co-2")
  })

  it("rings the caller's own Azerbaijani number and says so", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      phone: "0501234567", verifiedPhone: null,
    } as any)

    const res = await POST(makeReq(
      { provider: "voip", toNumber: "+994501112233", leadId: "lead-1" },
      "44444444-4444-4444-8444-444444444444",
    ))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.agentLeg).toBe("own")
    expect(mockInitiateCall.mock.calls[0][0].agentNumber).toBe("994501234567")
  })

  it("refuses to dial a foreign number as the agent leg", async () => {
    // The profile phone is self-service, so an unbounded value would let anyone
    // point the company's trunk at a premium-rate line abroad.
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      phone: null, verifiedPhone: "+8823456789012",
    } as any)

    const res = await POST(makeReq(
      { provider: "voip", toNumber: "+994501112233", leadId: "lead-1" },
      "55555555-5555-4555-8555-555555555555",
    ))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockInitiateCall.mock.calls[0][0].agentNumber).toBeUndefined()
    // The shared line answers, and the UI is told so rather than promising
    // the rep their own phone.
    expect(body.agentLeg).toBe("shared")
  })

})
