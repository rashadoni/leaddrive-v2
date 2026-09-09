import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import type { AuthResult } from "@/lib/api-auth"
import type { WhatsAppCallSession } from "@/lib/whatsapp-call-sessions"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    callLog: {
      findFirst: vi.fn(),
    },
  },
}))

import { getWhatsAppCallSessionRoute, type WhatsAppCallSessionLoader } from "@/app/api/v1/calls/whatsapp/[id]/session/_impl"
import { prisma } from "@/lib/prisma"

const auth: AuthResult = {
  orgId: "org_1",
  userId: "user_1",
  role: "admin",
  email: "admin@example.com",
  name: "Admin",
}

function req() {
  return new NextRequest("http://localhost:3000/api/v1/calls/whatsapp/call_1/session")
}

function ctx(id = "call_1") {
  return { params: Promise.resolve({ id }) }
}

function session(): WhatsAppCallSession {
  return {
    organizationId: "org_1",
    callId: "wacid.123",
    sdp: "v=0\r\n...",
    sdpType: "offer",
    direction: "inbound",
    fromNumber: "994501234567",
    toNumber: "13175551399",
    conversationId: "sc_1",
    expiresAt: "2026-06-26T14:00:00.000Z",
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/v1/calls/whatsapp/[id]/session", () => {
  it("looks up the call inside the authenticated tenant", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue(null)
    const loader: WhatsAppCallSessionLoader = vi.fn(async () => null)

    const res = await getWhatsAppCallSessionRoute(req(), auth, ctx("call_cross_tenant"), loader)

    expect(res.status).toBe(404)
    expect(prisma.callLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "call_cross_tenant", organizationId: "org_1" },
    }))
    expect(loader).not.toHaveBeenCalled()
  })

  it("rejects non-WhatsApp calls", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({
      id: "call_1",
      callSid: "CA123",
      provider: "twilio",
    })

    const res = await getWhatsAppCallSessionRoute(req(), auth, ctx(), vi.fn(async () => session()))

    expect(res.status).toBe(409)
  })

  it("returns the temporary SDP session with no-store cache header", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({
      id: "call_1",
      callSid: "wacid.123",
      provider: "whatsapp",
    })
    const loader: WhatsAppCallSessionLoader = vi.fn(async () => session())

    const res = await getWhatsAppCallSessionRoute(req(), auth, ctx(), loader)
    const body = await res.json() as { data: { sdp: string; sdpType: string; callSid: string } }

    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    expect(loader).toHaveBeenCalledWith("org_1", "wacid.123")
    expect(body.data).toMatchObject({
      callSid: "wacid.123",
      sdp: "v=0\r\n...",
      sdpType: "offer",
    })
  })
})
