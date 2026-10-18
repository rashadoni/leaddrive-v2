/**
 * The demo's live WhatsApp thread (src/lib/demo-center/demo-whatsapp.ts):
 * what the demo page is told, whose messages it may show, and our first
 * message to the prospect's own phone.
 *
 * The phone on a request is typed, not proved. Until 2026-10-18 the thread
 * showed the last twelve messages of any age whose `from` contained the
 * number's last nine digits — and an inbound row's `from` is the sender's own
 * profile name. Now nothing is shown before the session's code came from
 * exactly that phone, and rows are matched by the exact number only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  upsertThread: vi.fn(),
  findThread: vi.fn(),
  countThreads: vi.fn(),
  updateThread: vi.fn(),
  lock: vi.fn(),
  findTicket: vi.fn(),
  createEvent: vi.fn(),
  findMessages: vi.fn(),
  createMessage: vi.fn(),
  sender: vi.fn(),
  config: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock("@/lib/prisma", () => {
  const demoWhatsAppThread = { upsert: mocks.upsertThread, findFirst: mocks.findThread, count: mocks.countThreads, updateMany: mocks.updateThread }
  return {
    prisma: {
      demoWhatsAppThread,
      demoAccessEvent: { create: mocks.createEvent },
      channelMessage: { findMany: mocks.findMessages, create: mocks.createMessage },
      ticket: { findFirst: mocks.findTicket },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({ $executeRaw: mocks.lock, demoWhatsAppThread }),
    },
  }
})
vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: (fn: () => unknown) => Promise.resolve().then(fn),
  runWithTenant: (_org: string, fn: () => unknown) => Promise.resolve().then(fn),
}))
// The one door into the tenant; demo code never picks an organisation itself.
vi.mock("@/lib/demo-center/sales-org", () => ({
  demoSalesOrganizationId: () => "org-leaddrive-inc",
  inDemoSalesOrganization: async (work: (organizationId: string) => Promise<unknown>) => ({
    organizationId: "org-leaddrive-inc",
    value: await work("org-leaddrive-inc"),
  }),
}))
vi.mock("@/lib/whatsapp", () => ({ resolveWhatsAppConfig: mocks.config, sendWhatsAppText: vi.fn() }))
vi.mock("@/lib/demo-center/whatsapp-number", () => ({
  demoWhatsAppSender: mocks.sender,
  demoWhatsAppConversationId: vi.fn(async () => "conv-1"),
}))

import { DEMO_WHATSAPP_WELCOMES_PER_DAY, demoWhatsAppCode, demoWhatsAppState, sendDemoWhatsAppWelcome, startDemoWhatsAppTicketMode } from "@/lib/demo-center/demo-whatsapp"
import { DEMO_WHATSAPP_MAX_AI_REPLIES } from "@/lib/demo-center/demo-whatsapp-agent"
import { DEMO_WHATSAPP_WELCOME } from "@/lib/demo-center/demo-whatsapp-welcome"

const NOW = new Date("2026-10-18T11:00:00.000Z")
const PHONE = "+994501234567"
const grant = { id: "grant-1", createdAt: new Date(NOW.getTime() - 60 * 60_000), status: "ACTIVE", liveCallEnabled: false, liveWhatsAppEnabled: true, sessionExpiresAt: null }
/** A request the owner switched on in Demo Center: he has seen who asked. */
const switched = { ...grant, liveCallEnabled: true }

function threadRow(overrides: Record<string, unknown> = {}) {
  return { id: "thread-1", phoneE164: PHONE, welcomeSentAt: null, provenAt: null, expiresAt: null, aiReplies: 0, closedAt: null, ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("fetch", mocks.fetch)
  mocks.sender.mockResolvedValue({
    organizationId: "org-leaddrive-inc",
    channelConfigId: "cc-1",
    phoneNumberId: "984538588084578",
    waNumber: "994105313065",
    displayNumber: "+994 10 531 30 65",
  })
  mocks.config.mockResolvedValue({ id: "cc-1", organizationId: "org-leaddrive-inc", phoneNumberId: "984538588084578", accessToken: "token" })
  mocks.upsertThread.mockResolvedValue(threadRow())
  mocks.findThread.mockResolvedValue(null)
  mocks.countThreads.mockResolvedValue(0)
  mocks.lock.mockResolvedValue(1)
  mocks.updateThread.mockResolvedValue({ count: 1 })
  mocks.createEvent.mockResolvedValue({})
  mocks.findMessages.mockResolvedValue([])
  mocks.createMessage.mockResolvedValue({})
  mocks.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.welcome" }] }) })
})

