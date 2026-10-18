/**
 * The demo's live WhatsApp thread.
 *
 * One test per rule in the header of src/lib/demo-center/demo-whatsapp.ts:
 * the prospect writes first (WhatsApp's own rule, and this account has no
 * template to open with), only the phone on their own request is ever
 * written to, five answers per grant counted from the messages themselves,
 * a session that is not allowed live contact gets nothing at all, and
 * nothing is shown or sent before that phone wrote this session's code.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockSend = vi.hoisted(() => vi.fn())
const mockSender = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelMessage: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), create: vi.fn() },
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
import { DEMO_WHATSAPP_MAX_SENDS, demoWhatsAppCode, demoWhatsAppState, sendDemoWhatsApp } from "@/lib/demo-center/demo-whatsapp"

const NOW = new Date("2026-09-23T09:00:00.000Z")
const PHONE = "+994501234567"
// Issued two days ago, so the window test's day-old message is the grant's own.
const grant = { id: "grant-1", createdAt: new Date(NOW.getTime() - 2 * 24 * 60 * 60_000), status: "ACTIVE", liveCallEnabled: true, sessionExpiresAt: null }

function inbound(minutesAgo: number, body = "Salam!") {
  return {
    id: `in-${minutesAgo}`,
    direction: "inbound",
    body,
    createdAt: new Date(NOW.getTime() - minutesAgo * 60_000),
    metadata: { waPhone: "994501234567" },
  }
}

/** The prospect has written from the request's phone with this session's code, `minutesAgo`. */
function proved(minutesAgo: number, thread: unknown[] = [inbound(minutesAgo)]) {
  vi.mocked(prisma.channelMessage.findFirst).mockResolvedValue({ createdAt: new Date(NOW.getTime() - minutesAgo * 60_000) } as never)
  vi.mocked(prisma.channelMessage.findMany).mockResolvedValue(thread as never)
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
  vi.mocked(prisma.channelMessage.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.channelMessage.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.channelMessage.count).mockResolvedValue(0 as never)
  vi.mocked(prisma.channelMessage.create).mockResolvedValue({ id: "new" } as never)
})

describe("what the demo page is told", () => {
  it("offers the sales number and a link with the opening line and this session's code already written", async () => {
    const state = await demoWhatsAppState({ grant, requestPhone: PHONE, company: "Xəzər Logistika MMC", now: NOW })
    expect(state.enabled).toBe(true)
    expect(state.displayNumber).toBe("+994 10 531 30 65")
    expect(state.link).toContain("https://wa.me/994105313065?text=")
    expect(decodeURIComponent(state.link!)).toContain("Xəzər Logistika MMC")
    expect(decodeURIComponent(state.link!)).toContain(demoWhatsAppCode("grant-1"))
    // Nobody has written yet, so no answer may be sent.
    expect(state.windowOpen).toBe(false)
    expect(state.left).toBe(DEMO_WHATSAPP_MAX_SENDS)
  })

  it("gives every session its own code", () => {
    expect(demoWhatsAppCode("grant-1")).toMatch(/^LD-[0-9A-F]{6}$/)
    expect(demoWhatsAppCode("grant-1")).not.toBe(demoWhatsAppCode("grant-2"))
  })

  it("opens once the prospect has written with the code, and closes again after WhatsApp's window", async () => {
    proved(30)
    expect((await demoWhatsAppState({ grant, requestPhone: PHONE, now: NOW })).windowOpen).toBe(true)

    proved(24 * 60)
    expect((await demoWhatsAppState({ grant, requestPhone: PHONE, now: NOW })).windowOpen).toBe(false)
  })

  it("says nothing at all when the session is not allowed live contact, or has no mobile on the request", async () => {
    expect((await demoWhatsAppState({ grant: { ...grant, liveCallEnabled: false }, requestPhone: PHONE, now: NOW })).enabled).toBe(false)
    expect((await demoWhatsAppState({ grant: { ...grant, status: "REVOKED" }, requestPhone: PHONE, now: NOW })).enabled).toBe(false)
    expect((await demoWhatsAppState({ grant, requestPhone: "+1 202 555 0100", now: NOW })).enabled).toBe(false)
    expect((await demoWhatsAppState({ grant, requestPhone: null, now: NOW })).enabled).toBe(false)
  })
})

/**
 * The phone on the request is typed, not proved. Until 2026-10-18 the thread
 * showed the last twelve messages of any age whose `from` contained its last
 * nine digits — and an inbound row's `from` is the sender's own profile name,
 * which anybody can set. The review that found it also showed that a phone
 * which merely wrote to LeadDrive proves nothing about who is looking at the
 * demo; only this session's code does.
 */
