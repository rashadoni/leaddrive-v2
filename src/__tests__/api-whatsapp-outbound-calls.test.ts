import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

const auth = {
  orgId: "org_1",
  userId: "user_1",
  role: "admin",
  email: "admin@example.com",
  name: "Admin",
}

type MockWriteArgs = { data: Record<string, unknown> }
type MockFindFirstArgs = { where?: Record<string, unknown> }

let permissionPayload: Record<string, unknown>
let fetchCalls: Array<{ url: string; init: RequestInit }> = []
let activeCall: Record<string, unknown> | null = null
const originalFetch = global.fetch

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: Function) => {
    return (req: NextRequest, ctx?: unknown) => handler(req, auth, ctx)
  },
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialConversation: {
      findFirst: vi.fn(async ({ where }: MockFindFirstArgs) => {
        if (where?.id !== "sc_1" || where?.organizationId !== "org_1") return null
        return {
          id: "sc_1",
          channelConfigId: "cfg_wa",
          externalId: "994501234567",
          contactId: "contact_1",
          contactName: "Aysel",
        }
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    contact: {
      findFirst: vi.fn(async () => ({ phone: "+994501234567", fullName: "Aysel" })),
    },
    channelConfig: {
      findFirst: vi.fn(async () => ({
        id: "cfg_wa",
        organizationId: "org_1",
        accessToken: "token_1",
        apiKey: null,
        phoneNumberId: "phone_1",
        phoneNumber: null,
        businessAccountId: "waba_1",
        webhookUrl: null,
        verifyToken: "verify",
        appSecret: "secret",
        displayName: "+13175551399",
      })),
    },
    whatsAppCallPermission: {
      findUnique: vi.fn(),
      upsert: vi.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => ({
        id: "perm_1",
        status: update?.status || create?.status,
        canRequest: update?.canRequest ?? create?.canRequest ?? false,
        canStartCall: update?.canStartCall ?? create?.canStartCall ?? false,
        requestMessageId: update?.requestMessageId ?? create?.requestMessageId ?? null,
        responseSource: null,
        isPermanent: update?.isPermanent ?? create?.isPermanent ?? false,
        requestedAt: update?.requestedAt ?? create?.requestedAt ?? null,
        approvedAt: null,
        rejectedAt: null,
        expiresAt: update?.expiresAt ?? create?.expiresAt ?? null,
        lastCheckedAt: update?.lastCheckedAt ?? create?.lastCheckedAt ?? null,
        lastProviderStatus: update?.lastProviderStatus ?? create?.lastProviderStatus ?? null,
        lastError: update?.lastError ?? create?.lastError ?? null,
        actions: update?.actions ?? create?.actions ?? [],
      })),
    },
    channelMessage: {
      create: vi.fn(async ({ data }: MockWriteArgs) => ({ id: "msg_1", ...data })),
    },
    callLog: {
      findFirst: vi.fn(async () => activeCall),
      create: vi.fn(async ({ data }: MockWriteArgs) => ({ id: "call_1", notes: data.notes })),
      update: vi.fn(async ({ data }: MockWriteArgs) => ({ id: "call_1", ...data })),
    },
  },
}))

import { prisma } from "@/lib/prisma"
import { POST as POST_PERMISSION } from "@/app/api/v1/calls/whatsapp/permissions/route"
import { POST as POST_OUTBOUND } from "@/app/api/v1/calls/whatsapp/outbound/route"

function req(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchCalls = []
  activeCall = null
  permissionPayload = {
    permission: { status: "no_permission" },
    actions: [
      { action_name: "send_call_permission_request", can_perform_action: true },
      { action_name: "start_call", can_perform_action: false },
    ],
  }
  global.fetch = (async (input, init) => {
    const url = String(input)
    fetchCalls.push({ url, init: init ?? {} })
    if (url.includes("/call_permissions")) {
      return new Response(JSON.stringify(permissionPayload), { status: 200, headers: { "Content-Type": "application/json" } })
    }
    if (url.endsWith("/messages")) {
      return new Response(JSON.stringify({ messages: [{ id: "wamid.permission" }] }), { status: 200, headers: { "Content-Type": "application/json" } })
    }
    if (url.endsWith("/calls")) {
      return new Response(JSON.stringify({ calls: [{ id: "wacid.outbound" }] }), { status: 200, headers: { "Content-Type": "application/json" } })
    }
    return new Response("{}", { status: 404 })
  }) as typeof fetch
})