describe("what the demo page is told", () => {
  it("offers the sales number and a link with this session's code — and our welcome only where the owner switched the request on", async () => {
    const state = await demoWhatsAppState({ grant, requestPhone: PHONE, company: "Xəzər Logistika MMC", now: NOW })
    expect(state).toMatchObject({ enabled: true, displayNumber: "+994 10 531 30 65", code: demoWhatsAppCode("grant-1"), proven: false, welcomeSentAt: null, canWelcome: false })
    expect((await demoWhatsAppState({ grant: switched, requestPhone: PHONE, now: NOW })).canWelcome).toBe(true)
    expect(state.phoneMasked).toBe("+994 ** *** 45 67")
    expect(decodeURIComponent(state.link!)).toContain(demoWhatsAppCode("grant-1"))
    expect(decodeURIComponent(state.link!)).toContain("Xəzər Logistika MMC")
    // The thread's row is made for this grant, this phone and this code.
    expect(mocks.upsertThread.mock.calls[0][0]).toMatchObject({
      where: { grantId: "grant-1" },
      create: { grantId: "grant-1", phoneE164: PHONE, code: demoWhatsAppCode("grant-1") },
      update: {},
    })
  })

  it("gives every session its own code", () => {
    expect(demoWhatsAppCode("grant-1")).toMatch(/^LD-[0-9A-F]{6}$/)
    expect(demoWhatsAppCode("grant-1")).not.toBe(demoWhatsAppCode("grant-2"))
  })

  it("is offered to every guided demo, and to an old grant through the call switch", async () => {
    expect((await demoWhatsAppState({ grant: { ...grant, liveWhatsAppEnabled: false, liveCallEnabled: true }, requestPhone: PHONE, now: NOW })).enabled).toBe(true)
    expect((await demoWhatsAppState({ grant: { ...grant, liveWhatsAppEnabled: false }, requestPhone: PHONE, now: NOW })).enabled).toBe(false)
  })

  it("says nothing at all when the session is not live, or has no Azerbaijani mobile on the request", async () => {
    expect((await demoWhatsAppState({ grant: { ...grant, status: "REVOKED" }, requestPhone: PHONE, now: NOW })).enabled).toBe(false)
    expect((await demoWhatsAppState({ grant, requestPhone: "+1 202 555 0100", now: NOW })).enabled).toBe(false)
    expect((await demoWhatsAppState({ grant, requestPhone: null, now: NOW })).enabled).toBe(false)
  })
})

