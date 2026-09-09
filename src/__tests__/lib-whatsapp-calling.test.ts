import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

type ChannelConfigFindFirstArgs = {
  where: Record<string, unknown>
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
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
        verifyToken: "verify_1",
        appSecret: "secret_1",
        displayName: "ACME WA",
      })),
    },
  },
}))

import {
  fetchWhatsAppCallPermissionState,
  parseWhatsAppCallPermissionState,
  sendWhatsAppCallAction,
  sendWhatsAppCallPermissionRequest,
  startWhatsAppOutboundCall,
} from "@/lib/whatsapp"
import { prisma } from "@/lib/prisma"

const originalFetch = global.fetch

type FetchCall = {
  url: string
  init: RequestInit
}

let fetchCalls: FetchCall[] = []

beforeEach(() => {
  vi.clearAllMocks()
  fetchCalls = []
  global.fetch = (async (input, init) => {
    fetchCalls.push({ url: String(input), init: init ?? {} })
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch
})

afterEach(() => {
  global.fetch = originalFetch
})

describe("sendWhatsAppCallAction", () => {
  it("posts a WhatsApp Calling action to the tenant phone calls endpoint", async () => {
    const result = await sendWhatsAppCallAction({
      organizationId: "org_1",
      channelConfigId: "cfg_wa",
      callId: "wacid.123",
      action: "accept",
      sdp: "v=0\r\n...",
      sdpType: "answer",
    })

    expect(result.success).toBe(true)
    expect(prisma.channelConfig.findFirst).toHaveBeenCalledWith({
      where: { id: "cfg_wa", organizationId: "org_1", channelType: "whatsapp", isActive: true },
    } satisfies ChannelConfigFindFirstArgs)
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]?.url).toBe("https://graph.facebook.com/v25.0/phone_1/calls")
    expect(fetchCalls[0]?.init.headers).toMatchObject({
      Authorization: "Bearer token_1",
      "Content-Type": "application/json",
    })
    expect(JSON.parse(String(fetchCalls[0]?.init.body))).toEqual({
      messaging_product: "whatsapp",
      call_id: "wacid.123",
      action: "accept",
      session: { sdp_type: "answer", sdp: "v=0\r\n..." },
    })
  })

  it("returns a provider error without throwing", async () => {
    global.fetch = (async (input, init) => {
      fetchCalls.push({ url: String(input), init: init ?? {} })
      return new Response(JSON.stringify({ error: { message: "Invalid call state" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    }) as typeof fetch

    const result = await sendWhatsAppCallAction({
      organizationId: "org_1",
      callId: "wacid.123",
      action: "terminate",
    })

    expect(result).toMatchObject({
      success: false,
      status: 400,
      error: "Invalid call state",
    })
    expect(JSON.parse(String(fetchCalls[0]?.init.body))).toEqual({
      messaging_product: "whatsapp",
      call_id: "wacid.123",
      action: "terminate",
    })
  })

  it("normalizes Meta call permission state and action limits", () => {
    const state = parseWhatsAppCallPermissionState({
      messaging_product: "whatsapp",
      permission: { status: "temporary", expiration_time: 1768550400 },
      actions: [
        { action_name: "start_call", can_perform_action: true, limits: [{ time_period: "PT24H", current_usage: 1, max_allowed: 100 }] },
        { action_name: "send_call_permission_request", can_perform_action: false, limits: "" },
      ],
    }, 200)

    expect(state).toMatchObject({
      success: true,
      status: 200,
      permissionStatus: "temporary",
      expirationTime: 1768550400,
      canStartCall: true,
      canRequest: false,
    })
    expect(state.actions[0]?.limits[0]).toMatchObject({ timePeriod: "PT24H", currentUsage: 1, maxAllowed: 100 })
  })

  it("checks call permissions through the tenant phone call_permissions endpoint", async () => {
    global.fetch = (async (input, init) => {
      fetchCalls.push({ url: String(input), init: init ?? {} })
      return new Response(JSON.stringify({
        permission: { status: "permanent" },
        actions: [{ action_name: "start_call", can_perform_action: true }],
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    }) as typeof fetch

    const result = await fetchWhatsAppCallPermissionState({
      organizationId: "org_1",
      channelConfigId: "cfg_wa",
      userWaId: "+994 50 123 45 67",
    })

    expect(result.canStartCall).toBe(true)
    expect(fetchCalls[0]?.url).toBe("https://graph.facebook.com/v25.0/phone_1/call_permissions?user_wa_id=994501234567")
  })

  it("sends a free-form call permission request interactive message", async () => {
    global.fetch = (async (input, init) => {
      fetchCalls.push({ url: String(input), init: init ?? {} })
      return new Response(JSON.stringify({ messages: [{ id: "wamid.permission" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }) as typeof fetch

    const result = await sendWhatsAppCallPermissionRequest({
      organizationId: "org_1",
      channelConfigId: "cfg_wa",
      to: "+994501234567",
      body: "Can we call you?",
    })

    expect(result).toMatchObject({ success: true, messageId: "wamid.permission" })
    expect(fetchCalls[0]?.url).toBe("https://graph.facebook.com/v25.0/phone_1/messages")
    expect(JSON.parse(String(fetchCalls[0]?.init.body))).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "994501234567",
      type: "interactive",
      interactive: {
        type: "call_permission_request",
        action: { name: "call_permission_request" },
        body: { text: "Can we call you?" },
      },
    })
  })

  it("starts an outbound WhatsApp call with action=connect and an SDP offer", async () => {
    global.fetch = (async (input, init) => {
      fetchCalls.push({ url: String(input), init: init ?? {} })
      return new Response(JSON.stringify({ calls: [{ id: "wacid.outbound" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }) as typeof fetch

    const result = await startWhatsAppOutboundCall({
      organizationId: "org_1",
      channelConfigId: "cfg_wa",
      to: "+994501234567",
      sdp: "v=0\r\n...",
      bizOpaqueCallbackData: "ld_call:call_1",
    })

    expect(result).toMatchObject({ success: true, callId: "wacid.outbound" })
    expect(fetchCalls[0]?.url).toBe("https://graph.facebook.com/v25.0/phone_1/calls")
    expect(JSON.parse(String(fetchCalls[0]?.init.body))).toEqual({
      messaging_product: "whatsapp",
      action: "connect",
      to: "994501234567",
      session: { sdp_type: "offer", sdp: "v=0\r\n..." },
      biz_opaque_callback_data: "ld_call:call_1",
    })
  })
})
