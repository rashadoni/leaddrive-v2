/**
 * The demo's live WhatsApp thread.
 *
 * One test per rule in the header of src/lib/demo-center/demo-whatsapp.ts:
 * the prospect writes first (WhatsApp's own rule, and this account has no
 * template to open with), only the phone on their own request is ever
 * written to, five answers per grant counted from the messages themselves,
 * and a session that is not allowed live contact gets nothing at all.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockSend = vi.hoisted(() => vi.fn())
const mockSender = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelMessage: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: (fn: () => unknown) => Promise.resolve().then(fn),
  runWithTenant: (_org: string, fn: () => unknown) => Promise.resolve().then(fn),
}))
// The one door into the tenant; demo code never picks an organisation itself.
vi.mock("@/lib/demo-center/sales-org", () => ({
  inDemoSalesOrganization: async (work: (organizationId: string) => Promise<unknown>) => ({
    organizationId: "org-leaddrive-inc",
    value: await work("org-leaddrive-inc"),
  }),
}))
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppText: mockSend }))
vi.mock("@/lib/demo-center/whatsapp-number", () => ({
  demoWhatsAppSender: mockSender,
  demoWhatsAppConversationId: vi.fn(async () => "conv-1"),
}))

import { prisma } from "@/lib/prisma"
import { DEMO_WHATSAPP_MAX_SENDS, demoWhatsAppState, sendDemoWhatsApp } from "@/lib/demo-center/demo-whatsapp"

const NOW = new Date("2026-09-23T09:00:00.000Z")
const PHONE = "+994501234567"
const grant = { id: "grant-1", status: "ACTIVE", liveCallEnabled: true, sessionExpiresAt: null }

function inbound(minutesAgo: number) {
  return {
    id: `in-${minutesAgo}`,
    direction: "inbound",
    body: "Salam!",
    createdAt: new Date(NOW.getTime() - minutesAgo * 60_000),
    metadata: { waPhone: "994501234567" },
  }
}

function ourAnswer(index: number) {
  return {
    id: `out-${index}`,
    direction: "outbound",
    body: `cavab ${index}`,
    createdAt: new Date(NOW.getTime() - index * 60_000),
    metadata: { demoGrantId: "grant-1" },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSender.mockResolvedValue({
    organizationId: "org-leaddrive-inc",
    channelConfigId: "cc-1",
    phoneNumberId: "984538588084578",
    waNumber: "994105313065",
    displayNumber: "+994 10 531 30 65",
  })
  mockSend.mockResolvedValue({ success: true, messageId: "wamid.1" })
  vi.mocked(prisma.channelMessage.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.channelMessage.create).mockResolvedValue({ id: "new" } as never)
})

describe("what the demo page is told", () => {
  it("offers the sales number and a link with the opening line already written", async () => {
    const state = await demoWhatsAppState({ grant, requestPhone: PHONE, company: "Xəzər Logistika MMC", now: NOW })
    expect(state.enabled).toBe(true)
    expect(state.displayNumber).toBe("+994 10 531 30 65")
    expect(state.link).toContain("https://wa.me/994105313065?text=")
    expect(decodeURIComponent(state.link!)).toContain("Xəzər Logistika MMC")
    // Nobody has written yet, so no answer may be sent.
    expect(state.windowOpen).toBe(false)
    expect(state.left).toBe(DEMO_WHATSAPP_MAX_SENDS)
  })

  it("opens once the prospect has written, and closes again after WhatsApp's window", async () => {
    vi.mocked(prisma.channelMessage.findMany).mockResolvedValueOnce([inbound(30)] as never)
    expect((await demoWhatsAppState({ grant, requestPhone: PHONE, now: NOW })).windowOpen).toBe(true)

    vi.mocked(prisma.channelMessage.findMany).mockResolvedValueOnce([inbound(24 * 60)] as never)
    expect((await demoWhatsAppState({ grant, requestPhone: PHONE, now: NOW })).windowOpen).toBe(false)
  })

  it("says nothing at all when the session is not allowed live contact, or has no mobile on the request", async () => {
    expect((await demoWhatsAppState({ grant: { ...grant, liveCallEnabled: false }, requestPhone: PHONE, now: NOW })).enabled).toBe(false)
    expect((await demoWhatsAppState({ grant: { ...grant, status: "REVOKED" }, requestPhone: PHONE, now: NOW })).enabled).toBe(false)
    expect((await demoWhatsAppState({ grant, requestPhone: "+1 202 555 0100", now: NOW })).enabled).toBe(false)
    expect((await demoWhatsAppState({ grant, requestPhone: null, now: NOW })).enabled).toBe(false)
  })
})

describe("sending an answer", () => {
  it("goes only to the phone on the prospect's own request", async () => {
    vi.mocked(prisma.channelMessage.findMany).mockResolvedValue([inbound(5)] as never)
    const result = await sendDemoWhatsApp({ grant, requestPhone: PHONE, text: "Salam, buradayıq", now: NOW })
    expect(result.ok).toBe(true)
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockSend.mock.calls[0][0]).toMatchObject({ to: PHONE, body: "Salam, buradayıq", organizationId: "org-leaddrive-inc" })
    // And the row it writes is the one the counter reads.
    expect(vi.mocked(prisma.channelMessage.create).mock.calls[0][0].data).toMatchObject({
      direction: "outbound",
      channelType: "whatsapp",
      metadata: expect.objectContaining({ demoGrantId: "grant-1", sentVia: "demo" }),
    })
  })

  it("refuses before the prospect has written — a business cannot open a WhatsApp thread without a template", async () => {
    vi.mocked(prisma.channelMessage.findMany).mockResolvedValue([] as never)
    expect(await sendDemoWhatsApp({ grant, requestPhone: PHONE, text: "Salam", now: NOW })).toEqual({ ok: false, code: "no_inbound" })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("stops at five answers, counting only this grant's own", async () => {
    const sent = Array.from({ length: DEMO_WHATSAPP_MAX_SENDS }, (_, index) => ourAnswer(index + 1))
    vi.mocked(prisma.channelMessage.findMany).mockResolvedValue([inbound(5), ...sent] as never)
    expect(await sendDemoWhatsApp({ grant, requestPhone: PHONE, text: "altıncı", now: NOW })).toEqual({ ok: false, code: "too_many" })
    expect(mockSend).not.toHaveBeenCalled()

    // An operator's own reply from the inbox is not the prospect's allowance.
    const operatorReplies = sent.map((row) => ({ ...row, metadata: { sentVia: "leaddrive_inbox" } }))
    vi.mocked(prisma.channelMessage.findMany).mockResolvedValue([inbound(5), ...operatorReplies] as never)
    expect((await sendDemoWhatsApp({ grant, requestPhone: PHONE, text: "yenə", now: NOW })).ok).toBe(true)
  })

  it("refuses empty, overlong and disabled sessions without touching WhatsApp", async () => {
    vi.mocked(prisma.channelMessage.findMany).mockResolvedValue([inbound(5)] as never)
    expect(await sendDemoWhatsApp({ grant, requestPhone: PHONE, text: "   ", now: NOW })).toEqual({ ok: false, code: "empty" })
    expect(await sendDemoWhatsApp({ grant, requestPhone: PHONE, text: "x".repeat(900), now: NOW })).toEqual({ ok: false, code: "too_long" })
    expect(await sendDemoWhatsApp({ grant: { ...grant, liveCallEnabled: false }, requestPhone: PHONE, text: "Salam", now: NOW }))
      .toEqual({ ok: false, code: "not_enabled" })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("does not record a message WhatsApp refused", async () => {
    vi.mocked(prisma.channelMessage.findMany).mockResolvedValue([inbound(5)] as never)
    mockSend.mockResolvedValue({ success: false, error: "outside_window_no_template" })
    expect(await sendDemoWhatsApp({ grant, requestPhone: PHONE, text: "Salam", now: NOW })).toEqual({ ok: false, code: "failed" })
    expect(prisma.channelMessage.create).not.toHaveBeenCalled()
  })
})