describe("whose messages the demo may show", () => {
  it("shows nothing before the proof — whatever the number exchanged with LeadDrive", async () => {
    mocks.findMessages.mockResolvedValue([{ id: "x", direction: "inbound", body: "Salam", createdAt: NOW, metadata: { waPhone: "994501234567" } }])
    const state = await demoWhatsAppState({ grant, requestPhone: PHONE, now: NOW })
    expect(state.messages).toEqual([])
    expect(mocks.findMessages).not.toHaveBeenCalled()
  })

  it("after the proof, reads from our welcome, by the exact number only, and tells the agent's answers apart", async () => {
    const welcomeAt = new Date(NOW.getTime() - 20 * 60_000)
    const provenAt = new Date(NOW.getTime() - 10 * 60_000)
    mocks.upsertThread.mockResolvedValue(threadRow({ welcomeSentAt: welcomeAt, provenAt, expiresAt: new Date("2026-10-18T19:59:59.999Z"), aiReplies: 3 }))
    mocks.findMessages.mockResolvedValue([
      { id: "ai", direction: "outbound", body: "Salam!", createdAt: NOW, metadata: { sentVia: "demo_ai" } },
      { id: "in", direction: "inbound", body: "Kod: LD-1A2B3C", createdAt: provenAt, metadata: { waPhone: "994501234567" } },
      { id: "welcome", direction: "outbound", body: "Salam, Nigar!", createdAt: welcomeAt, metadata: { sentVia: "demo_welcome" } },
    ])
    const state = await demoWhatsAppState({ grant, requestPhone: PHONE, now: NOW })
    expect(state.messages.map((message) => message.by)).toEqual(["welcome", "prospect", "ai"])
    expect(state).toMatchObject({ proven: true, agentActive: true, agentRepliesLeft: DEMO_WHATSAPP_MAX_AI_REPLIES - 3 })
    const where = mocks.findMessages.mock.calls[0][0].where
    expect(where.createdAt).toEqual({ gte: welcomeAt })
    expect(where.OR).toEqual([
      { direction: "inbound", metadata: { path: ["waPhone"], equals: "994501234567" } },
      { direction: "outbound", to: { in: ["994501234567", "+994501234567"] } },
    ])
    expect(JSON.stringify(where)).not.toContain('"from"')
  })

  it("gives a request whose phone changed since the thread was made nothing", async () => {
    mocks.upsertThread.mockResolvedValue(threadRow({ phoneE164: "+994551112233", provenAt: NOW }))
    expect((await demoWhatsAppState({ grant, requestPhone: PHONE, now: NOW })).enabled).toBe(false)
  })
})

