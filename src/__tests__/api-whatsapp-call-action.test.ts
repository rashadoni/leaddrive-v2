import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import type { AuthResult } from "@/lib/api-auth"
import type { WhatsAppCallActionResult } from "@/lib/whatsapp"

type MockFindFirstArgs = {
  where?: Record<string, unknown>
  select?: Record<string, unknown>
}
type MockUpdateArgs = {
  where: { id: string }
  data: Record<string, unknown>
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    callLog: {
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/whatsapp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/whatsapp")>()
  return {
    ...actual,
    sendWhatsAppCallAction: vi.fn(),
  }
})

vi.mock("@/lib/whatsapp-call-sessions", () => ({
  deleteWhatsAppCallSession: vi.fn(),
}))

import { postWhatsAppCallAction, type WhatsAppCallActionSender } from "@/app/api/v1/calls/whatsapp/[id]/action/_impl"
import { prisma } from "@/lib/prisma"
import { deleteWhatsAppCallSession } from "@/lib/whatsapp-call-sessions"

const auth: AuthResult = {
  orgId: "org_1",
  userId: "user_1",
  role: "admin",
  email: "admin@example.com",
  name: "Admin",
}

function req(body: unknown) {
  return new NextRequest("http://localhost:3000/api/v1/calls/whatsapp/call_1/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function ctx(id = "call_1") {
  return { params: Promise.resolve({ id }) }
}

function sender(result: WhatsAppCallActionResult, calls: Parameters<WhatsAppCallActionSender>[] = []): WhatsAppCallActionSender {
  return async (params) => {
    calls.push([params])
    return result
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.callLog.updateMany).mockResolvedValue({ count: 1 } as any)
})

