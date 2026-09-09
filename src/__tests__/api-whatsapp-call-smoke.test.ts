import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import type { AuthResult } from "@/lib/api-auth"

type MockFindFirstArgs = {
  where?: Record<string, unknown>
  select?: Record<string, unknown>
}

type MockWriteArgs = {
  where?: Record<string, unknown>
  create?: Record<string, unknown>
  update?: Record<string, unknown>
  data?: Record<string, unknown>
  select?: Record<string, unknown>
}

const db = {
  channel: {
    id: "cfg_wa",
    phoneNumberId: "1234567890",
    phoneNumber: "13175551399",
    displayName: "Acme WhatsApp",
  } as { id: string; phoneNumberId: string | null; phoneNumber: string | null; displayName: string | null } | null,
  existingCall: null as { id: string; notes: string | null } | null,
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findFirst: vi.fn(async ({ where }: MockFindFirstArgs) => {
        if (where?.organizationId === "org_1" && where?.channelType === "whatsapp" && where?.isActive === true) {
          return db.channel
        }
        return null
      }),
    },
    socialConversation: {
      upsert: vi.fn(async () => ({ id: "sc_smoke" })),
    },
    callLog: {
      findFirst: vi.fn(async ({ where }: MockFindFirstArgs) => (
        where?.organizationId === "org_1" && where?.callSid === "wa-smoke-org_1" ? db.existingCall : null
      )),
      create: vi.fn(async ({ data }: MockWriteArgs) => ({ id: "call_smoke", callSid: data?.callSid, status: data?.status })),
      update: vi.fn(async ({ data }: MockWriteArgs) => ({ id: "call_existing", callSid: "wa-smoke-org_1", status: data?.status })),
    },
    whatsAppCallPermission: {
      upsert: vi.fn(async () => ({ id: "perm_smoke" })),
    },
  },
}))

vi.mock("@/lib/whatsapp-call-sessions", () => ({
  storeWhatsAppCallSession: vi.fn(),
}))

import { createWhatsAppCallingSmokeScenario } from "@/app/api/v1/calls/whatsapp/smoke/_impl"
import { prisma } from "@/lib/prisma"
import { storeWhatsAppCallSession } from "@/lib/whatsapp-call-sessions"

const auth: AuthResult = {
  orgId: "org_1",
  userId: "user_1",
  role: "admin",
  email: "admin@example.com",
  name: "Admin",
}

function req(body: unknown) {
  return new NextRequest("http://localhost:3000/api/v1/calls/whatsapp/smoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  db.channel = {
    id: "cfg_wa",
    phoneNumberId: "1234567890",
    phoneNumber: "13175551399",
    displayName: "Acme WhatsApp",
  }
  db.existingCall = null
})