afterEach(() => {
  global.fetch = originalFetch
})

describe("WhatsApp outbound calling API", () => {
  it("sends a permission request only after Meta allows the request action", async () => {
    const res = await POST_PERMISSION(req("http://localhost/api/v1/calls/whatsapp/permissions", {
      conversationId: "sc_1",
      message: "Can we call you?",
    }))

    expect(res.status).toBe(201)
    expect(fetchCalls.map((call) => call.url)).toEqual([
      "https://graph.facebook.com/v25.0/phone_1/call_permissions?user_wa_id=994501234567",
      "https://graph.facebook.com/v25.0/phone_1/messages",
    ])
    expect(prisma.channelMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        conversationId: "sc_1",
        messageType: "call_permission_request",
        externalId: "wamid.permission",
      }),
    }))
  })

  it("rejects outbound connect when Meta start_call is not allowed", async () => {
    const res = await POST_OUTBOUND(req("http://localhost/api/v1/calls/whatsapp/outbound", {
      conversationId: "sc_1",
      sdp: "v=0\r\n...",
    }))

    expect(res.status).toBe(409)
    expect(prisma.callLog.create).not.toHaveBeenCalled()
    expect(fetchCalls).toHaveLength(1)
  })

  it("rejects a second active outbound call for the same WhatsApp conversation", async () => {
    permissionPayload = {
      permission: { status: "temporary", expiration_time: 1768550400 },
      actions: [{ action_name: "start_call", can_perform_action: true }],
    }
    activeCall = {
      id: "call_active",
      callSid: "wacid.active",
      providerCallId: "wacid.active",
      direction: "outbound",
      fromNumber: "+13175551399",
      toNumber: "+994501234567",
      status: "ringing",
      provider: "whatsapp",
      conversationId: "sc_1",
      contactId: "contact_1",
      claimedByUserId: "user_1",
      claimedAt: new Date("2026-01-01T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    }

    const res = await POST_OUTBOUND(req("http://localhost/api/v1/calls/whatsapp/outbound", {
      conversationId: "sc_1",
      sdp: "v=0\r\n...",
    }))

    expect(res.status).toBe(409)
    expect(prisma.callLog.create).not.toHaveBeenCalled()
    expect(fetchCalls.map((call) => call.url)).toEqual([
      "https://graph.facebook.com/v25.0/phone_1/call_permissions?user_wa_id=994501234567",
    ])
  })

  it("creates a local CallLog and connects through Meta when start_call is allowed", async () => {
    permissionPayload = {
      permission: { status: "temporary", expiration_time: 1768550400 },
      actions: [{ action_name: "start_call", can_perform_action: true }],
    }

    const res = await POST_OUTBOUND(req("http://localhost/api/v1/calls/whatsapp/outbound", {
      conversationId: "sc_1",
      sdp: "v=0\r\n...",
    }))

    expect(res.status).toBe(201)
    expect(prisma.callLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org_1",
        provider: "whatsapp",
        direction: "outbound",
        status: "initiated",
        conversationId: "sc_1",
        claimedByUserId: "user_1",
      }),
    }))
    expect(prisma.callLog.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "call_1" },
      data: expect.objectContaining({
        callSid: "wacid.outbound",
        providerCallId: "wacid.outbound",
        status: "ringing",
      }),
    }))
    expect(JSON.parse(String(fetchCalls[1]?.init.body))).toMatchObject({
      messaging_product: "whatsapp",
      action: "connect",
      to: "994501234567",
      session: { sdp_type: "offer", sdp: "v=0\r\n..." },
      biz_opaque_callback_data: "ld_call:call_1",
    })
  })
})