describe("our first message to the prospect's own phone", () => {
  it("is never sent on a request the owner has not switched on: anyone can type a stranger's number into the form", async () => {
    expect(await sendDemoWhatsAppWelcome({ grant, requestPhone: PHONE, requestName: "Nigar", consent: true, now: NOW })).toEqual({ ok: false, code: "not_enabled" })
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.updateThread).not.toHaveBeenCalled()
  })

  it("is sent only with the consent ticked", async () => {
    expect(await sendDemoWhatsAppWelcome({ grant: switched, requestPhone: PHONE, requestName: "Nigar Əliyeva", consent: false, now: NOW })).toEqual({ ok: false, code: "consent_required" })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it("sends Meta's approved template to the request's phone with the first name, and keeps its exact text", async () => {
    const result = await sendDemoWhatsAppWelcome({ grant: switched, requestPhone: PHONE, requestName: "Nigar Əliyeva", consent: true, now: NOW })
    expect(result.ok).toBe(true)
    const [url, init] = mocks.fetch.mock.calls[0]
    expect(url).toBe("https://graph.facebook.com/v21.0/984538588084578/messages")
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: "whatsapp",
      to: "994501234567",
      type: "template",
      template: { name: "leaddrive_demo_welcome", language: { code: "az" }, components: [{ type: "body", parameters: [{ type: "text", text: "Nigar" }] }] },
    })
    expect(mocks.createMessage.mock.calls[0][0].data).toMatchObject({
      direction: "outbound",
      to: "994501234567",
      body: DEMO_WHATSAPP_WELCOME.body("Nigar"),
      metadata: expect.objectContaining({ sentVia: "demo_welcome", demoGrantId: "grant-1", template: "leaddrive_demo_welcome" }),
    })
    expect(mocks.createEvent.mock.calls.at(-1)![0].data).toMatchObject({ grantId: "grant-1", eventType: "WHATSAPP_WELCOME_SENT" })
  })

  it("sends once per demo: claimed before sending", async () => {
    mocks.upsertThread.mockResolvedValue(threadRow({ welcomeSentAt: NOW }))
    expect(await sendDemoWhatsAppWelcome({ grant: switched, requestPhone: PHONE, requestName: "Nigar", consent: true, now: NOW })).toEqual({ ok: false, code: "already_sent" })
    mocks.upsertThread.mockResolvedValue(threadRow())
    mocks.updateThread.mockResolvedValueOnce({ count: 0 })
    expect(await sendDemoWhatsAppWelcome({ grant: switched, requestPhone: PHONE, requestName: "Nigar", consent: true, now: NOW })).toEqual({ ok: false, code: "already_sent" })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it("sends a phone one welcome a week, whichever demo asked", async () => {
    mocks.findThread.mockResolvedValue({ id: "thread-other" })
    expect(await sendDemoWhatsAppWelcome({ grant: switched, requestPhone: PHONE, requestName: "Nigar", consent: true, now: NOW })).toEqual({ ok: false, code: "cooldown" })
    expect(mocks.findThread.mock.calls[0][0].where).toMatchObject({ phoneE164: PHONE, id: { not: "thread-1" } })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it("decides the phone's week and the line's day one at a time, under one lock", async () => {
    await sendDemoWhatsAppWelcome({ grant: switched, requestPhone: PHONE, requestName: "Nigar", consent: true, now: NOW })
    expect(mocks.lock.mock.calls[0][0].join("?")).toContain("pg_advisory_xact_lock")
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.updateThread.mock.invocationCallOrder[0])
  })

  it("sends no more than the line's daily ceiling, whoever asks", async () => {
    mocks.countThreads.mockResolvedValue(DEMO_WHATSAPP_WELCOMES_PER_DAY)
    expect(await sendDemoWhatsAppWelcome({ grant: switched, requestPhone: PHONE, requestName: "Nigar", consent: true, now: NOW })).toEqual({ ok: false, code: "busy" })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it("keeps the claim when Meta did not answer in time: the message may be on the phone already, and is not sent twice", async () => {
    mocks.fetch.mockRejectedValue(Object.assign(new Error("timed out"), { name: "TimeoutError" }))
    const result = await sendDemoWhatsAppWelcome({ grant: switched, requestPhone: PHONE, requestName: "Nigar", consent: true, now: NOW })
    expect(result.ok).toBe(true)
    expect(mocks.updateThread.mock.calls.some(([call]) => call.data?.welcomeSentAt === null)).toBe(false)
    expect(mocks.createMessage).not.toHaveBeenCalled()
  })

  it("gives the claim back when Meta has not approved the template yet, so the prospect can write first instead", async () => {
    mocks.fetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: { code: 132001 } }) })
    expect(await sendDemoWhatsAppWelcome({ grant: switched, requestPhone: PHONE, requestName: "Nigar", consent: true, now: NOW })).toEqual({ ok: false, code: "unavailable" })
    expect(mocks.updateThread.mock.calls.at(-1)![0]).toMatchObject({ data: { welcomeSentAt: null } })
    expect(mocks.createMessage).not.toHaveBeenCalled()
  })

  it("greets a prospect without a usable name neutrally", async () => {
    await sendDemoWhatsAppWelcome({ grant: switched, requestPhone: PHONE, requestName: "1 <x>", consent: true, now: NOW })
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).template.components[0].parameters[0].text).toBe("dost")
  })
})

/**
 * The demo's Service Desk: the real ticket a prospect's own WhatsApp opened,
 * after their own press (owner, 2026-10-18).
 */
