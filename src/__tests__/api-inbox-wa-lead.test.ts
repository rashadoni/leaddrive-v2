import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/**
 * Inbox WhatsApp path — Slice 3b #4 hardening: an outbound WhatsApp sent with a
 * leadId must thread that leadId into sendWhatsAppMessage (which logs the
 * ChannelMessage with leadId), so the inbox WA path is lead-correct regardless
 * of caller. The early-return WA case previously dropped leadId.
 */

const waCalls: any[] = []

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
    channelMessage: { create: vi.fn(async () => ({ id: "m1" })), findFirst: vi.fn(async () => null) },
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