describe("POST /api/v1/calls/whatsapp/smoke", () => {
  it("requires an explicit confirmation before touching tenant data", async () => {
    const res = await createWhatsAppCallingSmokeScenario(req({}), auth)

    expect(res.status).toBe(400)
    expect(prisma.channelConfig.findFirst).not.toHaveBeenCalled()
    expect(prisma.socialConversation.upsert).not.toHaveBeenCalled()
    expect(prisma.callLog.create).not.toHaveBeenCalled()
  })

  it("creates a CRM-only smoke call even before WhatsApp credentials are saved", async () => {
    db.channel = null

    const res = await createWhatsAppCallingSmokeScenario(req({ confirm: "create-whatsapp-calling-smoke" }), auth)
    const body = await res.json() as { data: { inboxUrl: string; warning: string } }

    expect(res.status).toBe(200)
    expect(prisma.socialConversation.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        channelConfigId: undefined,
        platform: "whatsapp",
      }),
      update: expect.objectContaining({
        channelConfigId: undefined,
      }),
    }))
    expect(prisma.callLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        toNumber: "whatsapp-business",
        provider: "whatsapp",
        status: "ringing",
      }),
    }))
    expect(body.data).toMatchObject({
      inboxUrl: "/inbox?conversation=sc_smoke",
      warning: "Smoke scenario only: no external Meta call was placed.",
    })
  })

  it("creates a call-only WhatsApp conversation, ringing CallLog and temporary SDP session", async () => {
    const res = await createWhatsAppCallingSmokeScenario(req({
      confirm: "create-whatsapp-calling-smoke",
      customerPhone: "+994 50 123 45 67",
      contactName: " Aysel   Test ",
    }), auth)
    const body = await res.json() as { data: { callLogId: string; conversationId: string; inboxUrl: string } }

    expect(res.status).toBe(200)
    expect(prisma.socialConversation.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId_platform_externalId: { organizationId: "org_1", platform: "whatsapp", externalId: "994501234567" } },
      create: expect.objectContaining({
        organizationId: "org_1",
        channelConfigId: "cfg_wa",
        platform: "whatsapp",
        contactName: "Aysel Test",
      }),
    }))
    expect(prisma.callLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org_1",
        callSid: "wa-smoke-org_1",
        direction: "inbound",
        fromNumber: "994501234567",
        toNumber: "13175551399",
        status: "ringing",
        provider: "whatsapp",
        conversationId: "sc_smoke",
        notes: expect.stringContaining("smoke scenario"),
      }),
      select: { id: true, callSid: true, status: true },
    })
    expect(storeWhatsAppCallSession).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_1",
      callId: "wa-smoke-org_1",
      sdpType: "offer",
      direction: "inbound",
      conversationId: "sc_smoke",
    }))
    expect(body.data).toMatchObject({
      callLogId: "call_smoke",
      conversationId: "sc_smoke",
      inboxUrl: "/inbox?conversation=sc_smoke",
    })
  })

  it("creates an outbound smoke call with approved permission, active popup ownership and answer session", async () => {
    const res = await createWhatsAppCallingSmokeScenario(req({
      confirm: "create-whatsapp-calling-smoke",
      direction: "outbound",
      customerPhone: "+994 50 123 45 67",
      contactName: " Aysel   Test ",
    }), auth)
    const body = await res.json() as {
      data: {
        callLogId: string
        callSid: string
        conversationId: string
        direction: string
        status: string
        permissionId: string
        activePopupUserId: string
      }
    }

    expect(res.status).toBe(200)
    expect(prisma.whatsAppCallPermission.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId_channelConfigId_recipientKey: {
          organizationId: "org_1",
          channelConfigId: "cfg_wa",
          recipientKey: "wa:994501234567",
        },
      },
      create: expect.objectContaining({
        organizationId: "org_1",
        channelConfigId: "cfg_wa",
        conversationId: "sc_smoke",
        status: "permanent",
        canStartCall: true,
        responseSource: "crm_smoke",
        approvedAt: expect.any(Date),
      }),
      update: expect.objectContaining({
        conversationId: "sc_smoke",
        status: "permanent",
        canStartCall: true,
        rejectedAt: null,
        expiresAt: null,
      }),
    }))
    expect(prisma.callLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org_1",
        callSid: "wa-smoke-outbound-org_1",
        providerCallId: "wa-smoke-outbound-org_1",
        direction: "outbound",
        fromNumber: "13175551399",
        toNumber: "994501234567",
        status: "in-progress",
        provider: "whatsapp",
        conversationId: "sc_smoke",
        userId: "user_1",
        claimedByUserId: "user_1",
        claimedAt: expect.any(Date),
        notes: expect.stringContaining("outbound_connect"),
      }),
      select: { id: true, callSid: true, status: true },
    })
    expect(storeWhatsAppCallSession).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_1",
      callId: "wa-smoke-outbound-org_1",
      sdpType: "answer",
      direction: "outbound",
      fromNumber: "13175551399",
      toNumber: "994501234567",
      conversationId: "sc_smoke",
    }))
    expect(body.data).toMatchObject({
      callLogId: "call_smoke",
      callSid: "wa-smoke-outbound-org_1",
      conversationId: "sc_smoke",
      direction: "outbound",
      status: "in-progress",
      permissionId: "perm_smoke",
      activePopupUserId: "user_1",
    })
  })

  it("updates the tenant smoke call instead of creating duplicates", async () => {
    db.existingCall = { id: "call_existing", notes: "previous note" }

    const res = await createWhatsAppCallingSmokeScenario(req({ confirm: "create-whatsapp-calling-smoke" }), auth)

    expect(res.status).toBe(200)
    expect(prisma.callLog.create).not.toHaveBeenCalled()
    expect(prisma.callLog.update).toHaveBeenCalledWith({
      where: { id: "call_existing" },
      data: expect.objectContaining({
        status: "ringing",
        notes: expect.stringContaining("previous note\n[WhatsApp Calling]"),
      }),
      select: { id: true, callSid: true, status: true },
    })
  })
})