describe("the demo's ticket", () => {
  const provenAt = new Date(NOW.getTime() - 10 * 60_000)
  const proven = (overrides: Record<string, unknown> = {}) =>
    threadRow({ provenAt, expiresAt: new Date("2026-10-18T19:59:59.999Z"), aiReplies: 2, ticketModeAt: new Date(NOW.getTime() - 60_000), ticketId: "ticket-1", ...overrides })
  const TICKET_ROW = {
    ticketNumber: "WA-0031",
    subject: "[WhatsApp müraciəti] Kassa çeki çap etmir",
    status: "open",
    createdAt: NOW,
    slaFirstResponseDueAt: new Date(NOW.getTime() + 30 * 60_000),
    firstResponseAt: null,
    slaDueAt: null,
    comments: [{ comment: "[Клиент (WhatsApp)] Kassa çeki çap etmir", userId: null, createdAt: NOW }],
    _count: { comments: 1 },
  }

  it("is read by the id the thread holds, inside the sales organisation, and shown in its customer's view", async () => {
    mocks.upsertThread.mockResolvedValue(proven())
    mocks.findTicket.mockResolvedValue(TICKET_ROW)
    const state = await demoWhatsAppState({ grant, requestPhone: PHONE, now: NOW })
    expect(mocks.findTicket.mock.calls[0][0].where).toEqual({ id: "ticket-1", organizationId: "org-leaddrive-inc" })
    // Public comments only, read by the ticket's id — never found by the phone.
    expect(mocks.findTicket.mock.calls[0][0].select.comments.where).toEqual({ isInternal: false })
    expect(JSON.stringify(mocks.findTicket.mock.calls[0][0])).not.toContain("994")
    expect(state).toMatchObject({ ticketMode: true, ticketModeEnded: false, ticket: { number: "WA-0031", status: "open", messageCount: 1 } })
  })

  it("is not read before the press, nor before the proof", async () => {
    mocks.upsertThread.mockResolvedValue(proven({ ticketModeAt: null, ticketId: null }))
    expect((await demoWhatsAppState({ grant, requestPhone: PHONE, now: NOW })).ticket).toBeNull()
    mocks.upsertThread.mockResolvedValue(threadRow({ ticketId: "ticket-1" }))
    expect((await demoWhatsAppState({ grant, requestPhone: PHONE, now: NOW })).ticket).toBeNull()
    expect(mocks.findTicket).not.toHaveBeenCalled()
  })

  it("says ticket mode ended when the agent's day ran out before a first message opened one", async () => {
    mocks.upsertThread.mockResolvedValue(proven({ ticketId: null, expiresAt: new Date(NOW.getTime() - 1) }))
    expect(await demoWhatsAppState({ grant, requestPhone: PHONE, now: NOW })).toMatchObject({ ticketMode: true, ticketModeEnded: true, ticket: null })
  })

  it("starts ticket mode only on a proven thread whose agent still answers, once", async () => {
    mocks.upsertThread.mockResolvedValue(threadRow())
    expect(await startDemoWhatsAppTicketMode({ grant, requestPhone: PHONE, now: NOW })).toEqual({ ok: false, code: "not_proven" })
    mocks.upsertThread.mockResolvedValue(proven({ ticketModeAt: null, ticketId: null, aiReplies: DEMO_WHATSAPP_MAX_AI_REPLIES }))
    expect(await startDemoWhatsAppTicketMode({ grant, requestPhone: PHONE, now: NOW })).toEqual({ ok: false, code: "agent_done" })
    expect(mocks.updateThread).not.toHaveBeenCalled()

    mocks.upsertThread.mockResolvedValue(proven({ ticketModeAt: null, ticketId: null }))
    const started = await startDemoWhatsAppTicketMode({ grant, requestPhone: PHONE, now: NOW })
    expect(started.ok).toBe(true)
    expect(mocks.updateThread.mock.calls[0][0]).toEqual({
      where: { id: "thread-1", ticketModeAt: null, provenAt: { not: null }, closedAt: null },
      data: { ticketModeAt: NOW },
    })
  })

  it("labels the product's own AI replies as AI, and a template by what it is, not by its placeholder", async () => {
    mocks.upsertThread.mockResolvedValue(proven({ ticketModeAt: null, ticketId: null }))
    mocks.findMessages.mockResolvedValue([
      { id: "tpl", direction: "outbound", body: "[template:ticket_status_az]", createdAt: NOW, metadata: {} },
      { id: "dv", direction: "outbound", body: "Printer siyahıda görünürmü?", createdAt: NOW, metadata: { aiAutoReply: true } },
    ])
    const state = await demoWhatsAppState({ grant, requestPhone: PHONE, now: NOW })
    expect(state.messages.map((message) => [message.by, message.text])).toEqual([
      ["ai", "Printer siyahıda görünürmü?"],
      ["team", "WhatsApp şablon mesajı"],
    ])
  })
})