describe("POST /api/v1/calls/whatsapp/[id]/action", () => {
  it("requires SDP for pre_accept and accept before touching the database", async () => {
    const res = await postWhatsAppCallAction(req({ action: "accept" }), auth, ctx(), sender({ success: true }))

    expect(res.status).toBe(400)
    expect(prisma.callLog.findFirst).not.toHaveBeenCalled()
  })

  it("looks up the call inside the authenticated tenant", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue(null)

    const res = await postWhatsAppCallAction(
      req({ action: "reject" }),
      auth,
      ctx("call_cross_tenant"),
      sender({ success: true }),
    )

    expect(res.status).toBe(404)
    expect(prisma.callLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "call_cross_tenant", organizationId: "org_1" },
    } satisfies Partial<MockFindFirstArgs>))
  })

  it("rejects non-WhatsApp call logs", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({
      id: "call_1",
      callSid: "CA123",
      channelConfigId: null,
      provider: "twilio",
      direction: "outbound",
      status: "completed",
      notes: null,
      conversation: null,
    })

    const res = await postWhatsAppCallAction(req({ action: "reject" }), auth, ctx(), sender({ success: true }))

    expect(res.status).toBe(409)
    expect(prisma.callLog.update).not.toHaveBeenCalled()
  })

  it("forwards accept to Meta and marks the call in-progress", async () => {
    const calls: Parameters<WhatsAppCallActionSender>[] = []
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({
      id: "call_1",
      callSid: "wacid.123",
      channelConfigId: "cfg_call",
      provider: "whatsapp",
      direction: "inbound",
      status: "ringing",
      notes: "operator note",
      conversation: { channelConfigId: "cfg_wa" },
    })
    vi.mocked(prisma.callLog.update).mockResolvedValue({ id: "call_1" })

    const res = await postWhatsAppCallAction(
      req({ action: "accept", sdp: " v=0\r\n...", sdpType: "answer" }),
      auth,
      ctx(),
      sender({ success: true, status: 200, data: { success: true } }, calls),
    )

    expect(res.status).toBe(200)
    expect(calls[0]?.[0]).toMatchObject({
      organizationId: "org_1",
      channelConfigId: "cfg_call",
      callId: "wacid.123",
      action: "accept",
      sdp: "v=0\r\n...",
      sdpType: "answer",
    })
    expect(prisma.callLog.update).toHaveBeenCalledWith({
      where: { id: "call_1" },
      data: expect.objectContaining({
        status: "in-progress",
        claimedByUserId: "user_1",
        notes: expect.stringContaining("operator note\n[WhatsApp Calling]"),
      }),
    } satisfies MockUpdateArgs)
  })

  it("does not change call status when Meta rejects the action, but records a diagnostic note", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({
      id: "call_1",
      callSid: "wacid.123",
      channelConfigId: null,
      provider: "whatsapp",
      direction: "inbound",
      status: "in-progress",
      notes: null,
      conversation: { channelConfigId: "cfg_wa" },
    })

    const res = await postWhatsAppCallAction(
      req({ action: "terminate" }),
      auth,
      ctx(),
      sender({ success: false, status: 400, error: "bad call state" }),
    )

    expect(res.status).toBe(502)
    expect(prisma.callLog.update).toHaveBeenCalledWith({
      where: { id: "call_1" },
      data: {
        notes: expect.stringContaining("action failed"),
      },
    } satisfies MockUpdateArgs)
  })

  it("cleans up the temporary WhatsApp session after a successful terminal action", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({
      id: "call_1",
      callSid: "wacid.123",
      channelConfigId: null,
      provider: "whatsapp",
      direction: "inbound",
      status: "ringing",
      notes: null,
      conversation: { channelConfigId: "cfg_wa" },
    })
    vi.mocked(prisma.callLog.update).mockResolvedValue({ id: "call_1" })

    const res = await postWhatsAppCallAction(
      req({ action: "reject" }),
      auth,
      ctx(),
      sender({ success: true, status: 200, data: { success: true } }),
    )

    expect(res.status).toBe(200)
    expect(prisma.callLog.update).toHaveBeenCalledWith({
      where: { id: "call_1" },
      data: expect.objectContaining({
        status: "rejected",
        endedAt: expect.any(Date),
      }),
    } satisfies MockUpdateArgs)
    expect(deleteWhatsAppCallSession).toHaveBeenCalledWith("org_1", "wacid.123")
  })

  it("rejects terminal WhatsApp call actions before calling Meta", async () => {
    const calls: Parameters<WhatsAppCallActionSender>[] = []
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({
      id: "call_1",
      callSid: "wacid.123",
      channelConfigId: null,
      provider: "whatsapp",
      direction: "inbound",
      status: "completed",
      notes: null,
      conversation: { channelConfigId: "cfg_wa" },
    })

    const res = await postWhatsAppCallAction(
      req({ action: "terminate" }),
      auth,
      ctx(),
      sender({ success: true }, calls),
    )

    expect(res.status).toBe(409)
    expect(calls).toEqual([])
    expect(prisma.callLog.update).not.toHaveBeenCalled()
  })

  it("rejects answering outbound WhatsApp calls before calling Meta", async () => {
    const calls: Parameters<WhatsAppCallActionSender>[] = []
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({
      id: "call_1",
      callSid: "wacid.123",
      channelConfigId: null,
      provider: "whatsapp",
      direction: "outbound",
      status: "ringing",
      notes: null,
      conversation: { channelConfigId: "cfg_wa" },
    })

    const res = await postWhatsAppCallAction(
      req({ action: "accept", sdp: "v=0\r\n...", sdpType: "answer" }),
      auth,
      ctx(),
      sender({ success: true }, calls),
    )

    expect(res.status).toBe(409)
    expect(calls).toEqual([])
    expect(prisma.callLog.update).not.toHaveBeenCalled()
  })

  it("rejects answer when another operator already claimed the WhatsApp call", async () => {
    const calls: Parameters<WhatsAppCallActionSender>[] = []
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({
      id: "call_1",
      callSid: "wacid.123",
      channelConfigId: "cfg_wa",
      provider: "whatsapp",
      direction: "inbound",
      status: "ringing",
      notes: null,
      conversation: { channelConfigId: "cfg_wa" },
    })
    vi.mocked(prisma.callLog.updateMany).mockResolvedValue({ count: 0 } as any)

    const res = await postWhatsAppCallAction(
      req({ action: "accept", sdp: "v=0\r\n...", sdpType: "answer" }),
      auth,
      ctx(),
      sender({ success: true }, calls),
    )

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: "WhatsApp call is already claimed by another operator" })
    expect(calls).toEqual([])
  })
})