describe("whose messages the demo may show", () => {
  it("looks for this session's code, from exactly the request's number, since the grant was issued", async () => {
    await demoWhatsAppState({ grant, requestPhone: PHONE, now: NOW })
    const where = vi.mocked(prisma.channelMessage.findFirst).mock.calls[0][0]!.where as Record<string, unknown>
    expect(where).toMatchObject({
      direction: "inbound",
      createdAt: { gte: grant.createdAt },
      metadata: { path: ["waPhone"], equals: "994501234567" },
      body: { contains: demoWhatsAppCode("grant-1") },
    })
    // A profile name is never consulted, and nothing is matched by a part of a number.
    expect(JSON.stringify(where)).not.toContain('"from"')
    expect(JSON.stringify(where)).not.toContain("string_contains")
  })

  it("shows nothing and allows nothing without that proof, whatever else the number exchanged with LeadDrive", async () => {
    // The phone did write — without the code: somebody else holding that number.
    vi.mocked(prisma.channelMessage.findMany).mockResolvedValue([inbound(2), inbound(5)] as never)
    const state = await demoWhatsAppState({ grant, requestPhone: PHONE, now: NOW })
    expect(state.messages).toEqual([])
    expect(state.windowOpen).toBe(false)
    expect(await sendDemoWhatsApp({ grant, requestPhone: PHONE, text: "Salam", now: NOW })).toEqual({ ok: false, code: "no_inbound" })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("starts the thread at the proof, and matches its rows by the exact number", async () => {
    proved(10, [inbound(1, "Daha bir sual"), inbound(10, `Salam! Kod: ${demoWhatsAppCode("grant-1")}`)])
    const state = await demoWhatsAppState({ grant, requestPhone: PHONE, now: NOW })
    expect(state.messages.map((message) => message.text)).toEqual([`Salam! Kod: ${demoWhatsAppCode("grant-1")}`, "Daha bir sual"])
    const where = vi.mocked(prisma.channelMessage.findMany).mock.calls[0][0]!.where as Record<string, unknown>
    expect(where.createdAt).toEqual({ gte: new Date(NOW.getTime() - 10 * 60_000) })
    expect(where.OR).toEqual([
      { direction: "inbound", metadata: { path: ["waPhone"], equals: "994501234567" } },
      { direction: "outbound", to: { in: ["994501234567", "+994501234567"] } },
    ])
  })

  it("counts the prospect's five on their own — the composer's rows for this grant, not a page of the thread", async () => {
    vi.mocked(prisma.channelMessage.count).mockResolvedValue(3 as never)
    proved(30)
    const state = await demoWhatsAppState({ grant, requestPhone: PHONE, now: NOW })
    expect(state.sent).toBe(3)
    expect(state.left).toBe(DEMO_WHATSAPP_MAX_SENDS - 3)
    expect(vi.mocked(prisma.channelMessage.count).mock.calls[0][0]!.where).toMatchObject({
      direction: "outbound",
      AND: [
        { metadata: { path: ["demoGrantId"], equals: "grant-1" } },
        { metadata: { path: ["sentVia"], equals: "demo" } },
      ],
    })
  })
})

describe("sending an answer", () => {
  it("goes only to the phone on the prospect's own request", async () => {
    proved(5)
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
    expect(await sendDemoWhatsApp({ grant, requestPhone: PHONE, text: "Salam", now: NOW })).toEqual({ ok: false, code: "no_inbound" })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("stops at five answers", async () => {
    proved(5)
    vi.mocked(prisma.channelMessage.count).mockResolvedValue(DEMO_WHATSAPP_MAX_SENDS as never)
    expect(await sendDemoWhatsApp({ grant, requestPhone: PHONE, text: "altıncı", now: NOW })).toEqual({ ok: false, code: "too_many" })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("refuses empty, overlong and disabled sessions without touching WhatsApp", async () => {
    proved(5)
    expect(await sendDemoWhatsApp({ grant, requestPhone: PHONE, text: "   ", now: NOW })).toEqual({ ok: false, code: "empty" })
    expect(await sendDemoWhatsApp({ grant, requestPhone: PHONE, text: "x".repeat(900), now: NOW })).toEqual({ ok: false, code: "too_long" })
    expect(await sendDemoWhatsApp({ grant: { ...grant, liveCallEnabled: false }, requestPhone: PHONE, text: "Salam", now: NOW }))
      .toEqual({ ok: false, code: "not_enabled" })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("does not record a message WhatsApp refused", async () => {
    proved(5)
    mockSend.mockResolvedValue({ success: false, error: "outside_window_no_template" })
    expect(await sendDemoWhatsApp({ grant, requestPhone: PHONE, text: "Salam", now: NOW })).toEqual({ ok: false, code: "failed" })
    expect(prisma.channelMessage.create).not.toHaveBeenCalled()
  })
})
