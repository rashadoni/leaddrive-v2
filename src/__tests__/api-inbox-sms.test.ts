import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/**
 * Inbox SMS path — verifies POST /api/v1/inbox with channel="sms" routes
 * through the sendSms() abstraction (NOT the old hardcoded Twilio fetch),
 * and that ChannelMessage is logged with the right delivery status.
 *
 * Before this refactor, the inbox called api.twilio.com directly and would
 * fail for any org configured with ATL or Vonage — that's the regression
 * this test locks in.
 */

const state: {
  smsCalls: any[]
  messagesCreated: any[]
  sendSmsResult: { success: boolean; messageId?: string; error?: string }
} = { smsCalls: [], messagesCreated: [], sendSmsResult: { success: true, messageId: "sm_1" } }

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(async () => "org_1"),
  getSession: vi.fn(async () => null),
  requireAuth: vi.fn(async () => ({
    orgId: "org_1", userId: "support_1", role: "support",
    email: "support@example.test", name: "Support",
  })),
  requireSessionAuth: vi.fn(async () => ({
    orgId: "org_1", userId: "support_1", role: "support",
    email: "support@example.test", name: "Support",
  })),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: {
      findFirst: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    channelConfig: {
      findFirst: vi.fn(async () => null),
    },
    channelMessage: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `msg_${state.messagesCreated.length + 1}`, ...data }
        state.messagesCreated.push(row)
        return row
      }),
      findFirst: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    socialConversation: {
      findUnique: vi.fn(async () => ({ id: "sms-conversation-1", assignedTo: null })),
      create: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  },
}))

vi.mock("@/lib/sms", () => ({
  sendSms: vi.fn(async (opts: any) => {
    state.smsCalls.push(opts)
    return state.sendSmsResult
  }),
}))

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async () => ({ success: true })),
}))

vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(async () => ({ success: true, messageId: "wa_1" })),
}))

// Pass-through: the inbox test asserts leadId tagging + auto-resolve skip; the
// ownership lookup is unit-tested in lib-verify-owned-refs.test.ts.
vi.mock("@/lib/verify-owned-refs", () => ({
  sanitizeOwnedRefs: vi.fn(async (_org: string, r: any) => ({
    leadId: r.leadId || undefined,
    contactId: r.contactId || undefined,
    conversationId: r.conversationId || undefined,
  })),
}))

import { POST } from "@/app/api/v1/inbox/route"
import { sendSms } from "@/lib/sms"
import { prisma } from "@/lib/prisma"
import { sanitizeOwnedRefs } from "@/lib/verify-owned-refs"

function makeReq(body: any): NextRequest {
  return new NextRequest("https://example.com/api/v1/inbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  state.smsCalls = []
  state.messagesCreated = []
  state.sendSmsResult = { success: true, messageId: "sm_1" }
  vi.clearAllMocks()
})

describe("POST /api/v1/inbox — channel: 'sms'", () => {
  it("delegates to sendSms() with { to, message, organizationId } — no direct Twilio call", async () => {
    const res = await POST(makeReq({ to: "+994501234567", body: "Hello from LeadDrive", channel: "sms" }))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.success).toBe(true)
    expect(sendSms).toHaveBeenCalledTimes(1)
    expect(state.smsCalls[0]).toEqual({
      to: "+994501234567",
      message: "Hello from LeadDrive",
      organizationId: "org_1",
    })
  })

  it("logs ChannelMessage with status=delivered on success", async () => {
    await POST(makeReq({ to: "+994501234567", body: "ok", channel: "sms" }))

    expect(state.messagesCreated).toHaveLength(1)
    const msg = state.messagesCreated[0]
    expect(msg.channelType).toBe("sms")
    expect(msg.direction).toBe("outbound")
    expect(msg.status).toBe("delivered")
    expect(msg.to).toBe("+994501234567")
    expect(msg.body).toBe("ok")
  })

  it("logs ChannelMessage with status=failed and returns 500 on provider error", async () => {
    state.sendSmsResult = { success: false, error: "ATL 105: invalid credentials" }

    const res = await POST(makeReq({ to: "+994501234567", body: "ok", channel: "sms" }))
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.success).toBe(false)
    expect(json.error).toMatch(/ATL 105/)
    expect(state.messagesCreated).toHaveLength(1)
    expect(state.messagesCreated[0].status).toBe("failed")
    expect(state.messagesCreated[0].metadata).toMatchObject({
      error: "ATL 105: invalid credentials",
      authorType: "operator",
      authorUserId: "support_1",
      authorName: "Support",
      sentVia: "leaddrive_inbox",
      sentOnBehalfOfCompany: true,
    })
  })

  it("tags ChannelMessage with leadId and skips contact auto-resolve when sent from a lead (Slice 3b)", async () => {
    const res = await POST(makeReq({ to: "+994501234567", body: "hi lead", channel: "sms", leadId: "lead-7" }))
    expect(res.status).toBe(201)
    expect(state.messagesCreated).toHaveLength(1)
    expect(state.messagesCreated[0].leadId).toBe("lead-7")
    expect(state.messagesCreated[0].contactId).toBeUndefined()
    // contact auto-resolve must NOT run when a leadId is supplied
    expect(prisma.contact.findFirst).not.toHaveBeenCalled()
  })

  it("surfaces 'SMS provider not configured' through the abstraction (not a Twilio-specific 400)", async () => {
    state.sendSmsResult = { success: false, error: "SMS provider not configured" }

    const res = await POST(makeReq({ to: "+994501234567", body: "ok", channel: "sms" }))
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.error).toBe("SMS provider not configured")
    // Still logs the attempt
    expect(state.messagesCreated).toHaveLength(1)
    expect(state.messagesCreated[0].status).toBe("failed")
  })

  it("rejects a conversationId that does not belong to the authenticated org", async () => {
    vi.mocked(sanitizeOwnedRefs).mockResolvedValueOnce({})

    const res = await POST(makeReq({
      to: "+994501234567",
      body: "do not attach cross-tenant",
      channel: "sms",
      conversationId: "foreign-conversation",
    }))

    expect(res.status).toBe(404)
    expect(sendSms).not.toHaveBeenCalled()
    expect(state.messagesCreated).toHaveLength(0)
  })
})
