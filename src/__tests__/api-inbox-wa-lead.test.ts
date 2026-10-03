import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/**
 * Inbox WhatsApp path — Slice 3b #4 hardening: an outbound WhatsApp sent with a
 * leadId must thread that leadId into sendWhatsAppMessage (which logs the
 * ChannelMessage with leadId), so the inbox WA path is lead-correct regardless
 * of caller. The early-return WA case previously dropped leadId.
 */

const waCalls: any[] = []
// WhatsApp conversations by id: which workspace and which channel (number) each belongs to.
const conversations: Record<string, { organizationId: string; channelConfigId: string | null }> = {
  conv_new_number: { organizationId: "org_1", channelConfigId: "wa_new" },
  conv_other_org: { organizationId: "org_2", channelConfigId: "wa_foreign" },
}

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(async () => "org_1"),
  getSession: vi.fn(async () => null),
  requireAuth: vi.fn(),
  requireSessionAuth: vi.fn(async () => ({
    orgId: "org_1", userId: "support_1", role: "support",
    email: "support@example.test", name: "Support",
  })),
  isAuthError: (value: unknown) => value instanceof Response,
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { findFirst: vi.fn(async () => null), updateMany: vi.fn(async () => ({ count: 0 })) },
    channelConfig: { findFirst: vi.fn(async () => null) },
    channelMessage: {
      create: vi.fn(async () => ({ id: "m1" })),
      update: vi.fn(async () => ({ id: "m1" })),
      findFirst: vi.fn(async () => null),
    },
    socialConversation: {
      findFirst: vi.fn(async ({ where }: any) => {
        const conv = conversations[where.id]
        return conv && conv.organizationId === where.organizationId && where.platform === "whatsapp"
          ? { channelConfigId: conv.channelConfigId }
          : null
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  },
}))
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(async (opts: any) => { waCalls.push(opts); return { success: true, messageId: "wa1" } }),
  sendWhatsAppMedia: vi.fn(async () => ({ success: true })),
}))
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ success: true })) }))
vi.mock("@/lib/sms", () => ({ sendSms: vi.fn(async () => ({ success: true })) }))
// pass-through: ownership sanitize is unit-tested in lib-verify-owned-refs.test.ts
vi.mock("@/lib/verify-owned-refs", () => ({
  sanitizeOwnedRefs: vi.fn(async (_o: string, r: any) => ({
    leadId: r.leadId || undefined,
    contactId: r.contactId || undefined,
    conversationId: r.conversationId || undefined,
  })),
}))

import { POST } from "@/app/api/v1/inbox/route"

const makeReq = (body: any) =>
  new NextRequest("https://example.com/api/v1/inbox", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  })

beforeEach(() => { waCalls.length = 0; vi.clearAllMocks() })

describe("POST /api/v1/inbox — channel: 'whatsapp' (Slice 3b #4)", () => {
  it("threads leadId into sendWhatsAppMessage when sent from a lead", async () => {
    const res = await POST(makeReq({ to: "+994501112233", body: "hi lead", channel: "whatsapp", leadId: "lead-x" }))
    expect(res.status).toBe(201)
    expect(waCalls).toHaveLength(1)
    expect(waCalls[0].leadId).toBe("lead-x")
    expect(waCalls[0].organizationId).toBe("org_1")
  })

  it("leadId is undefined for a normal (non-lead) WhatsApp send", async () => {
    const res = await POST(makeReq({ to: "+994501112233", body: "hi", channel: "whatsapp", contactId: "c1" }))
    expect(res.status).toBe(201)
    expect(waCalls[0].leadId).toBeUndefined()
  })
})

/**
 * Found on production 2026-10-03: a workspace with two WhatsApp numbers answered, from the Inbox
 * composer, with the workspace's FIRST number — not the one the customer wrote to. The route bound the
 * conversation's channel for Facebook, Instagram, TikTok and VK only; WhatsApp sent with none.
 */
describe("POST /api/v1/inbox — WhatsApp answers from the conversation's number", () => {
  it("passes the conversation's channel to the WhatsApp transport", async () => {
    await POST(makeReq({ to: "+994501112233", body: "salam", channel: "whatsapp", conversationId: "conv_new_number" }))
    expect(waCalls).toHaveLength(1)
    expect(waCalls[0].channelConfigId).toBe("wa_new")
    expect(waCalls[0].to).toBe("+994501112233")
  })

  it("keeps the workspace's number for a send with no conversation", async () => {
    await POST(makeReq({ to: "+994501112233", body: "salam", channel: "whatsapp" }))
    expect(waCalls[0].channelConfigId ?? null).toBeNull()
  })

  it("never takes the channel of another workspace's conversation", async () => {
    await POST(makeReq({ to: "+994501112233", body: "salam", channel: "whatsapp", conversationId: "conv_other_org" }))
    expect(waCalls.map((c) => c.channelConfigId ?? null)).not.toContain("wa_foreign")
  })
})
